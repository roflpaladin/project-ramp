// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Unit coverage for
// lib/billing/entitlement.ts: "given the stored subscription row and the
// current time, what is this tenant allowed to do right now?" Pure — no DB,
// no network, no clock of its own (every test passes `now` explicitly).
//
// The founder's rulings this file pins (2026-09-20, not re-litigated here):
//   - Free = 1 active deal / Starter 3 / Pro 8 / Advanced unlimited /
//     Enterprise unlimited (invoiced outside Paddle).
//   - Failed payment gets a 7-day grace; after it, the tenant cannot start
//     NEW deals, but existing deals (and every buyer) keep working.
//   - An invoice-paying customer's manual override beats everything and
//     never sees a paywall.
//   - A scheduled cancellation is NOT a cancellation.

import { describe, expect, it } from "vitest";

import { FREE_TIER_ACTIVE_DEALS } from "@/lib/billing/plans";
import { FREE_TIER_ID, LIVE_SUBSCRIPTION_STATUSES, PAST_DUE_GRACE_DAYS, hasLiveSubscription, resolveEntitlement } from "@/lib/billing/entitlement";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

describe("resolveEntitlement — no subscription at all", () => {
  it("falls back to the free tier when the tenant has no row", () => {
    // Act
    const entitlement = resolveEntitlement(null, NOW);

    // Assert
    expect(entitlement.tier).toBe(FREE_TIER_ID);
    expect(entitlement.source).toBe("free");
    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
    expect(entitlement.isInGrace).toBe(false);
    expect(entitlement.graceEndsAt).toBeNull();
  });
});

describe("resolveEntitlement — a live subscription", () => {
  it("grants the subscribed tier while the subscription is active", () => {
    // Act
    const entitlement = resolveEntitlement(subscription(), NOW);

    // Assert
    expect(entitlement.tier).toBe("pro");
    expect(entitlement.source).toBe("subscription");
    expect(entitlement.maxActiveDeals).toBe(8);
  });

  it("grants the subscribed tier during a trial", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ status: "trialing" }), NOW);

    // Assert
    expect(entitlement.tier).toBe("pro");
    expect(entitlement.source).toBe("subscription");
  });

  it("keeps entitlement while a cancellation is only SCHEDULED", () => {
    // Arrange — Paddle keeps status 'active' until the period actually ends.
    const scheduled = subscription({
      scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" },
    });

    // Act
    const entitlement = resolveEntitlement(scheduled, NOW);

    // Assert
    expect(entitlement.tier).toBe("pro");
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("drops to free once a cancellation has actually taken effect", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ status: "canceled" }), NOW);

    // Assert
    expect(entitlement.tier).toBe(FREE_TIER_ID);
    expect(entitlement.source).toBe("free");
    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
  });

  it("drops to free while the subscription is paused", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ status: "paused" }), NOW);

    // Assert
    expect(entitlement.tier).toBe(FREE_TIER_ID);
    expect(entitlement.source).toBe("free");
  });

  it("grants nothing beyond free for a tier id that is not in the plans config", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ tierId: "platinum" }), NOW);

    // Assert
    expect(entitlement.tier).toBe(FREE_TIER_ID);
    expect(entitlement.source).toBe("free");
    expect(entitlement.maxActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
  });
});

