// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Boundary validation
// for the webhook body: `unknown` in, a typed subscription event out (or an
// explicit "we don't handle this" / "this isn't a Paddle event" verdict).
// The route calls this only AFTER the signature check passes — validation
// here is about shape, never about authenticity.
//
// Hand-rolled guards rather than a schema library: this codebase has no
// such dependency (checked package.json — no zod), and every sibling route
// validates its body exactly this way (see app/api/waitlist/route.ts's own
// note on the same decision).
//
// Nothing in here confers authority. In particular `custom_data.checkoutRef`
// is carried through as an opaque string to be looked up server-side; a raw
// `tenantId` in custom_data is deliberately not read at all, because a
// signed-in user can put any tenant id they like into a checkout they open.

/** The five states Paddle actually reports for a subscription. */
export type PaddleSubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

const SUBSCRIPTION_STATUSES: readonly string[] = ["active", "trialing", "past_due", "paused", "canceled"];

/**
 * The subscription events we act on. Paddle sends one catch-all
 * `subscription.updated` for upgrade, downgrade, renewal and scheduled
 * change, so this list is short by design — the reducer diffs the payload
 * rather than branching per type.
 */
export const HANDLED_EVENT_TYPES: readonly string[] = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.trialing",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.canceled",
];

export interface PaddleScheduledChange {
  readonly action: string;
  readonly effectiveAt: string | null;
}

export interface PaddleSubscriptionPayload {
  readonly id: string;
  readonly status: PaddleSubscriptionStatus;
  readonly customerId: string | null;
  /** Every item's price id, in payload order — the tier is resolved from these. */
  readonly priceIds: readonly string[];
  readonly currentPeriodEndsAt: string | null;
  readonly scheduledChange: PaddleScheduledChange | null;
  /** Server-issued reference from billing_checkout_refs, or null. Opaque here. */
  readonly checkoutRef: string | null;
}

export interface PaddleSubscriptionEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly subscription: PaddleSubscriptionPayload;
}

export type ParsedPaddleEvent =
  | { readonly kind: "subscription"; readonly event: PaddleSubscriptionEvent }
  | { readonly kind: "unhandled"; readonly eventType: string }
  | { readonly kind: "invalid"; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isParsableTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/** `items: [{ price: { id } }]` — anything that isn't a well-formed entry is skipped, not guessed at. */
function readPriceIds(items: unknown): readonly string[] {
  if (!Array.isArray(items)) return [];
  const ids = items.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.price)) return [];
    const id = readString(item.price.id);
    return id ? [id] : [];
  });
  return Object.freeze(ids);
}

function readScheduledChange(value: unknown): PaddleScheduledChange | null {
  if (!isRecord(value)) return null;
  const action = readString(value.action);
  if (!action) return null;
  return Object.freeze({ action, effectiveAt: readString(value.effective_at) });
}

function readCurrentPeriodEndsAt(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return readString(value.ends_at);
}

/** Only `checkoutRef` is ever read out of custom_data — see the file header. */
function readCheckoutRef(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return readString(value.checkoutRef);
}

function parseSubscriptionPayload(
  data: unknown,
): { readonly ok: true; readonly payload: PaddleSubscriptionPayload } | { readonly ok: false; readonly reason: string } {
  if (!isRecord(data)) return { ok: false, reason: "missing_data" };

  const id = readString(data.id);
  if (!id) return { ok: false, reason: "missing_subscription_id" };

  const status = readString(data.status);
  if (!status || !SUBSCRIPTION_STATUSES.includes(status)) {
    return { ok: false, reason: "unknown_subscription_status" };
  }

  return {
    ok: true,
    payload: Object.freeze({
      id,
      status: status as PaddleSubscriptionStatus,
      customerId: readString(data.customer_id),
      priceIds: readPriceIds(data.items),
      currentPeriodEndsAt: readCurrentPeriodEndsAt(data.current_billing_period),
      scheduledChange: readScheduledChange(data.scheduled_change),
      checkoutRef: readCheckoutRef(data.custom_data),
    }),
  };
}

/**
 * Three-way verdict so the caller can answer each case correctly: process
 * it, 2xx-and-move-on (an event type we never subscribed to, or one Paddle
 * added later), or 400 (a body that is not a Paddle event at all).
 */
export function parsePaddleEvent(body: unknown): ParsedPaddleEvent {
  if (!isRecord(body)) return { kind: "invalid", reason: "body_not_an_object" };

  const eventType = readString(body.event_type);
  if (!eventType) return { kind: "invalid", reason: "missing_event_type" };
  if (!HANDLED_EVENT_TYPES.includes(eventType)) return { kind: "unhandled", eventType };

  const eventId = readString(body.event_id);
  if (!eventId) return { kind: "invalid", reason: "missing_event_id" };

  const occurredAt = readString(body.occurred_at);
  if (!occurredAt || !isParsableTimestamp(occurredAt)) {
    return { kind: "invalid", reason: "missing_occurred_at" };
  }

  const payload = parseSubscriptionPayload(body.data);
  if (!payload.ok) return { kind: "invalid", reason: payload.reason };

  return {
    kind: "subscription",
    event: Object.freeze({ eventId, eventType, occurredAt, subscription: payload.payload }),
  };
}
