// Sprint 11, Ticket 55 — server-side rate limiting on disconnectSalesforce.
// Mirrors tests/hubspot/hubspot-disconnect-rate-limit.spec.ts's DB-free
// convention: requireSeller, lib/crm-connections/token-store, and
// lib/salesforce/token-exchange are all mocked, so only the checkRateLimit
// branch inside the action is under test. This is the rate-limit-specific
// sibling of tests/security/salesforce-disconnect-action.spec.ts (which
// covers the real revoke/delete behaviour against a live DB and is not run
// here).

import { describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

const {
  redirectSentinel,
  redirectCalls,
  currentSession,
  getTenantConnection,
  deleteTenantTokens,
  revokeRefreshToken,
} = vi.hoisted(() => ({
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectCalls: [] as string[],
  currentSession: { value: null as SellerSession | null },
  getTenantConnection: vi.fn(),
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

vi.mock("@/lib/crm-connections/token-store", () => ({
  getTenantConnection: (...args: unknown[]) => getTenantConnection(...args),
  deleteTenantTokens: (...args: unknown[]) => deleteTenantTokens(...args),
}));

vi.mock("@/lib/salesforce/token-exchange", () => ({
  revokeRefreshToken: (...args: unknown[]) => revokeRefreshToken(...args),
}));

const { disconnectSalesforce } = await import("@/app/settings/integrations/salesforce-actions");

function makeSession(userId: string): SellerSession {
  return {
    client: {} as SellerSession["client"],
    userId,
    email: null,
    tenantId: "7e550000-0000-4000-8000-000000000055",
  };
}

describe("disconnectSalesforce — per-seller rate limiting", () => {
  it("allows the budgeted calls, then redirects with ?error=sf_rate_limited without touching revoke or delete", async () => {
    currentSession.value = makeSession("rate-limit-sf-disconnect-user");
    getTenantConnection.mockResolvedValue(null);
    deleteTenantTokens.mockResolvedValue(undefined);
    redirectCalls.length = 0;

    for (let call = 0; call < CRM_OAUTH_RATE_LIMIT.limit; call += 1) {
      await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);
    }
    expect(deleteTenantTokens).toHaveBeenCalledTimes(CRM_OAUTH_RATE_LIMIT.limit);

    const callsBeforeOverBudget = deleteTenantTokens.mock.calls.length;
    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls.at(-1)).toBe(`/settings/integrations?error=${encodeURIComponent("sf_rate_limited")}`);
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    // The refusal happens before the delete — no extra call burned.
    expect(deleteTenantTokens).toHaveBeenCalledTimes(callsBeforeOverBudget);
  });

  it("budgets are per seller: one seller at the cap does not throttle another", async () => {
    getTenantConnection.mockResolvedValue(null);
    deleteTenantTokens.mockResolvedValue(undefined);

    currentSession.value = makeSession("rate-limit-sf-disconnect-capped");
    for (let call = 0; call < CRM_OAUTH_RATE_LIMIT.limit; call += 1) {
      await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);
    }
    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);
    expect(redirectCalls.at(-1)).toBe(`/settings/integrations?error=${encodeURIComponent("sf_rate_limited")}`);

    currentSession.value = makeSession("rate-limit-sf-disconnect-other");
    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);
    expect(redirectCalls.at(-1)).toBe("/settings/integrations?disconnected=salesforce");
  });

  it("calls revoke with the stored refresh token, then deletes unconditionally on revoke failure", async () => {
    currentSession.value = makeSession("rate-limit-sf-disconnect-revoke-fail");
    getTenantConnection.mockResolvedValue({ refreshToken: "stored-refresh-token", instanceUrl: "https://x.my.salesforce.com" });
    revokeRefreshToken.mockRejectedValue(new Error("Salesforce rejected the revoke request (status 500)."));
    deleteTenantTokens.mockResolvedValue(undefined);

    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(revokeRefreshToken).toHaveBeenCalledWith("stored-refresh-token");
    expect(deleteTenantTokens).toHaveBeenCalledWith(expect.any(String), "salesforce");
    expect(redirectCalls.at(-1)).toBe(`/settings/integrations?warning=${encodeURIComponent("sf_revoke_failed")}`);
  });
});
