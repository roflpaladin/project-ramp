// Sprint 10, Ticket 52 code-review fix (MEDIUM) — server-side rate limiting
// on disconnectHubSpot. DB-FREE, matching
// tests/security/onboarding-rate-limit.spec.ts's convention: requireSeller,
// lib/hubspot/token-store, and lib/hubspot/token-exchange are all mocked, so
// only the checkRateLimit branch inside the action is under test. The
// limiter itself (lib/rate-limit.ts) is NOT mocked. Budgets are keyed per
// seller userId, so each test uses its own unique userId to keep windows
// isolated. This is the rate-limit-specific sibling of
// tests/security/hubspot-disconnect-action.spec.ts (which covers the real
// revoke/delete behaviour against a live DB and is not run here).

import { describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { HUBSPOT_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

const { redirectSentinel, redirectCalls, currentSession, getTenantRefreshToken, deleteTenantTokens, revokeRefreshToken } =
  vi.hoisted(() => ({
    redirectSentinel: Symbol("redirect-sentinel"),
    redirectCalls: [] as string[],
    currentSession: { value: null as SellerSession | null },
    getTenantRefreshToken: vi.fn(),
    deleteTenantTokens: vi.fn(),
    revokeRefreshToken: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSession.value),
}));

vi.mock("@/lib/hubspot/token-store", () => ({
  getTenantRefreshToken: (...args: unknown[]) => getTenantRefreshToken(...args),
  deleteTenantTokens: (...args: unknown[]) => deleteTenantTokens(...args),
}));

vi.mock("@/lib/hubspot/token-exchange", () => ({
  revokeRefreshToken: (...args: unknown[]) => revokeRefreshToken(...args),
}));

const { disconnectHubSpot } = await import("@/app/settings/integrations/hubspot-actions");

function makeSession(userId: string): SellerSession {
  return {
    client: {} as SellerSession["client"],
    userId,
    email: null,
    tenantId: "7e520000-0000-4000-8000-000000000052",
  };
}

describe("disconnectHubSpot — per-seller rate limiting (T52 code review)", () => {
  it("allows the budgeted calls, then redirects with ?error=rate_limited without touching revoke or delete", async () => {
    currentSession.value = makeSession("rate-limit-disconnect-user");
    getTenantRefreshToken.mockResolvedValue(null);
    deleteTenantTokens.mockResolvedValue(undefined);
    redirectCalls.length = 0;

    for (let call = 0; call < HUBSPOT_OAUTH_RATE_LIMIT.limit; call += 1) {
      await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);
    }
    expect(deleteTenantTokens).toHaveBeenCalledTimes(HUBSPOT_OAUTH_RATE_LIMIT.limit);

    const callsBeforeOverBudget = deleteTenantTokens.mock.calls.length;
    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls.at(-1)).toBe(`/settings/integrations?error=${encodeURIComponent("rate_limited")}`);
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    // The refusal happens before the delete — no extra call burned.
    expect(deleteTenantTokens).toHaveBeenCalledTimes(callsBeforeOverBudget);
  });

  it("budgets are per seller: one seller at the cap does not throttle another", async () => {
    getTenantRefreshToken.mockResolvedValue(null);
    deleteTenantTokens.mockResolvedValue(undefined);

    currentSession.value = makeSession("rate-limit-disconnect-capped");
    for (let call = 0; call < HUBSPOT_OAUTH_RATE_LIMIT.limit; call += 1) {
      await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);
    }
    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);
    expect(redirectCalls.at(-1)).toBe(`/settings/integrations?error=${encodeURIComponent("rate_limited")}`);

    currentSession.value = makeSession("rate-limit-disconnect-other");
    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);
    expect(redirectCalls.at(-1)).toBe("/settings/integrations?disconnected=1");
  });
});
