// Sprint 12, Ticket 60. lib/billing/tenant-entitlement.ts is the one call a
// caller makes to ask "what is THIS tenant allowed to do right now?" — it
// joins the stored subscription row (service-role read) to the pure
// resolveEntitlement rule. DB-free here: the repository is mocked, exactly
// as tests/billing/billing-portal-action.spec.ts mocks it, because what is
// worth pinning is the wiring and the failure behaviour, not PostgREST.
//
// The failure case is the load-bearing one (orchestrator call, 2026-09-21):
// a billing read that fails must PROPAGATE, so the caller can fail closed
// with its own "couldn't check your plan" error — it must never be folded
// into "this tenant is on the free tier", which would silently paywall a
// paying customer whenever the database hiccups.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { mockFindByTenantId } = vi.hoisted(() => ({ mockFindByTenantId: vi.fn() }));

vi.mock("@/lib/billing/subscription-repository", () => ({ findByTenantId: mockFindByTenantId }));

const { getTenantEntitlement } = await import("@/lib/billing/tenant-entitlement");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-09-21T12:00:00.000Z");

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: TENANT_ID,
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

beforeEach(() => {
  mockFindByTenantId.mockResolvedValue(null);
});

afterEach(() => {
  mockFindByTenantId.mockReset();
});

describe("getTenantEntitlement", () => {
  it("reads the subscription for the tenant it was asked about, and no other", async () => {
    await getTenantEntitlement(TENANT_ID, NOW);

    expect(mockFindByTenantId).toHaveBeenCalledWith(TENANT_ID);
    expect(mockFindByTenantId).toHaveBeenCalledTimes(1);
  });

  it("returns the free entitlement for a tenant with no subscription row", async () => {
    const entitlement = await getTenantEntitlement(TENANT_ID, NOW);

    expect(entitlement.tier).toBe("free");
    expect(entitlement.source).toBe("free");
    expect(entitlement.isBlockedFromNewDeals).toBe(false);
  });

  it("resolves the stored subscription into its tier's cap", async () => {
    mockFindByTenantId.mockResolvedValue(subscription({ tierId: "pro" }));

    const entitlement = await getTenantEntitlement(TENANT_ID, NOW);

    expect(entitlement.tier).toBe("pro");
    expect(entitlement.maxActiveDeals).toBe(8);
  });

  it("evaluates the grace window against the `now` it was given, not a clock of its own", async () => {
    mockFindByTenantId.mockResolvedValue(
      subscription({ status: "past_due", pastDueSince: "2026-09-01T00:00:00.000Z" }),
    );

    const insideGrace = await getTenantEntitlement(TENANT_ID, new Date("2026-09-05T00:00:00.000Z"));
    const pastGrace = await getTenantEntitlement(TENANT_ID, new Date("2026-09-21T00:00:00.000Z"));

    expect(insideGrace.isBlockedFromNewDeals).toBe(false);
    expect(pastGrace.isBlockedFromNewDeals).toBe(true);
  });

  it("propagates a failed billing read instead of pretending the tenant is on the free tier", async () => {
    mockFindByTenantId.mockRejectedValue(new Error("Failed to read the tenant subscription: timeout"));

    await expect(getTenantEntitlement(TENANT_ID, NOW)).rejects.toThrow(/tenant subscription/);
  });
});
