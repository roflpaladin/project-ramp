// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The endpoint that
// turns "a customer paid" into "this tenant is on this plan".
//
// This is the only unauthenticated POST in the app that can change what a
// tenant is entitled to, so it is built to fail CLOSED at every step:
//
//   1. No PADDLE_WEBHOOK_SECRET configured  -> 401 (same answer as a bad
//      signature — see below), nothing read, nothing written.
//   2. Body larger than MAX_BODY_BYTES      -> 413, before any hashing.
//   3. Missing/invalid Paddle-Signature     -> 401, nothing processed.
//   4. Body that isn't a Paddle event       -> 400.
//   5. Event type we don't handle           -> 200 immediately, no work.
//   6. event_id already processed to a
//      terminal outcome                     -> 200, no work (idempotent).
//      An event logged but never finished is REPROCESSED instead.
//   7. A tenant we cannot resolve from a
//      SERVER-ISSUED reference or a stored
//      subscription id                      -> 200, nothing granted.
//   8. Anything thrown while processing     -> event marked failed, 500, so
//      Paddle retries and the retry does the work.
//
// The raw body text is read ONCE and used verbatim for verification — a
// re-serialised JSON.stringify of a parsed object does not reproduce
// Paddle's bytes and would fail verification (Paddle's own docs name this
// as the most common cause of signature failures).
//
// This route deliberately does NOT follow app/api/integrations/*/webhook —
// those are unauthenticated mocks for a CRM relay, not a model for handling
// real money.
//
// Logging: event id, event type, outcome and reason only. No customer id,
// no email, no amount, no payload body — the full payload is persisted to
// paddle_webhook_events (service-role only) where it belongs, not to logs.

import { NextResponse } from "next/server";

import { parsePaddleEvent, type PaddleSubscriptionEvent } from "@/lib/billing/paddle-event";
import { getPaddleWebhookSecret } from "@/lib/billing/paddle-server-env";
import { PADDLE_SIGNATURE_HEADER, verifyPaddleSignature } from "@/lib/billing/paddle-signature";
import { processSubscriptionEvent } from "@/lib/billing/process-subscription-event";
import { markEventOutcome, recordEvent } from "@/lib/billing/subscription-repository";

// node:crypto (signature verification) and the service-role client both
// need the Node runtime, not Edge.
export const runtime = "nodejs";

const LOG_PREFIX = "[paddle-webhook]";

/**
 * A real Paddle subscription event is a couple of kilobytes. 64 KB is a
 * generous ceiling that still refuses a payload designed to make us hash
 * (and store) megabytes before we can even tell whether it is genuine.
 * Checked twice: the declared Content-Length before reading, because it is
 * cheap, and the bytes actually read, because the header is caller-supplied
 * and can lie.
 */
const MAX_BODY_BYTES = 64 * 1024;

const OK_RESPONSE = { ok: true } as const;
const INVALID_BODY_MESSAGE = "Invalid webhook payload.";
const UNAUTHORIZED_MESSAGE = "Invalid signature.";
const BODY_TOO_LARGE_MESSAGE = "Webhook payload is too large.";
const PROCESSING_FAILED_MESSAGE = "Could not process this event.";

function ok(): Response {
  return NextResponse.json(OK_RESPONSE);
}

function failure(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

function isDeclaredBodyTooLarge(request: Request): boolean {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES;
}

/**
 * Best effort by design: this runs while we are already failing, and its
 * own failure must not replace the 5xx that makes Paddle retry. Marking the
 * event `failed` is what lets that retry be REPROCESSED instead of
 * dismissed as a duplicate (see recordEvent).
 */
async function markFailedBestEffort(eventId: string): Promise<void> {
  try {
    await markEventOutcome(eventId, "failed", "processing_error");
  } catch (markError) {
    console.error(`${LOG_PREFIX} could not mark an event as failed:`, {
      eventId,
      message: markError instanceof Error ? markError.message : "unknown error",
    });
  }
}

async function handleSubscriptionEvent(event: PaddleSubscriptionEvent, payload: unknown): Promise<Response> {
  try {
    const recorded = await recordEvent({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload,
    });

    // Only a delivery that previously reached a TERMINAL outcome is a true
    // duplicate. A redelivery of an event that was never finished
    // ("received"/"failed") is reprocessed — otherwise a crash mid-flight
    // would mean a customer paid and was never provisioned, forever.
    if (recorded === "duplicate") return ok();

    const processed = await processSubscriptionEvent(event);
    await markEventOutcome(event.eventId, processed.outcome, processed.reason);

    if (processed.outcome === "ignored") {
      console.error(`${LOG_PREFIX} ignored an event — granting nothing:`, {
        eventId: event.eventId,
        eventType: event.eventType,
        reason: processed.reason,
      });
    }

    return ok();
  } catch (error) {
    // 500 on purpose: Paddle retries, and the event row (now marked failed)
    // makes that retry do the work rather than skip it. Answering 200 here
    // would lose a paid subscription permanently.
    console.error(`${LOG_PREFIX} failed to process an event:`, {
      eventId: event.eventId,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : "unknown error",
    });
    await markFailedBestEffort(event.eventId);
    return failure(500, PROCESSING_FAILED_MESSAGE);
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = getPaddleWebhookSecret();
  if (!secret) {
    // Answered as 401, exactly like a bad signature: an unauthenticated
    // prober must not be able to tell a misconfigured billing webhook from
    // a rejected forgery. The real reason goes to the server log.
    console.error(`${LOG_PREFIX} PADDLE_WEBHOOK_SECRET is not set — refusing to process any event`);
    return failure(401, UNAUTHORIZED_MESSAGE);
  }

  if (isDeclaredBodyTooLarge(request)) {
    console.error(`${LOG_PREFIX} refused an oversized body before reading it`);
    return failure(413, BODY_TOO_LARGE_MESSAGE);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    console.error(`${LOG_PREFIX} refused an oversized body after reading it`);
    return failure(413, BODY_TOO_LARGE_MESSAGE);
  }

  const verification = verifyPaddleSignature({
    rawBody,
    signatureHeader: request.headers.get(PADDLE_SIGNATURE_HEADER),
    secret,
  });
  if (!verification.ok) {
    console.error(`${LOG_PREFIX} rejected an unverified request:`, { reason: verification.reason });
    return failure(401, UNAUTHORIZED_MESSAGE);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error(`${LOG_PREFIX} verified request carried a body that is not JSON`);
    return failure(400, INVALID_BODY_MESSAGE);
  }

  const parsed = parsePaddleEvent(body);
  if (parsed.kind === "invalid") {
    console.error(`${LOG_PREFIX} rejected a malformed event:`, { reason: parsed.reason });
    return failure(400, INVALID_BODY_MESSAGE);
  }
  if (parsed.kind === "unhandled") {
    // Subscribing to extra event types in the Paddle dashboard must never
    // cost us a retry storm — acknowledge and move on.
    return ok();
  }

  return handleSubscriptionEvent(parsed.event, body);
}
