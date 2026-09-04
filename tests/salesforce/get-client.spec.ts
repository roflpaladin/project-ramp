// Sprint 11, Ticket 55 — unit coverage for lib/salesforce/get-client.ts.
// Mirrors tests/hubspot/get-client.spec.ts's mocking strategy (token-store
// and token-exchange module-mocked; only the caching/refresh/retry-on-401
// orchestration is under test here) plus two Salesforce-specific additions:
// the stored instance_url becomes the request base URL, and a missing
// expires_in falls back to a documented default TTL rather than caching a
// token as immediately (or eternally) expired.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTenantConnection, saveTenantTokens } = vi.hoisted(() => ({
  getTenantConnection: vi.fn(),
  saveTenantTokens: vi.fn(),
}));
const { refreshAccessToken } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock("@/lib/crm-connections/token-store", () => ({ getTenantConnection, saveTenantTokens }));
vi.mock("@/lib/salesforce/token-exchange", async (importOriginal) => ({
  // Real module (SalesforceOAuthError, isValidSalesforceInstanceUrl, the reauth
  // subclass) with only the network-touching refresh call faked out.
  ...(await importOriginal<typeof import("@/lib/salesforce/token-exchange")>()),
  refreshAccessToken,
}));

const { getSalesforceClientForTenant } = await import("@/lib/salesforce/get-client");
const { resetAccessTokenCacheForTests } = await import("@/lib/crm-connections/access-token-cache");

const TENANT_ID = "tenant-sf-1";
const INSTANCE_URL = "https://my-dev-org.my.salesforce.com";

function connection(overrides: Partial<{ refreshToken: string; instanceUrl: string | null }> = {}) {
  return { refreshToken: "stored-refresh-token", instanceUrl: INSTANCE_URL, ...overrides };
}

function tokenSet(
  overrides: Partial<{ accessToken: string; refreshToken: string | null; instanceUrl: string; expiresInSeconds: number | null }> = {},
) {
  return {
    accessToken: "access-token-1",
    refreshToken: null,
    instanceUrl: INSTANCE_URL,
    expiresInSeconds: 7200,
    ...overrides,
  };
}

describe("getSalesforceClientForTenant", () => {
  beforeEach(() => {
    resetAccessTokenCacheForTests();
    getTenantConnection.mockReset();
    saveTenantTokens.mockReset();
    refreshAccessToken.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when the tenant has no stored connection (disconnected)", async () => {
    getTenantConnection.mockResolvedValue(null);

    const client = await getSalesforceClientForTenant(TENANT_ID);

    expect(client).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes on a cache miss, then issues the Bearer-authed request against the stored instance_url", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    expect(client).not.toBeNull();
    await client!.fetch("/services/data/v62.0/sobjects/Opportunity");

    expect(refreshAccessToken).toHaveBeenCalledWith("stored-refresh-token", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${INSTANCE_URL}/services/data/v62.0/sobjects/Opportunity`,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access-token-1" }),
      }),
    );
  });

  it("re-persists a rotated refresh token when the refresh call returns one", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet({ refreshToken: "rotated-refresh-token" }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/a");

    expect(saveTenantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        provider: "salesforce",
        refreshToken: "rotated-refresh-token",
        instanceUrl: INSTANCE_URL,
      }),
    );
  });

  it("does not re-persist when the refresh call returns no refresh token (Salesforce's typical shape)", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet({ refreshToken: null }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/a");

    expect(saveTenantTokens).not.toHaveBeenCalled();
  });

  it("falls back to a default TTL when expires_in is absent (null), rather than treating the token as immediately expired", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet({ expiresInSeconds: null }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/a");
    await client!.fetch("/b");

    // A second call still within the fallback TTL must reuse the cached
    // token rather than refreshing again — proves the null didn't collapse
    // to "already expired".
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached, non-expired access token without calling refresh again", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/a");
    await client!.fetch("/b");

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once, with a fresh access token, on a 401", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken
      .mockResolvedValueOnce(tokenSet({ accessToken: "access-token-1" }))
      .mockResolvedValueOnce(tokenSet({ accessToken: "access-token-2" }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    const response = await client!.fetch("/services/data/v62.0/sobjects/Opportunity");

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer access-token-2" }) }),
    );
  });

  it("does not retry a second time when the retried request is also a 401", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("still unauthorized", { status: 401 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    const response = await client!.fetch("/services/data/v62.0/sobjects/Opportunity");

    expect(response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent refreshes for the same tenant", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const [clientA, clientB] = await Promise.all([
      getSalesforceClientForTenant(TENANT_ID, fetchImpl),
      getSalesforceClientForTenant(TENANT_ID, fetchImpl),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(getTenantConnection).toHaveBeenCalledTimes(1);

    await clientA!.fetch("/a");
    await clientB!.fetch("/b");
  });

  it("propagates a refresh failure (e.g. SalesforceReauthRequiredError) rather than swallowing it", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockRejectedValue(new Error("Your Salesforce connection needs to be reconnected."));

    await expect(getSalesforceClientForTenant(TENANT_ID)).rejects.toThrow(
      "Your Salesforce connection needs to be reconnected.",
    );
  });

  it("a failed refresh clears the in-flight slot so the next call retries instead of reusing the dead attempt", async () => {
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getSalesforceClientForTenant(TENANT_ID, fetchImpl)).rejects.toThrow("boom");
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    expect(client).not.toBeNull();
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe("SalesforceClient.fetch — default request timeout", () => {
  beforeEach(() => {
    resetAccessTokenCacheForTests();
    getTenantConnection.mockReset();
    saveTenantTokens.mockReset();
    refreshAccessToken.mockReset();
    getTenantConnection.mockResolvedValue(connection());
    refreshAccessToken.mockResolvedValue(tokenSet());
  });

  it("applies a default AbortSignal.timeout when the caller passes no signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/services/data/v62.0/sobjects/Opportunity");

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller-provided signal instead of the default when one is supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const callerController = new AbortController();

    const client = await getSalesforceClientForTenant(TENANT_ID, fetchImpl);
    await client!.fetch("/services/data/v62.0/sobjects/Opportunity", { signal: callerController.signal });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestInit.signal).toBe(callerController.signal);
  });
});
