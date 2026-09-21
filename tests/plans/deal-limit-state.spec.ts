// Sprint 12, Ticket 60 — the pure deal-limit builder that the seller
// dashboard renders its upgrade wall from
// (app/admin/workspaces/[id]/deal-limit-state.ts).
//
// DB-free and React-free. app/admin/workspaces/[id]/page.tsx performs the two
// reads (getTenantEntitlement, countActiveDealsForTenant), catches each one
// separately, and hands whatever survived to buildDealLimitState — so every
// degraded combination this file asserts is a combination that page can
// actually produce.
//
// The load-bearing rule here: an infrastructure failure must NEVER render as
// the upgrade wall. "We could not check" and "you are at your limit" are
// different sentences with different next steps, and only one of them is
// about money.

import { describe, expect, it } from "vitest";

import { resolveEntitlement, type Entitlement } from "@/lib/billing/entitlement";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";
import {
  buildDealLimitState,
  dealLimitReasonForErrorCode,
  dealLimitReasonForState,
} from "@/app/admin/workspaces/[id]/deal-limit-state";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: TENANT_ID,
    paddleCustomerId: "ctm_1",
    paddleSubscriptionId: "sub_1",
    tierId: "starter",
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

const NOW = new Date("2026-09-21T12:00:00.000Z");

function entitlementFor(overrides: Partial<SubscriptionState> | null): Entitlement {
  return resolveEntitlement(overrides === null ? null : subscription(overrides), NOW);
}

describe("buildDealLimitState — the billing read failed", () => {
  it("is unknown, and is neither at the limit nor blocked", () => {
    // Arrange: page.tsx caught the getTenantEntitlement throw and passed null.
    // Act
    const state = buildDealLimitState(null, 2);

    // Assert
    expect(state.isUnknown).toBe(true);
    expect(state.isAtLimit).toBe(false);
    expect(state.isBlockedFromNewDeals).toBe(false);
  });
});

describe("buildDealLimitState — the free tier", () => {
  it("is at the limit once the single free active deal is used", () => {
    const state = buildDealLimitState(entitlementFor(null), 1);

    expect(state).toEqual({
      activeCount: 1,
      maxActiveDeals: 1,
      isAtLimit: true,
      isBlockedFromNewDeals: false,
      isUnknown: false,
    });
  });

  it("is not at the limit with room to spare", () => {
    const state = buildDealLimitState(entitlementFor(null), 0);

    expect(state.isAtLimit).toBe(false);
    expect(state.activeCount).toBe(0);
    expect(state.maxActiveDeals).toBe(1);
  });

  it("is at the limit when the count has somehow overshot the cap", () => {
    const state = buildDealLimitState(entitlementFor(null), 9);

    expect(state.isAtLimit).toBe(true);
  });
});

describe("buildDealLimitState — a paid tier", () => {
  it("is not at the limit one deal below the cap", () => {
    const entitlement = entitlementFor({ tierId: "starter" });
    const cap = entitlement.maxActiveDeals ?? 0;

    const state = buildDealLimitState(entitlement, cap - 1);

    expect(state.isAtLimit).toBe(false);
  });

  it("is at the limit exactly at the cap", () => {
    const entitlement = entitlementFor({ tierId: "starter" });
    const cap = entitlement.maxActiveDeals ?? 0;

    const state = buildDealLimitState(entitlement, cap);

    expect(state.isAtLimit).toBe(true);
  });

  it("is never at the limit on an uncapped tier", () => {
    const entitlement = entitlementFor({ tierId: "advanced" });

    const state = buildDealLimitState(entitlement, 500);

    expect(entitlement.maxActiveDeals).toBeNull();
    expect(state.isAtLimit).toBe(false);
    expect(state.maxActiveDeals).toBeNull();
    expect(state.isUnknown).toBe(false);
  });
});

