// Sprint 12, Ticket 60 (active-deal limit). The entitlement surface the
// go-live gate actually reads, pinned tier by tier: `maxActiveDeals`,
// `canStartNewDeal(n)` at each boundary, and the NEW `isBlockedFromNewDeals`
// field (previously computed inside resolveEntitlement but never exposed on
// the Entitlement interface, so no caller could fail closed on it).
//
// Deliberately NOT a second copy of tests/billing/entitlement.spec.ts: the
// grace-window arithmetic, the scheduled-cancellation rule and the
// unknown-tier fallback are proven there. What is proven HERE is the
// decision the paywall makes out of those values — including the founder
// ruling that an invoice customer (manual entitlement) NEVER meets a limit,
// no matter how many deals they are running or what Paddle thinks of their
// last payment.
//
// Pure: no DB, no clock of its own, no mocks.

import { describe, expect, it } from "vitest";

import { FREE_TIER_ACTIVE_DEALS } from "@/lib/billing/plans";
import { resolveEntitlement } from "@/lib/billing/entitlement";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const NOW = new Date("2026-09-21T12:00:00.000Z");

/** Long out of the 7-day grace at NOW. */
const LONG_PAST_DUE_SINCE = "2026-08-01T00:00:00.000Z";

/** More deals than any paid tier's cap — an invoice customer's real shape. */
const MANY_ACTIVE_DEALS = 50;

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    paddleCustomerId: "ctm_1",
    paddleSubscriptionId: "sub_1",
    tierId: "pro",
    billingCycle: "month",
    status: "active",
    currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
    scheduledChange: null,
    pastDueSince: null,
    lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
    manualEntitlementTier: null,
    manualEntitlementNote: null,
    ...overrides,
  };
}

describe("active-deal caps per tier", () => {
  it.each([
    ["starter", 3],
    ["pro", 8],
  ])("caps %s at %i active deals and refuses the one past it", (tierId, cap) => {
    // Arrange
    const entitlement = resolveEntitlement(subscription({ tierId }), NOW);

    // Act / Assert
    expect(entitlement.maxActiveDeals).toBe(cap);
    expect(entitlement.canStartNewDeal(cap - 1)).toBe(true);
    expect(entitlement.canStartNewDeal(cap)).toBe(false);
    expect(entitlement.canStartNewDeal(cap + 1)).toBe(false);
  });

  it.each(["advanced", "enterprise"])("never caps %s — null means unlimited", (tierId) => {
    const entitlement = resolveEntitlement(subscription({ tierId }), NOW);

    expect(entitlement.maxActiveDeals).toBeNull();
    expect(entitlement.canStartNewDeal(MANY_ACTIVE_DEALS)).toBe(true);
  });

  it("caps a tenant with no subscription at the free tier's single deal", () => {
    const entitlement = resolveEntitlement(null, NOW);

    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
    expect(entitlement.canStartNewDeal(0)).toBe(true);
    expect(entitlement.canStartNewDeal(FREE_TIER_ACTIVE_DEALS)).toBe(false);
  });

  it.each(["paused", "canceled"] as const)("falls back to the free cap while %s", (status) => {
    const entitlement = resolveEntitlement(subscription({ status, tierId: "pro" }), NOW);

    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
    expect(entitlement.canStartNewDeal(FREE_TIER_ACTIVE_DEALS)).toBe(false);
  });

  it("keeps the paid cap while a cancellation is only SCHEDULED", () => {
    const entitlement = resolveEntitlement(
      subscription({ tierId: "pro", scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" } }),
      NOW,
    );

    expect(entitlement.maxActiveDeals).toBe(8);
  });

  it("grants only the free cap for a tier id that is not in the plans config", () => {
    const entitlement = resolveEntitlement(subscription({ tierId: "legacy-unlimited" }), NOW);

    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
  });
});

describe("isBlockedFromNewDeals — the field the go-live gate fails closed on", () => {
  it("is exposed on a plain free entitlement and is false", () => {
    // The field existing AT ALL is the point: before T60 it was computed
    // inside resolveEntitlement and dropped on the floor, so no caller could
    // read it without re-deriving the grace window itself.
    expect(resolveEntitlement(null, NOW).isBlockedFromNewDeals).toBe(false);
  });

  it("is false for a healthy paid subscription", () => {
    expect(resolveEntitlement(subscription({ tierId: "pro" }), NOW).isBlockedFromNewDeals).toBe(false);
  });

  it("is false INSIDE the 7-day grace, so a failed payment does not paywall immediately", () => {
    const entitlement = resolveEntitlement(
      subscription({ status: "past_due", pastDueSince: "2026-09-20T12:00:00.000Z" }),
      NOW,
    );

    expect(entitlement.isInGrace).toBe(true);
    expect(entitlement.isBlockedFromNewDeals).toBe(false);
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("is true once the grace has ended, and then no count is small enough", () => {
    const entitlement = resolveEntitlement(
      subscription({ status: "past_due", pastDueSince: LONG_PAST_DUE_SINCE }),
      NOW,
    );

    expect(entitlement.isBlockedFromNewDeals).toBe(true);
    expect(entitlement.canStartNewDeal(0)).toBe(false);
  });
});

describe("invoice customers (manual entitlement) never meet the limit", () => {
  it("stays unlimited at fifty active deals", () => {
    const entitlement = resolveEntitlement(
      subscription({ manualEntitlementTier: "enterprise", manualEntitlementNote: "Design partner" }),
      NOW,
    );

    expect(entitlement.source).toBe("manual");
    expect(entitlement.maxActiveDeals).toBeNull();
    expect(entitlement.canStartNewDeal(MANY_ACTIVE_DEALS)).toBe(true);
  });

  it("is never blocked by a Paddle payment that has been past due for weeks", () => {
    const entitlement = resolveEntitlement(
      subscription({
        status: "past_due",
        pastDueSince: LONG_PAST_DUE_SINCE,
        manualEntitlementTier: "enterprise",
      }),
      NOW,
    );

    expect(entitlement.isBlockedFromNewDeals).toBe(false);
    expect(entitlement.canStartNewDeal(MANY_ACTIVE_DEALS)).toBe(true);
  });

  it("is never blocked by a canceled Paddle subscription either", () => {
    const entitlement = resolveEntitlement(
      subscription({ status: "canceled", manualEntitlementTier: "advanced" }),
      NOW,
    );

    expect(entitlement.maxActiveDeals).toBeNull();
    expect(entitlement.canStartNewDeal(MANY_ACTIVE_DEALS)).toBe(true);
  });
});
