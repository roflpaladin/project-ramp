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

const { mockRequireSeller, mockCreateCheckoutRef } = vi.hoisted(() => ({
  mockRequireSeller: vi.fn(),
  mockCreateCheckoutRef: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));
vi.mock("@/lib/billing/subscription-repository", () => ({ createCheckoutRef: mockCreateCheckoutRef }));

const { issueCheckoutRefAction } = await import("@/app/pricing/checkout-actions");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

function signedInSeller(overrides: Record<string, unknown> = {}) {
  return { client: {}, userId: USER_ID, email: "seller@example.com", tenantId: TENANT_ID, ...overrides };
}

beforeEach(() => {
  resetRateLimiterForTests();
  mockRequireSeller.mockResolvedValue(signedInSeller());
  mockCreateCheckoutRef.mockResolvedValue({ id: "ref_abc", expiresAt: "2026-09-20T13:00:00.000Z" });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockRequireSeller.mockReset();
  mockCreateCheckoutRef.mockReset();
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