describe("resolveEntitlement — past due and the 7-day grace", () => {
  function pastDueSince(daysAgo: number): SubscriptionState {
    return subscription({
      status: "past_due",
      pastDueSince: new Date(NOW.getTime() - daysAgo * MS_PER_DAY).toISOString(),
    });
  }

  it("keeps the paid tier inside the grace window", () => {
    // Act
    const entitlement = resolveEntitlement(pastDueSince(PAST_DUE_GRACE_DAYS - 1), NOW);

    // Assert
    expect(entitlement.tier).toBe("pro");
    expect(entitlement.isInGrace).toBe(true);
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("is still in grace exactly ON the 7-day boundary (inclusive)", () => {
    // Act
    const entitlement = resolveEntitlement(pastDueSince(PAST_DUE_GRACE_DAYS), NOW);

    // Assert
    expect(entitlement.isInGrace).toBe(true);
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("is out of grace one millisecond past the boundary (exclusive)", () => {
    // Arrange
    const justPast = subscription({
      status: "past_due",
      pastDueSince: new Date(NOW.getTime() - PAST_DUE_GRACE_DAYS * MS_PER_DAY - 1).toISOString(),
    });

    // Act
    const entitlement = resolveEntitlement(justPast, NOW);

    // Assert
    expect(entitlement.isInGrace).toBe(false);
    expect(entitlement.canStartNewDeal(0)).toBe(false);
  });

  it("reports when the grace window ends", () => {
    // Arrange
    const row = pastDueSince(1);

    // Act
    const entitlement = resolveEntitlement(row, NOW);

    // Assert
    expect(entitlement.graceEndsAt).toBe(
      new Date(Date.parse(row.pastDueSince as string) + PAST_DUE_GRACE_DAYS * MS_PER_DAY).toISOString(),
    );
  });

  it("gives the tenant the benefit of the doubt when a past_due row has no anchor", () => {
    // Arrange — shouldn't happen (the reducer always stamps one); if it
    // does, it is our bug, not their non-payment.
    const anchorless = subscription({ status: "past_due", pastDueSince: null });

    // Act
    const entitlement = resolveEntitlement(anchorless, NOW);

    // Assert
    expect(entitlement.isInGrace).toBe(true);
    expect(entitlement.graceEndsAt).toBeNull();
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("does the same for an unparseable past_due anchor", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ status: "past_due", pastDueSince: "not-a-date" }), NOW);

    // Assert
    expect(entitlement.isInGrace).toBe(true);
    expect(entitlement.canStartNewDeal(0)).toBe(true);
  });

  it("blocks every NEW deal past the grace window but still reports the paid tier", () => {
    // Arrange — existing deals and buyers must keep working; only "start a
    // new deal" is blocked.
    const lapsed = pastDueSince(PAST_DUE_GRACE_DAYS + 3);

    // Act
    const entitlement = resolveEntitlement(lapsed, NOW);

    // Assert
    expect(entitlement.tier).toBe("pro");
    expect(entitlement.canStartNewDeal(0)).toBe(false);
    expect(entitlement.canStartNewDeal(100)).toBe(false);
  });
});

describe("resolveEntitlement — manual entitlement override", () => {
  it("beats an absent subscription status entirely", () => {
    // Arrange
    const invoiced = subscription({ status: "canceled", manualEntitlementTier: "enterprise" });

    // Act
    const entitlement = resolveEntitlement(invoiced, NOW);

    // Assert
    expect(entitlement.tier).toBe("enterprise");
    expect(entitlement.source).toBe("manual");
    expect(entitlement.maxActiveDeals).toBeNull();
    expect(entitlement.canStartNewDeal(500)).toBe(true);
  });

  it("beats a past-due subscription that is long out of grace", () => {
    // Arrange
    const invoiced = subscription({
      status: "past_due",
      pastDueSince: new Date(NOW.getTime() - 90 * MS_PER_DAY).toISOString(),
      manualEntitlementTier: "advanced",
    });

    // Act
    const entitlement = resolveEntitlement(invoiced, NOW);

    // Assert
    expect(entitlement.source).toBe("manual");
    expect(entitlement.isInGrace).toBe(false);
    expect(entitlement.canStartNewDeal(1000)).toBe(true);
  });

  it("does not grant access for a manual tier id that is not in the plans config", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ manualEntitlementTier: "vip" }), NOW);

    // Assert
    expect(entitlement.tier).toBe(FREE_TIER_ID);
    expect(entitlement.source).toBe("free");
  });
});

describe("resolveEntitlement — canStartNewDeal at each tier limit", () => {
  const CASES: readonly { tierId: string; limit: number }[] = [
    { tierId: FREE_TIER_ID, limit: FREE_TIER_ACTIVE_DEALS },
    { tierId: "starter", limit: 3 },
    { tierId: "pro", limit: 8 },
  ];

  for (const { tierId, limit } of CASES) {
    it(`allows a new deal below the ${tierId} limit of ${limit} and blocks it at or above`, () => {
      // Arrange
      const row = tierId === FREE_TIER_ID ? null : subscription({ tierId });

      // Act
      const entitlement = resolveEntitlement(row, NOW);

      // Assert
      expect(entitlement.maxActiveDeals).toBe(limit);
      expect(entitlement.canStartNewDeal(0)).toBe(true);
      expect(entitlement.canStartNewDeal(limit - 1)).toBe(true);
      expect(entitlement.canStartNewDeal(limit)).toBe(false);
      expect(entitlement.canStartNewDeal(limit + 1)).toBe(false);
    });
  }

  it("never blocks a new deal on an unlimited tier", () => {
    // Act
    const entitlement = resolveEntitlement(subscription({ tierId: "advanced" }), NOW);

    // Assert
    expect(entitlement.maxActiveDeals).toBeNull();
    expect(entitlement.canStartNewDeal(0)).toBe(true);
    expect(entitlement.canStartNewDeal(10_000)).toBe(true);
  });
});

// T59 slice 2 — used by app/pricing/checkout-actions.ts (refuse a second
// checkout) and app/pricing/page.tsx (current-plan/change-plan rendering).
// Deliberately broader than "is this tenant entitled to a paid tier right
// now": a PAUSED subscription already resolves to the free tier above, but
// is still a live Paddle record a tenant must manage in the portal.
describe("hasLiveSubscription", () => {
  it("is false when the tenant has never subscribed", () => {
    expect(hasLiveSubscription(null)).toBe(false);
  });

  for (const status of LIVE_SUBSCRIPTION_STATUSES) {
    it(`is true for status "${status}"`, () => {
      expect(hasLiveSubscription(subscription({ status }))).toBe(true);
    });
  }

  it("is false for a canceled subscription", () => {
    expect(hasLiveSubscription(subscription({ status: "canceled" }))).toBe(false);
  });
});
