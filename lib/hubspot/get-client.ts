import {
  clearCachedAccessToken,
  getCachedAccessToken,
  setCachedAccessToken,
} from "@/lib/hubspot/access-token-cache";
import { refreshAccessToken } from "@/lib/hubspot/token-exchange";
import { getTenantRefreshToken, saveTenantTokens } from "@/lib/hubspot/token-store";

// Sprint 10, Ticket 52 — the one place a caller (a future CRM read path)
// gets an authenticated HubSpot client for a tenant. Owns the full
// access-token lifecycle so nothing else in the codebase has to: cache
// lookup, refresh on miss/near-expiry, exactly one refresh+retry on a 401
// (a token can go stale between the cache check and the actual call), and
// re-persisting a rotated refresh token (HubSpot may issue a new one on
// refresh — the old one then stops working).

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const DEFAULT_PROVIDER = "hubspot";
// Refresh a bit before the token actually expires, so a request that starts
// just under the wire doesn't race HubSpot's own expiry.
const NEAR_EXPIRY_BUFFER_MS = 60_000;
// Matches lib/hubspot/token-exchange.ts's own FETCH_TIMEOUT_MS — this
// client's outbound API calls (not the OAuth token endpoint token-exchange.ts
// already times out on its own) get the same default budget, so a caller
// that passes no `signal` still can't hang a request indefinitely.
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export interface HubSpotClient {
  /** `path` is relative (e.g. "/crm/v3/objects/deals") — this prefixes HUBSPOT_API_BASE and adds the Bearer header. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

// T52 code review (HIGH) — single-flight in-flight refreshes, keyed
// identically to access-token-cache.ts's cache key. HubSpot rotates the
// refresh token on every refresh call: two concurrent callers that both
// miss the cache and each called refreshAccessToken independently would
// both hand HubSpot the SAME stored refresh token, each get back a
// DIFFERENT rotated token, and lib/hubspot/token-store.ts's upsert is
// last-write-wins — silently discarding whichever caller's rotated token
// lost the race, even though HubSpot has already invalidated the shared old
// one. The next refresh attempt (this instance or another) then has no
// valid refresh token left and the connection breaks. Concurrent callers
// now instead await the SAME in-flight promise, so exactly one refresh (and
// one persist) ever happens per (tenantId, provider) at a time.
const inFlightRefreshes = new Map<string, Promise<string | null>>();

function inFlightKey(tenantId: string, provider: string): string {
  return `${tenantId}:${provider}`;
}

async function refreshAndCache(
  tenantId: string,
  provider: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const refreshToken = await getTenantRefreshToken(tenantId, provider);
  if (!refreshToken) return null;

  const tokenSet = await refreshAccessToken(refreshToken, fetchImpl);

  setCachedAccessToken(tenantId, provider, {
    accessToken: tokenSet.accessToken,
    expiresAtMs: Date.now() + tokenSet.expiresInSeconds * 1000 - NEAR_EXPIRY_BUFFER_MS,
  });

  // HubSpot may rotate the refresh token on every refresh call — the prior
  // one then stops working, so a changed value must be re-persisted or the
  // NEXT refresh (possibly after this instance restarts) would fail.
  if (tokenSet.refreshToken !== refreshToken) {
    await saveTenantTokens({ tenantId, provider, refreshToken: tokenSet.refreshToken });
  }

  return tokenSet.accessToken;
}

/**
 * Cache-miss path: refreshes (or discovers "never connected", or propagates
 * a genuine token-store/HubSpot failure — see lib/hubspot/token-store.ts's
 * T52 error-vs-absent-row fix) for (tenantId, provider), single-flighted
 * per this module's header. The in-flight entry is always cleared on
 * settle, success OR failure (`.finally`) — a failed refresh must not
 * poison the slot: the next caller needs to start a fresh attempt, not
 * await a promise that already rejected or hang forever on one that never
 * gets cleared.
 */
function refreshSingleFlight(tenantId: string, provider: string, fetchImpl: typeof fetch): Promise<string | null> {
  const key = inFlightKey(tenantId, provider);
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;

  const promise = refreshAndCache(tenantId, provider, fetchImpl).finally(() => {
    inFlightRefreshes.delete(key);
  });
  inFlightRefreshes.set(key, promise);
  return promise;
}

async function getValidAccessToken(
  tenantId: string,
  provider: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const cached = getCachedAccessToken(tenantId, provider);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.accessToken;
  }

  return refreshSingleFlight(tenantId, provider, fetchImpl);
}

function buildRequest(path: string, accessToken: string, init?: RequestInit): [string, RequestInit] {
  const url = `${HUBSPOT_API_BASE}${path}`;
  const headers = { ...(init?.headers ?? {}), authorization: `Bearer ${accessToken}` };
  // Caller-provided signal always wins; otherwise every request this client
  // makes gets a default timeout rather than being able to hang forever.
  const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS);
  return [url, { ...init, headers, signal }];
}

/**
 * Returns `null` when the tenant has never connected HubSpot (or has
 * disconnected — deleteTenantTokens removes the row entirely, so this and
 * getTenantRefreshToken agree on "no row = not connected"). A genuine
 * token-store query failure (DB outage, etc.) throws instead of returning
 * `null` here — see lib/hubspot/token-store.ts's T52 fix; this function
 * deliberately does not catch it, so a caller can't mistake "we couldn't
 * find out" for "definitely never connected".
 *
 * `fetchImpl` is injectable, same reason as lib/plans/fetch-plan.ts and
 * lib/hubspot/token-exchange.ts — testable without a real network call.
 */
export async function getHubSpotClientForTenant(
  tenantId: string,
  provider: string = DEFAULT_PROVIDER,
  fetchImpl: typeof fetch = fetch,
): Promise<HubSpotClient | null> {
  const accessToken = await getValidAccessToken(tenantId, provider, fetchImpl);
  if (!accessToken) return null;

  return {
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      // This per-call lookup re-checks the cache for freshness (a long-lived
      // client may call .fetch() many times across its near-expiry buffer,
      // well after construction) and is a cache hit in the common case,
      // since construction just populated it. The `?? accessToken` fallback
      // exists only for the narrow race where the tenant disconnects
      // between construction and this exact call (its refresh token row
      // deleted mid-flight): falling back lets this one request go out
      // with the last-known-good token — either it still works, or HubSpot
      // rejects it with a real 401 and the retry path below runs its own
      // explicit null-check rather than falling back a second time (a
      // second failure there is treated as a genuine, unretriable auth
      // failure, not staleness this layer can paper over).
      const currentToken = (await getValidAccessToken(tenantId, provider, fetchImpl)) ?? accessToken;
      const [url, requestInit] = buildRequest(path, currentToken, init);
      const response = await fetchImpl(url, requestInit);
      if (response.status !== 401) return response;

      // Exactly one refresh+retry: force a refresh (the cache may have
      // handed back a token HubSpot itself just rejected early) and try
      // once more with whatever it returns, but only once — a second 401
      // is a real auth failure, not a transient staleness this layer can fix.
      clearCachedAccessToken(tenantId, provider);
      const retriedToken = await getValidAccessToken(tenantId, provider, fetchImpl);
      if (!retriedToken) return response;

      const [retryUrl, retryInit] = buildRequest(path, retriedToken, init);
      return fetchImpl(retryUrl, retryInit);
    },
  };
}
