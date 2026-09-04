// In-memory access-token cache, keyed by (tenantId, provider). Moved from
// lib/hubspot/access-token-cache.ts to lib/crm-connections/access-token-cache.ts
// (Sprint 11, Ticket 55) — a pure move, no behavior change: this module was
// already provider-parameterized (every function takes `provider`), so
// lib/salesforce/get-client.ts reuses it directly rather than forking a
// near-duplicate cache. Deliberately in-memory and per-instance (same
// caveat as lib/rate-limit.ts): on a multi-instance deployment each instance
// keeps its own cache, so a fresh instance simply refreshes on its own first
// request rather than sharing a warm cache with its siblings — correct, just
// not maximally efficient. Access tokens live only here, never in
// crm_connections (0010) — only the refresh token is persisted, encrypted,
// by lib/crm-connections/token-store.ts.

export interface CachedAccessToken {
  readonly accessToken: string;
  /** Epoch ms. get-client.ts treats a token within its own near-expiry buffer as a cache miss. */
  readonly expiresAtMs: number;
  /**
   * Salesforce-only (lib/salesforce/get-client.ts) — the per-org API host a
   * request needs alongside the access token itself. Optional and simply
   * never set by HubSpot's get-client.ts, which has one fixed API host and
   * no use for it. Caching it here (rather than re-reading
   * crm_connections.instance_url on every cache HIT) avoids a DB round trip
   * on Salesforce's common path, the same efficiency HubSpot's cache hit
   * already gets "for free" from needing only the access token.
   */
  readonly instanceUrl?: string;
}

const cache = new Map<string, CachedAccessToken>();

function cacheKey(tenantId: string, provider: string): string {
  return `${tenantId}:${provider}`;
}

export function getCachedAccessToken(tenantId: string, provider: string): CachedAccessToken | undefined {
  return cache.get(cacheKey(tenantId, provider));
}

export function setCachedAccessToken(tenantId: string, provider: string, token: CachedAccessToken): void {
  cache.set(cacheKey(tenantId, provider), token);
}

export function clearCachedAccessToken(tenantId: string, provider: string): void {
  cache.delete(cacheKey(tenantId, provider));
}

/** Test-only: clears every cached token so specs are order-independent. */
export function resetAccessTokenCacheForTests(): void {
  cache.clear();
}
