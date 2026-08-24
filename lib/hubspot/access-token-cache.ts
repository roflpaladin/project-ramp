// In-memory access-token cache for lib/hubspot/get-client.ts. Deliberately
// in-memory and per-instance (same caveat as lib/rate-limit.ts): on a
// multi-instance deployment each instance keeps its own cache, so a fresh
// instance simply refreshes on its own first request rather than sharing a
// warm cache with its siblings — correct, just not maximally efficient.
// HubSpot access tokens live only here, never in crm_connections (0010) —
// only the refresh token is persisted, encrypted, by lib/hubspot/token-store.ts.

export interface CachedAccessToken {
  readonly accessToken: string;
  /** Epoch ms. get-client.ts treats a token within its own near-expiry buffer as a cache miss. */
  readonly expiresAtMs: number;
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