describe("buildDealLimitState — the count read failed", () => {
  it("is unknown when a cap exists but nothing could be counted", () => {
    const state = buildDealLimitState(entitlementFor(null), null);

    expect(state.isUnknown).toBe(true);
    expect(state.isAtLimit).toBe(false);
  });

  it("is still decisive for a past-due tenant, because the count cannot change that answer", () => {
    const entitlement = entitlementFor({ status: "past_due", pastDueSince: "2020-01-01T00:00:00.000Z" });

    const state = buildDealLimitState(entitlement, null);

    expect(entitlement.isBlockedFromNewDeals).toBe(true);
    expect(state.isBlockedFromNewDeals).toBe(true);
    expect(state.isUnknown).toBe(false);
  });
});

describe("buildDealLimitState — payment failed", () => {
  it("is not blocked while the tenant is still inside the 7-day grace", () => {
    const entitlement = entitlementFor({ status: "past_due", pastDueSince: NOW.toISOString() });

    const state = buildDealLimitState(entitlement, 0);

    expect(state.isBlockedFromNewDeals).toBe(false);
  });

  it("is blocked past grace, and reports that rather than 'at your limit'", () => {
    const entitlement = entitlementFor({ status: "past_due", pastDueSince: "2020-01-01T00:00:00.000Z" });

    const state = buildDealLimitState(entitlement, 0);

    expect(state.isBlockedFromNewDeals).toBe(true);
    expect(state.isAtLimit).toBe(false);
  });
});

describe("buildDealLimitState — an invoiced (manual) tenant", () => {
  it("is never walled and never capped, whatever tier the override names", () => {
    const entitlement = entitlementFor({ manualEntitlementTier: "starter", status: "past_due", pastDueSince: "2020-01-01T00:00:00.000Z" });

    const state = buildDealLimitState(entitlement, 500);

    expect(entitlement.source).toBe("manual");
    expect(state.maxActiveDeals).toBeNull();
    expect(state.isAtLimit).toBe(false);
    expect(state.isBlockedFromNewDeals).toBe(false);
    expect(state.isUnknown).toBe(false);
  });
});

describe("buildDealLimitState — immutability", () => {
  it("returns a frozen object, so no caller can edit the seller's entitlement in place", () => {
    const state = buildDealLimitState(entitlementFor(null), 0);

    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe("dealLimitReasonForState", () => {
  it("prefers the payment problem over the count when both could apply", () => {
    const entitlement = entitlementFor({ status: "past_due", pastDueSince: "2020-01-01T00:00:00.000Z" });

    expect(dealLimitReasonForState(buildDealLimitState(entitlement, 99))).toBe("past-due");
  });

  it("reads 'limit' for an ordinary tenant at their cap", () => {
    expect(dealLimitReasonForState(buildDealLimitState(entitlementFor(null), 1))).toBe("limit");
  });

  it("reads 'unknown' when nothing could be checked", () => {
    expect(dealLimitReasonForState(buildDealLimitState(null, null))).toBe("unknown");
  });

  it("reads null — no notice at all — for a tenant with room", () => {
    expect(dealLimitReasonForState(buildDealLimitState(entitlementFor(null), 0))).toBeNull();
  });
});

describe("dealLimitReasonForErrorCode", () => {
  it("maps the three T60 billing codes onto the same three notices the page renders", () => {
    expect(dealLimitReasonForErrorCode("DEAL_LIMIT_REACHED")).toBe("limit");
    expect(dealLimitReasonForErrorCode("BILLING_PAST_DUE")).toBe("past-due");
    expect(dealLimitReasonForErrorCode("BILLING_CHECK_FAILED")).toBe("unknown");
  });

  it("maps every other plan error to null, so ordinary failures keep their own inline message", () => {
    expect(dealLimitReasonForErrorCode("NOT_FOUND")).toBeNull();
    expect(dealLimitReasonForErrorCode("UNAUTHENTICATED")).toBeNull();
    expect(dealLimitReasonForErrorCode("PLAN_CLOSED")).toBeNull();
    expect(dealLimitReasonForErrorCode("UNKNOWN_ERROR")).toBeNull();
  });

  it("maps the locked sample deal to null — it is NOT a paywall, and upgrading would change nothing", () => {
    expect(dealLimitReasonForErrorCode("SAMPLE_DEAL_LOCKED")).toBeNull();
  });
});
