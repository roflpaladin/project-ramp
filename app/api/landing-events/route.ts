import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, LANDING_EVENT_RATE_LIMIT } from "@/lib/rate-limit";
import { isHeadlineVariantId } from "@/app/landing-variants";

// Sprint 9, Ticket 48 — headline variant impression instrumentation for the
// Brava landing page (getbrava.tech). PUBLIC, unauthenticated, write — same
// threat class as app/api/waitlist/route.ts (T47): an IP-keyed rate limit
// (lib/rate-limit.ts, LANDING_EVENT_RATE_LIMIT — see that constant's header
// for why it's a bit looser than WAITLIST_RATE_LIMIT), unknown-key
// rejection, and a Content-Length pre-parse size gate, all copied one-for-one
// from that route.
//
// Table access is service-role only (landing_events has RLS enabled with
// zero policies — see 0009's header), so this route is the table's only
// writer.
//
// `variant` is NEVER trusted as free text off the wire: it is checked
// against isHeadlineVariantId (app/landing-variants.ts, the shared
// client/server contract for this A/B test) before insert, so a caller can
// only ever attribute an impression to one of the two variants that
// actually exist, never an arbitrary string. `event` similarly must be the
// literal "impression" — the only event type this ticket instruments — with
// the same constraint held again at the database layer (0009's check
// constraint on event_type).
//
// No schema-validation library here, matching app/api/waitlist/route.ts's
// house rule (see that file's header for the full rationale): manual type
// narrowing plus explicit checks, not a new dependency for one route.
//
// No PII is accepted or stored: the allowed body has exactly two keys
// (event, variant), and the table (0009_landing_events.sql) has no email,
// name, or IP column — the caller's IP is used only as the in-memory
// rate-limit key and is never written to the database.

// A legitimate impression body ({event, variant}) is well under 100 bytes;
// 1KB is a generous cap that still rejects an oversized payload before it's
// ever parsed. Content-Length is a caller-supplied header and can lie
// (omitted, wrong, or spoofed) -- this is a cheap pre-parse gate for the
// common/honest case, NOT a guarantee, matching the caveat on
// app/api/waitlist/route.ts's MAX_BODY_BYTES.
const MAX_BODY_BYTES = 1024;
const IMPRESSION_EVENT = "impression";

const ALLOWED_BODY_KEYS = new Set(["event", "variant"]);

const GENERIC_SUCCESS = { ok: true } as const;
const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";
const INVALID_BODY_MESSAGE = "Invalid request body.";
const RATE_LIMITED_MESSAGE = "Too many requests. Try again in a few minutes.";

function callerIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstEntry = forwardedFor?.split(",")[0]?.trim();
  return firstEntry || "unknown";
}

/** Cheap pre-parse size gate -- see MAX_BODY_BYTES above for the
 * untrusted-header caveat. Missing or non-numeric Content-Length is treated
 * as "unknown," not "too large," so the happy path never regresses just
 * because a caller omitted the header. */
function isBodyTooLarge(request: Request): boolean {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES;
}

interface ParsedImpression {
  readonly variant: string;
}

type ValidationResult =
  | { readonly ok: true; readonly impression: ParsedImpression }
  | { readonly ok: false };

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false };
  }

  const record = body as Record<string, unknown>;
  const hasUnknownKey = Object.keys(record).some((key) => !ALLOWED_BODY_KEYS.has(key));
  if (hasUnknownKey) {
    return { ok: false };
  }

  const { event, variant } = record;
  if (event !== IMPRESSION_EVENT) {
    return { ok: false };
  }
  if (!isHeadlineVariantId(variant)) {
    return { ok: false };
  }

  return { ok: true, impression: { variant } };
}

export async function POST(request: Request): Promise<Response> {
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `landing-events:${callerIp(request)}`,
    LANDING_EVENT_RATE_LIMIT.limit,
    LANDING_EVENT_RATE_LIMIT.windowMs,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  if (isBodyTooLarge(request)) {
    return NextResponse.json({ ok: false, error: INVALID_BODY_MESSAGE }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: INVALID_BODY_MESSAGE }, { status: 400 });
  }

  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: INVALID_BODY_MESSAGE }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("landing_events").insert({
    variant: validated.impression.variant,
    event_type: IMPRESSION_EVENT,
  });

  if (error) {
    console.error("[landing-events] insert failed:", { code: error.code, message: error.message });
    return NextResponse.json({ ok: false, error: GENERIC_ERROR_MESSAGE }, { status: 500 });
  }

  return NextResponse.json(GENERIC_SUCCESS);
}
