// Sprint 10, Ticket 52 — unit coverage for lib/hubspot/get-client.ts.
// token-store and token-exchange are module-mocked (this is a unit spec,
// not a live-DB one — that's tests/security/crm-connections-store.spec.ts);
// only the caching/refresh/retry-on-401 orchestration is under test here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTenantRefreshToken, saveTenantTokens } = vi.hoisted(() => ({
  getTenantRefreshToken: vi.fn(),
  saveTenantTokens: vi.fn(),
}));
const { refreshAccessToken } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock("@/lib/crm-connections/token-store", () => ({ getTenantRefreshToken, saveTenantTokens }));
vi.mock("@/lib/hubspot/token-exchange", () => ({ refreshAccessToken }));

const { getHubSpotClientForTenant } = await import("@/lib/hubspot/get-client");
const { resetAccessTokenCacheForTests } = await import("@/lib/crm-connections/access-token-cache");

const TENANT_ID = "tenant-1";

function tokenSet(overrides: Partial<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> = {}) {
  return {
    accessToken: "access-token-1",
    refreshToken: "refresh-token-1",
    expiresInSeconds: 1800,
    ...overrides,
  };
}

describe("getHubSpotClientForTenant", () => {
  beforeEach(() => {
    resetAccessTokenCacheForTests();
    getTenantRefreshToken.mockReset();
    saveTenantTokens.mockReset();
    refreshAccessToken.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when the tenant has no stored refresh token (disconnected)", async () => {
    getTenantRefreshToken.mockResolvedValue(null);

    const client = await getHubSpotClientForTenant(TENANT_ID);

    expect(client).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes on a cache miss, then issues the Bearer-authed request against api.hubapi.com", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    expect(client).not.toBeNull();
    await client!.fetch("/crm/v3/objects/deals");

    expect(refreshAccessToken).toHaveBeenCalledWith("stored-refresh-token", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/objects/deals",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access-token-1" }),
      }),
    );
  });

  it("re-persists a rotated refresh token returned by the refresh call", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet({ refreshToken: "rotated-refresh-token" }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/crm/v3/objects/deals");

    expect(saveTenantTokens).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, refreshToken: "rotated-refresh-token" }),
    );
  });

  it("does not re-persist when the refresh call returns the same refresh token", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet({ refreshToken: "stored-refresh-token" }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/crm/v3/objects/deals");

    expect(saveTenantTokens).not.toHaveBeenCalled();
  });

  it("reuses a cached, non-expired access token without calling refresh again", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/a");
    await client!.fetch("/b");

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once, with a fresh access token, on a 401", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken
      .mockResolvedValueOnce(tokenSet({ accessToken: "access-token-1" }))
      .mockResolvedValueOnce(tokenSet({ accessToken: "access-token-2" }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    const response = await client!.fetch("/crm/v3/objects/deals");

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer access-token-2" }) }),
    );
  });

  it("does not retry a second time when the retried request is also a 401", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("still unauthorized", { status: 401 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    const response = await client!.fetch("/crm/v3/objects/deals");

    expect(response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent refreshes for the same tenant: refreshAccessToken is called exactly once and both callers get the same access token", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    // Two concurrent callers for the same (tenantId, provider), both
    // starting from an empty cache — the failure mode this test guards
    // against is each one independently calling refreshAccessToken with the
    // same stored refresh token and racing to persist a rotated one.
    const [clientA, clientB] = await Promise.all([
      getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl),
      getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(getTenantRefreshToken).toHaveBeenCalledTimes(1);

    await clientA!.fetch("/a");
    await clientB!.fetch("/b");

    const authHeaders = fetchImpl.mock.calls.map((call) => {
      const [, init] = call as [string, RequestInit];
      return (init.headers as Record<string, string>).authorization;
    });
    expect(authHeaders).toEqual(["Bearer access-token-1", "Bearer access-token-1"]);
  });

  it("a failed refresh clears the in-flight slot so the next call for the same tenant retries instead of reusing the dead attempt", async () => {
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken
      .mockRejectedValueOnce(new Error("HubSpot rejected the refresh request (status 400)."))
      .mockResolvedValueOnce(tokenSet());
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl)).rejects.toThrow(
      "HubSpot rejected the refresh request (status 400).",
    );
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    // The failed attempt must not still occupy the in-flight slot — this
    // second, independent call should start (and succeed at) its own fresh
    // refresh rather than awaiting (or being blocked by) the first's
    // rejected promise.
    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);

    expect(client).not.toBeNull();
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("refreshes again once the cached token is past its near-expiry buffer", async () => {
    // expiresInSeconds well above the 60s near-expiry buffer, so the first
    // fetch (same virtual instant as the initial refresh) still finds a
    // fresh cache entry — isolates the "later, past the buffer" case this
    // test is actually about from the buffer-vs-TTL boundary itself.
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet({ expiresInSeconds: 120 }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/a");
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:05:00Z")); // 5 minutes later — well past the effective (120s - 60s) TTL.
    await client!.fetch("/b");

    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe("HubSpotClient.fetch — default request timeout (T52 code review, MEDIUM)", () => {
  beforeEach(() => {
    resetAccessTokenCacheForTests();
    getTenantRefreshToken.mockReset();
    saveTenantTokens.mockReset();
    refreshAccessToken.mockReset();
    getTenantRefreshToken.mockResolvedValue("stored-refresh-token");
    refreshAccessToken.mockResolvedValue(tokenSet());
  });

  it("applies a default AbortSignal.timeout when the caller passes no signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/crm/v3/objects/deals");

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller-provided signal instead of the default when one is supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const callerController = new AbortController();

    const client = await getHubSpotClientForTenant(TENANT_ID, "hubspot", fetchImpl);
    await client!.fetch("/crm/v3/objects/deals", { signal: callerController.signal });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestInit.signal).toBe(callerController.signal);
  });
});
