// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Coverage for
// app/pricing/checkout-actions.ts, the server action that decides WHICH
// TENANT a Paddle payment will be credited to. DB-free: requireSeller and
// the repository are mocked (the real rate limiter is not — same split as
// tests/api/waitlist.spec.ts).
//
// The property under test is the whole reason the action exists: the tenant
// comes from the seller's own session, never from anything a caller can
// supply. The action takes no arguments at all, so there is nothing to
// tamper with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_REF_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { mockRequireSeller, mockCreateCheckoutRef, mockFindByTenantId } = vi.hoisted(() => ({
  mockRequireSeller: vi.fn(),
  mockCreateCheckoutRef: vi.fn(),
  mockFindByTenantId: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));
vi.mock("@/lib/billing/subscription-repository", () => ({
  createCheckoutRef: mockCreateCheckoutRef,
  findByTenantId: mockFindByTenantId,
}));

const { issueCheckoutRefAction } = await import("@/app/pricing/checkout-actions");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

function signedInSeller(overrides: Record<string, unknown> = {}) {
  return { client: {}, userId: USER_ID, email: "seller@example.com", tenantId: TENANT_ID, ...overrides };
}

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
  resetRateLimiterForTests();
  mockRequireSeller.mockResolvedValue(signedInSeller());
  mockFindByTenantId.mockResolvedValue(null);
  mockCreateCheckoutRef.mockResolvedValue({ id: "ref_abc", expiresAt: "2026-09-20T13:00:00.000Z" });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockRequireSeller.mockReset();
  mockCreateCheckoutRef.mockReset();
  mockFindByTenantId.mockReset();
});

describe("issueCheckoutRefAction", () => {
  it("issues a reference bound to the signed-in seller's OWN tenant", async () => {
    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result).toEqual({ ok: true, checkoutRef: "ref_abc" });
    expect(mockCreateCheckoutRef).toHaveBeenCalledWith({ tenantId: TENANT_ID, userId: USER_ID });
  });

  it("issues nothing for a caller with no session", async () => {
    // Arrange
    mockRequireSeller.mockResolvedValue(null);

    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result.ok).toBe(false);
    expect(mockCreateCheckoutRef).not.toHaveBeenCalled();
  });

  it("issues nothing for a seller whose account has no tenant claim", async () => {
    // Arrange
    mockRequireSeller.mockResolvedValue(signedInSeller({ tenantId: null }));

    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result.ok).toBe(false);
    expect(mockCreateCheckoutRef).not.toHaveBeenCalled();
  });

  it("stops issuing references once the per-seller budget is spent", async () => {
    // Arrange
    for (let attempt = 0; attempt < CHECKOUT_REF_RATE_LIMIT.limit; attempt += 1) {
      await issueCheckoutRefAction();
    }

    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result.ok).toBe(false);
    expect(mockCreateCheckoutRef).toHaveBeenCalledTimes(CHECKOUT_REF_RATE_LIMIT.limit);
  });

  it("refuses server-side when the tenant already has a live Paddle subscription (T59 slice 2 — defense in depth)", async () => {
    // Arrange — the UI (pricing-tiers.tsx) already hides Subscribe for a
    // live subscription, but this action is the real guard: a caller that
    // skips the UI entirely must still be refused.
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/already have a subscription/i);
    expect(mockCreateCheckoutRef).not.toHaveBeenCalled();
  });

  it.each(["trialing", "past_due", "paused"] as const)(
    "refuses when the live subscription's status is %s",
    async (status) => {
      mockFindByTenantId.mockResolvedValue(subscription({ status }));

      const result = await issueCheckoutRefAction();

      expect(result.ok).toBe(false);
      expect(mockCreateCheckoutRef).not.toHaveBeenCalled();
    },
  );

  it("allows a new checkout when the stored subscription is canceled", async () => {
    mockFindByTenantId.mockResolvedValue(subscription({ status: "canceled" }));

    const result = await issueCheckoutRefAction();

    expect(result).toEqual({ ok: true, checkoutRef: "ref_abc" });
  });

  it("reports a friendly failure (and logs) when the write fails, never throwing into the page", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateCheckoutRef.mockRejectedValue(new Error("connection reset"));

    // Act
    const result = await issueCheckoutRefAction();

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/couldn't start checkout/i);
    expect(errorSpy).toHaveBeenCalled();
  });
});
