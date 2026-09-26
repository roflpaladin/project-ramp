// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The one place that
// answers "what is this tenant allowed to do right now?". Pure: a stored
// subscription row (or null) plus `now` in, an entitlement out. No DB, no
// clock of its own — the caller passes `now` so this is testable at the
// grace boundary to the millisecond.
//
// Founder rulings encoded here (2026-09-20):
//   - Tiers are flat, with an active-deal cap each; caps live in
//     lib/billing/plans.ts (maxActiveDealsForTier), never duplicated here.
//   - A failed payment gets a 7-day grace. After it, the tenant cannot
//     start NEW deals — but existing deals keep working and BUYERS ARE
//     NEVER LOCKED OUT. Nothing in this module can express "lock a buyer
//     out"; the only thing it can withhold is `canStartNewDeal`.
//   - Invoice-paying customers (Enterprise, design partners) get a manual
//     entitlement override, which beats everything and never paywalls.
//   - A scheduled cancellation is NOT a cancellation: Paddle keeps the
//     status `active` until the period actually ends, and so do we — this
//     module never reads scheduledChange at all.

import { FREE_TIER_ACTIVE_DEALS, maxActiveDealsForTier } from "./plans";
import type { PaddleSubscriptionStatus } from "./paddle-event";
import type { SubscriptionState } from "./subscription-reducer";

/** Not a tier in TIER_DEFINITIONS — the absence of a paid plan. */
export const FREE_TIER_ID = "free";

/** Founder ruling: seven days from the first past_due event. */
export const PAST_DUE_GRACE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type EntitlementSource = "free" | "subscription" | "manual";

export interface Entitlement {
  readonly tier: string;
  /** null = unlimited. */
  readonly maxActiveDeals: number | null;
  readonly source: EntitlementSource;
  readonly isInGrace: boolean;
  /** ISO instant the 7-day grace ends, when one is running. */
  readonly graceEndsAt: string | null;
  /**
   * T60 (additive). Past-due-beyond-grace: every NEW deal is refused while
   * this is true, whatever the count. It was already computed here before
   * T60 but never exposed, so the go-live gate had no way to fail closed on
   * it without re-deriving the grace window for itself. Distinct from
   * `canStartNewDeal(n) === false`, which usually just means "at the cap" —
   * the two produce different copy and a different next step.
   */
  readonly isBlockedFromNewDeals: boolean;
  canStartNewDeal(activeCount: number): boolean;
}

interface EntitlementInput {
  readonly tier: string;
  readonly maxActiveDeals: number | null;
  readonly source: EntitlementSource;
  readonly isInGrace?: boolean;
  readonly graceEndsAt?: string | null;
  /** Past-due-beyond-grace: keep the plan visible, refuse every new deal. */
  readonly isBlockedFromNewDeals?: boolean;
}

function buildEntitlement(input: EntitlementInput): Entitlement {
  const { maxActiveDeals, isBlockedFromNewDeals = false } = input;

  return Object.freeze({
    tier: input.tier,
    maxActiveDeals,
    source: input.source,
    isInGrace: input.isInGrace ?? false,
    graceEndsAt: input.graceEndsAt ?? null,
    isBlockedFromNewDeals,
    canStartNewDeal(activeCount: number): boolean {
      if (isBlockedFromNewDeals) return false;
      if (maxActiveDeals === null) return true;
      return activeCount < maxActiveDeals;
    },
  });
}

function freeEntitlement(): Entitlement {
  return buildEntitlement({ tier: FREE_TIER_ID, maxActiveDeals: FREE_TIER_ACTIVE_DEALS, source: "free" });
}

/**
 * `undefined` from maxActiveDealsForTier means the id is not a tier we sell
 * — a stale row, a renamed tier, or a value somebody typed by hand. It
 * grants nothing: same rule as an unknown price ID in the reducer.
 */
function tierEntitlementOrFree(tierId: string, source: EntitlementSource, extra: Partial<EntitlementInput> = {}) {
  const maxActiveDeals = maxActiveDealsForTier(tierId);
  if (maxActiveDeals === undefined) return freeEntitlement();
  return buildEntitlement({ tier: tierId, maxActiveDeals, source, ...extra });
}

interface GraceWindow {
  readonly isInGrace: boolean;
  readonly graceEndsAt: string | null;
}

/**
 * Inclusive at the boundary: a tenant exactly PAST_DUE_GRACE_DAYS past the
 * first failed payment is still in grace; one millisecond later is not.
 *
 * A past_due row with no anchor shouldn't exist (the reducer always stamps
 * one), but if it does, the tenant gets the benefit of the doubt rather
 * than an instant block — a missing timestamp is our bug, not their
 * non-payment.
 */
function graceWindowFor(pastDueSince: string | null, now: Date): GraceWindow {
  if (!pastDueSince) return { isInGrace: true, graceEndsAt: null };

  const startedAtMs = Date.parse(pastDueSince);
  if (!Number.isFinite(startedAtMs)) return { isInGrace: true, graceEndsAt: null };

  const endsAtMs = startedAtMs + PAST_DUE_GRACE_DAYS * MS_PER_DAY;
  return { isInGrace: now.getTime() <= endsAtMs, graceEndsAt: new Date(endsAtMs).toISOString() };
}

export function resolveEntitlement(subscription: SubscriptionState | null, now: Date): Entitlement {
  if (!subscription) return freeEntitlement();

  if (subscription.manualEntitlementTier) {
    return tierEntitlementOrFree(subscription.manualEntitlementTier, "manual");
  }

  if (subscription.status === "active" || subscription.status === "trialing") {
    return tierEntitlementOrFree(subscription.tierId, "subscription");
  }

  if (subscription.status === "past_due") {
    const { isInGrace, graceEndsAt } = graceWindowFor(subscription.pastDueSince, now);
    return tierEntitlementOrFree(subscription.tierId, "subscription", {
      isInGrace,
      graceEndsAt,
      isBlockedFromNewDeals: !isInGrace,
    });
  }

  // paused or canceled — back to free. Existing deals are untouched by this
  // (nothing here deletes or hides anything); only new ones are capped.
  return freeEntitlement();
}

/**
 * T59 slice 2. Paddle subscription statuses that mean "there is a real,
 * still-open subscription record in Paddle" — used by the checkout lane
 * (app/pricing/checkout-actions.ts must never let a tenant open a SECOND
 * Paddle checkout while one of these is true) and by /pricing's own
 * current-plan / change-plan rendering. Deliberately broader than "the
 * tenant is currently entitled to a paid tier": resolveEntitlement above
 * already sends 'paused' back to the free tier, but a paused subscription is
 * still a live Paddle record the tenant must manage in Paddle's portal, not
 * restart via a second checkout.
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly PaddleSubscriptionStatus[] = Object.freeze([
  "active",
  "trialing",
  "past_due",
  "paused",
]);

export function hasLiveSubscription(subscription: SubscriptionState | null): boolean {
  return subscription !== null && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
}
