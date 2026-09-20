// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The pure core of
// billing: given the subscription state we have stored and one verified
// Paddle event, what is the next state? No DB, no network, no clock, no
// env read of its own (the tier resolver is injectable — see
// ApplyBillingEventOptions), so every rule below is testable in isolation
// and the route stays a thin shell around it.
//
// Two properties this file exists to guarantee:
//
//  1. ORDER SAFETY. Webhooks arrive out of order and get retried. Every
//     event carries `occurred_at`; an event that is not strictly newer than
//     the last one we applied is `stale` and changes nothing. That makes a
//     late-delivered "upgrade" incapable of undoing the renewal that
//     followed it. (Exact duplicates — same event_id — are stopped one
//     layer up, by the primary key on paddle_webhook_events; they would
//     also land here as `stale`.)
//
//  2. NO UNEARNED ACCESS. The tier comes from the payload's price ID
//     resolved through lib/billing/plans.ts. A price ID we do not sell
//     resolves to nothing, and the event is `ignored` with a reason rather
//     than quietly granting a plan.
//
// Everything returned is a new frozen object; the state passed in is never
// mutated.

import { resolveTierForPriceId, type BillingCycle, type PriceIdMatch } from "./plans";
import type { PaddleScheduledChange, PaddleSubscriptionEvent, PaddleSubscriptionStatus } from "./paddle-event";

/** One row of tenant_subscriptions (0014_billing.sql), in app terms. */
export interface SubscriptionState {
  readonly tenantId: string;
  readonly paddleCustomerId: string | null;
  readonly paddleSubscriptionId: string;
  readonly tierId: string;
  readonly billingCycle: BillingCycle | null;
  readonly status: PaddleSubscriptionStatus;
  readonly currentPeriodEndsAt: string | null;
  readonly scheduledChange: PaddleScheduledChange | null;
  /** When the subscription FIRST went past due — the grace window's anchor. */
  readonly pastDueSince: string | null;
  /** The out-of-order guard; see property 1 in the file header. */
  readonly lastEventOccurredAt: string | null;
  /** Set by hand for invoice-paying customers; never written by a webhook. */
  readonly manualEntitlementTier: string | null;
  readonly manualEntitlementNote: string | null;
}

/**
 * `duplicate` is produced by the idempotency layer (the event_id primary
 * key), not by this function — it lives in the same union so the route, the
 * paddle_webhook_events row and this reducer all speak one vocabulary.
 */
export type BillingEventOutcome = "applied" | "duplicate" | "stale" | "ignored";

export interface BillingEventResult {
  readonly state: SubscriptionState | null;
  readonly outcome: BillingEventOutcome;
  /** Why an event was ignored — persisted for support, never shown to a user. */
  readonly reason: string | null;
}

export type TierResolver = (priceId: string) => PriceIdMatch | null;

export interface ApplyBillingEventOptions {
  /**
   * Resolved by the CALLER, never by the payload: either the tenant on the
   * existing row or the tenant behind a server-issued checkout ref. Only
   * used when `state` is null (a tenant's first subscription event).
   */
  readonly tenantId: string;
  /** Defaults to the plans config; injected in tests so no env var decides an assertion. */
  readonly resolveTier?: TierResolver;
}

/**
 * STRICTLY older only. Paddle routinely emits several events with an
 * identical occurred_at (subscription.created and subscription.activated
 * for the same checkout, for instance) — rejecting equal timestamps would
 * drop the activation. Genuine redeliveries are caught by the event_id
 * primary key, not here, so this guard only has to catch out-of-ORDER
 * delivery. The same comparison is enforced in SQL (0014's
 * apply_tenant_subscription_event), which is the authority under
 * concurrency; this check just avoids a pointless round trip.
 */
function isStale(state: SubscriptionState | null, event: PaddleSubscriptionEvent): boolean {
  if (!state?.lastEventOccurredAt) return false;
  return Date.parse(event.occurredAt) < Date.parse(state.lastEventOccurredAt);
}

/** First price ID that maps to a tier we actually sell. */
function resolveTierFromPrices(priceIds: readonly string[], resolveTier: TierResolver): PriceIdMatch | null {
  for (const priceId of priceIds) {
    const match = resolveTier(priceId);
    if (match) return match;
  }
  return null;
}

/**
 * past_due_since is an ANCHOR, not a mirror of the status: it is stamped the
 * first time a subscription goes past due (so the 7-day grace is measured
 * from the real start), left alone while it stays past due, and cleared the
 * moment it recovers.
 */
function nextPastDueSince(
  state: SubscriptionState | null,
  status: PaddleSubscriptionStatus,
  occurredAt: string,
): string | null {
  if (status !== "past_due") return null;
  if (state?.status === "past_due" && state.pastDueSince) return state.pastDueSince;
  return occurredAt;
}

function ignored(state: SubscriptionState | null, reason: string): BillingEventResult {
  return Object.freeze({ state, outcome: "ignored" as const, reason });
}

/**
 * Diffs the event payload onto the stored state. Deliberately NOT a switch
 * on event type: Paddle sends one catch-all `subscription.updated` for
 * upgrade, downgrade, renewal and scheduled change, so the payload — not
 * the event name — is the truth. The event name only tells us the payload
 * is worth looking at.
 */
export function applyBillingEvent(
  state: SubscriptionState | null,
  event: PaddleSubscriptionEvent,
  options: ApplyBillingEventOptions,
): BillingEventResult {
  const { subscription } = event;

  if (state && state.paddleSubscriptionId !== subscription.id) {
    return ignored(state, "subscription_id_mismatch");
  }

  if (isStale(state, event)) {
    return Object.freeze({ state, outcome: "stale" as const, reason: null });
  }

  if (subscription.priceIds.length === 0) {
    return ignored(state, "missing_price_id");
  }

  const tier = resolveTierFromPrices(subscription.priceIds, options.resolveTier ?? resolveTierForPriceId);
  if (!tier) {
    return ignored(state, "unknown_price_id");
  }

  const nextState: SubscriptionState = Object.freeze({
    tenantId: state?.tenantId ?? options.tenantId,
    paddleCustomerId: subscription.customerId ?? state?.paddleCustomerId ?? null,
    paddleSubscriptionId: subscription.id,
    tierId: tier.tierId,
    billingCycle: tier.billingCycle,
    status: subscription.status,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt ?? state?.currentPeriodEndsAt ?? null,
    scheduledChange: subscription.scheduledChange,
    pastDueSince: nextPastDueSince(state, subscription.status, event.occurredAt),
    lastEventOccurredAt: event.occurredAt,
    // Manual overrides are a human decision (invoice-paying customers) and
    // survive every webhook — a Paddle event must never clear one.
    manualEntitlementTier: state?.manualEntitlementTier ?? null,
    manualEntitlementNote: state?.manualEntitlementNote ?? null,
  });

  return Object.freeze({ state: nextState, outcome: "applied" as const, reason: null });
}
