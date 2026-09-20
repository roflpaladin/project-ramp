// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The endpoint that
// turns "a customer paid" into "this tenant is on this plan".
//
// This is the only unauthenticated POST in the app that can change what a
// tenant is entitled to, so it is built to fail CLOSED at every step:
//
//   1. No PADDLE_WEBHOOK_SECRET configured  -> 500, nothing read, nothing
//      written. (Deliberately not "process it anyway".)
//   2. Missing/invalid Paddle-Signature     -> 401, nothing processed.
//   3. Body that isn't a Paddle event       -> 400.
//   4. Event type we don't handle           -> 200 immediately, no work.
//   5. event_id we've already logged        -> 200, no work (idempotent).
//   6. A tenant we cannot resolve from a
//      SERVER-ISSUED reference or a stored
//      subscription id                      -> 200, nothing granted.
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

import { parsePaddleEvent } from "@/lib/billing/paddle-event";
import { getPaddleWebhookSecret } from "@/lib/billing/paddle-server-env";
import { PADDLE_SIGNATURE_HEADER, verifyPaddleSignature } from "@/lib/billing/paddle-signature";
import { applyBillingEvent, type BillingEventResult, type SubscriptionState } from "@/lib/billing/subscription-reducer";
import {
  consumeCheckoutRef,
  findByPaddleSubscriptionId,
  markEventOutcome,
  recordEvent,
  upsertFromState,
} from "@/lib/billing/subscription-repository";

// node:crypto (signature verification) and the service-role client both
// need the Node runtime, not Edge.
export const runtime = "nodejs";

const LOG_PREFIX = "[paddle-webhook]";

const OK_RESPONSE = { ok: true } as const;
const INVALID_BODY_MESSAGE = "Invalid webhook payload.";
const UNAUTHORIZED_MESSAGE = "Invalid signature.";
const MISCONFIGURED_MESSAGE = "Billing webhook is not configured.";
const PROCESSING_FAILED_MESSAGE = "Could not process this event.";

function ok(): Response {
  return NextResponse.json(OK_RESPONSE);
}

function failure(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Tenant resolution, in strict order of trust:
 *   1. the subscription we already store (its tenant is settled — a replayed
 *      or stolen checkout ref can never move it to another tenant), then
 *   2. a server-issued checkout reference, looked up and expiry-checked in
 *      the database.
 * A tenant id sitting in the payload is never consulted; parsePaddleEvent
 * does not even carry one through.
 */
async function resolveTenant(
  storedState: SubscriptionState | null,
  checkoutRef: string | null,
): Promise<string | null> {
  if (storedState) return storedState.tenantId;
  if (!checkoutRef) return null;

  const owner = await consumeCheckoutRef(checkoutRef);
  return owner?.tenantId ?? null;
}

async function persistResult(eventId: string, result: BillingEventResult): Promise<void> {
  if (result.outcome === "applied" && result.state) {
    await upsertFromState(result.state);
  }
  await markEventOutcome(eventId, result.outcome, result.reason);
}

export async function POST(request: Request): Promise<Response> {
  const secret = getPaddleWebhookSecret();
  if (!secret) {
    console.error(`${LOG_PREFIX} PADDLE_WEBHOOK_SECRET is not set — refusing to process any event`);
    return failure(500, MISCONFIGURED_MESSAGE);
  }

  const rawBody = await request.text();
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

  const { event } = parsed;

  try {
    const recorded = await recordEvent({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: body,
    });
    if (recorded === "duplicate") return ok();

    const storedState = await findByPaddleSubscriptionId(event.subscription.id);
    const tenantId = await resolveTenant(storedState, event.subscription.checkoutRef);

    if (!tenantId) {
      console.error(`${LOG_PREFIX} could not resolve a tenant — granting nothing:`, {
        eventId: event.eventId,
        eventType: event.eventType,
      });
      await markEventOutcome(event.eventId, "ignored", "unresolved_tenant");
      return ok();
    }

    const result = applyBillingEvent(storedState, event, { tenantId });
    await persistResult(event.eventId, result);

    if (result.outcome === "ignored") {
      console.error(`${LOG_PREFIX} ignored an event:`, {
        eventId: event.eventId,
        eventType: event.eventType,
        reason: result.reason,
      });
    }

    return ok();
  } catch (error) {
    // 500 on purpose: Paddle retries, and the event_id primary key makes
    // that retry safe. Swallowing this as a 200 would lose a paid
    // subscription permanently.
    console.error(`${LOG_PREFIX} failed to process an event:`, {
      eventId: event.eventId,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return failure(500, PROCESSING_FAILED_MESSAGE);
  }
}
