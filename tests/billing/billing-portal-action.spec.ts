// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Coverage
// for app/settings/billing/actions.ts's openBillingPortalAction. Same
// redirect-sentinel mocking convention as
// tests/hubspot/hubspot-disconnect-rate-limit.spec.ts (every path in this
// action ends in redirect(), which the real next/navigation implementation
// makes impossible to "just return from" in a test). DB-free: requireSeller,
// subscription-repository and lib/billing/paddle-portal are all mocked.
// Never calls the real Paddle API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_PORTAL_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { redirectSentinel, redirectCalls } = vi.hoisted(() => ({
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectCalls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

const { mockRequireSeller, mockFindByTenantId, mockCreateBillingPortalSession, mockGetPaddleApiKey, mockGetPaddleApiBaseUrl } =
  vi.hoisted(() => ({
    mockRequireSeller: vi.fn(),
    mockFindByTenantId: vi.fn(),
    mockCreateBillingPortalSession: vi.fn(),
    mockGetPaddleApiKey: vi.fn(),
    mockGetPaddleApiBaseUrl: vi.fn(),
  }));

vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));
vi.mock("@/lib/billing/subscription-repository", () => ({ findByTenantId: mockFindByTenantId }));
vi.mock("@/lib/billing/paddle-server-env", () => ({
  getPaddleApiKey: mockGetPaddleApiKey,
  getPaddleApiBaseUrl: mockGetPaddleApiBaseUrl,
}));

class FakePaddlePortalError extends Error {}
vi.mock("@/lib/billing/paddle-portal", () => ({
  createBillingPortalSession: mockCreateBillingPortalSession,
  PaddlePortalError: FakePaddlePortalError,
}));

const { openBillingPortalAction } = await import("@/app/settings/billing/actions");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";
const PORTAL_URL = "https://customer-portal.paddle.com/cpl_abc?token=pga_secret";

function signedInSeller(overrides: Record<string, unknown> = {}) {
  return { client: {}, userId: USER_ID, email: "seller@example.com", tenantId: TENANT_ID, ...overrides };
}

function liveSubscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
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

async function expectRedirect(): Promise<void> {
  await expect(openBillingPortalAction()).rejects.toBe(redirectSentinel);
}

beforeEach(() => {
  resetRateLimiterForTests();
  redirectCalls.length = 0;
  mockRequireSeller.mockResolvedValue(signedInSeller());
  mockFindByTenantId.mockResolvedValue(liveSubscription());
  mockGetPaddleApiKey.mockReturnValue("pdl_apikey_secret");
  mockGetPaddleApiBaseUrl.mockReturnValue("https://sandbox-api.paddle.com");
  mockCreateBillingPortalSession.mockResolvedValue(PORTAL_URL);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockRequireSeller.mockReset();
  mockFindByTenantId.mockReset();
  mockCreateBillingPortalSession.mockReset();
  mockGetPaddleApiKey.mockReset();
  mockGetPaddleApiBaseUrl.mockReset();
});

describe("openBillingPortalAction — happy path", () => {
  it("redirects straight to Paddle's own portal URL", async () => {
    await expectRedirect();
    expect(redirectCalls).toEqual([PORTAL_URL]);
  });

  it("resolves the customer/subscription ids from the SIGNED-IN SELLER'S OWN tenant, never from an argument", async () => {
    // The action itself takes no parameters at all — there is nothing for a
    // caller to tamper with. This asserts the ids it hands to Paddle came
    // from the mocked repository call, keyed by the session's own tenantId.
    await expectRedirect();

    expect(mockFindByTenantId).toHaveBeenCalledWith(TENANT_ID);
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "ctm_1", subscriptionId: "sub_1" }),
    );
  });
});

// Code review fix (MEDIUM): a canceled subscription still has a real Paddle
// customer id, so the seller should still be able to reach the portal — but
// with NO subscription_ids, since there is nothing left to "manage" on a
// dead subscription. Re-subscribing happens via a fresh Paddle checkout
// (/pricing), not through this portal session.
describe("openBillingPortalAction — canceled subscription (still reaches the portal, general view only)", () => {
  it("passes subscriptionId: null so paddle-portal.ts omits subscription_ids", async () => {
    mockFindByTenantId.mockResolvedValue(liveSubscription({ status: "canceled" }));

    await expectRedirect();

    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "ctm_1", subscriptionId: null }),
    );
    expect(redirectCalls).toEqual([PORTAL_URL]);
  });

  it.each(["trialing", "past_due", "paused"] as const)(
    "still passes the real subscription id when the status is live (%s)",
    async (status) => {
      mockFindByTenantId.mockResolvedValue(liveSubscription({ status }));

      await expectRedirect();

      expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub_1" }),
      );
    },
  );
});

describe("openBillingPortalAction — unauthenticated", () => {
  it("redirects back with the signed_out error code and never reads the subscription", async () => {
    mockRequireSeller.mockResolvedValue(null);

    await expectRedirect();

    expect(redirectCalls[0]).toBe("/settings/billing?error=signed_out");
    expect(mockFindByTenantId).not.toHaveBeenCalled();
  });
});

describe("openBillingPortalAction — free tenant (no subscription row at all)", () => {
  it("redirects back with the no_account error code, never calling Paddle", async () => {
    mockFindByTenantId.mockResolvedValue(null);

    await expectRedirect();

    expect(redirectCalls[0]).toBe("/settings/billing?error=no_account");
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled();
  });
});

describe("openBillingPortalAction — manual/invoiced tenant (no Paddle customer id)", () => {
  it("redirects back with the no_account error code, never calling Paddle", async () => {
    mockFindByTenantId.mockResolvedValue(
      liveSubscription({ paddleCustomerId: null, manualEntitlementTier: "enterprise" }),
    );

    await expectRedirect();

    expect(redirectCalls[0]).toBe("/settings/billing?error=no_account");
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled();
  });
});

describe("openBillingPortalAction — rate limited", () => {
  it("stops opening the portal once the per-seller budget is spent", async () => {
    for (let attempt = 0; attempt < BILLING_PORTAL_RATE_LIMIT.limit; attempt += 1) {
      await expectRedirect();
    }
    const callsBeforeOverBudget = mockCreateBillingPortalSession.mock.calls.length;

    await expectRedirect();

    expect(redirectCalls.at(-1)).toBe("/settings/billing?error=rate_limited");
    expect(mockCreateBillingPortalSession).toHaveBeenCalledTimes(callsBeforeOverBudget);
  });
});

describe("openBillingPortalAction — Paddle misconfigured", () => {
  it("redirects back with the misconfigured error code when the API key/base URL is missing", async () => {
    mockGetPaddleApiKey.mockReturnValue(null);

    await expectRedirect();

    expect(redirectCalls[0]).toBe("/settings/billing?error=misconfigured");
  });
});

describe("openBillingPortalAction — Paddle call fails", () => {
  it("redirects back with the generic error code, never leaking the failure detail to the URL", async () => {
    mockCreateBillingPortalSession.mockRejectedValue(new FakePaddlePortalError("status 500"));

    await expectRedirect();

    expect(redirectCalls[0]).toBe("/settings/billing?error=generic");
  });
});
