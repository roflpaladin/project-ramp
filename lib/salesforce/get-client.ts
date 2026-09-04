import {
  clearCachedAccessToken,
  getCachedAccessToken,
  setCachedAccessToken,
} from "@/lib/crm-connections/access-token-cache";
import { getTenantConnection, saveTenantTokens } from "@/lib/crm-connections/token-store";
import { isValidSalesforceInstanceUrl, refreshAccessToken, SalesforceOAuthError } from "@/lib/salesforce/token-exchange";

// Sprint 11, Ticket 55 — the one place a caller (T56's future CRM read path)
// gets an authenticated Salesforce client for a tenant. Mirrors
// lib/hubspot/get-client.ts's shape byte-for-byte (cache lookup, refresh on
// miss/near-expiry, single-flighted concurrent refreshes, exactly one
// refresh+retry on a 401, re-persisting a rotated refresh token) — see that
// file's header for the full reasoning behind each of those, unchanged here.
// Two differences from HubSpot's module:
//
// 1. Base URL — every request goes to the tenant's stored per-org
//    `instance_url` (lib/crm-connections/token-store.ts's getTenantConnection),
//    not a single fixed host like HubSpot's api.hubapi.com.
// 2. `provider` isn't a parameter here — this module only ever serves
//    "salesforce" (unlike lib/hubspot/get-client.ts, which kept a `provider`
//    parameter around from before the shared cache/token-store modules
//    existed). A dedicated Salesforce module has no second provider to be
//    generic over.
//
// A refresh failure (most notably SalesforceReauthRequiredError — see
// lib/salesforce/token-exchange.ts's header: Salesforce's per-org
// refresh-token-expiry policy makes this an EXPECTED lifecycle event, not an
// anomaly) is deliberately NOT caught here and NOT mapped to `null` — it
// propagates to the caller, same as HubSpot's module does for its own
// refresh failures, so "never connected" (a real `null`) is never confused
// with "was connected, but the connection just died" (a thrown error).

const PROVIDER = "salesforce";
// Refresh a bit before the token actually expires, so a request that starts
// just under the wire doesn't race Salesforce's own expiry. Same value as
// lib/hubspot/get-client.ts's NEAR_EXPIRY_BUFFER_MS.
const NEAR_EXPIRY_BUFFER_MS = 60_000;
// Matches lib/salesforce/token-exchange.ts's own FETCH_TIMEOUT_MS.
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
// Salesforce's token response does not reliably include `expires_in`
// (lib/salesforce/token-exchange.ts's header) — a conservative 30-minute
// fallback keeps a token that omits it usably cached rather than treating a
// missing field as "already expired" (which would force a refresh on every
// single call) or as infinitely valid (which would never refresh at all).
const DEFAULT_TOKEN_TTL_SECONDS = 30 * 60;

export interface SalesforceClient {
  /** `path` is relative (e.g. "/services/data/v62.0/sobjects/Opportunity") — this prefixes the tenant's stored instance_url and adds the Bearer header. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

// Single-flight in-flight refreshes, keyed per tenant — see
// lib/hubspot/get-client.ts's header for the full "why" (two concurrent
// callers both refreshing independently would race to persist whichever
// rotated token wins, silently discarding the other and breaking the
// connection on the next refresh attempt).
const inFlightRefreshes = new Map<string, Promise<{ accessToken: string; instanceUrl: string } | null>>();

async function refreshAndCache(
  tenantId: string,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const stored = await getTenantConnection(tenantId, PROVIDER);
  if (!stored) return null;

  const tokenSet = await refreshAccessToken(stored.refreshToken, fetchImpl);
  const expiresInSeconds = tokenSet.expiresInSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;

  setCachedAccessToken(tenantId, PROVIDER, {
    accessToken: tokenSet.accessToken,
    expiresAtMs: Date.now() + expiresInSeconds * 1000 - NEAR_EXPIRY_BUFFER_MS,
    instanceUrl: tokenSet.instanceUrl,
  });

  // Salesforce does not rotate refresh tokens on every refresh grant by
  // default — only re-persist when it actually hands back a different one.
  if (tokenSet.refreshToken && tokenSet.refreshToken !== stored.refreshToken) {
    await saveTenantTokens({
      tenantId,
      provider: PROVIDER,
      refreshToken: tokenSet.refreshToken,
      instanceUrl: tokenSet.instanceUrl,
    });
  }

  return { accessToken: tokenSet.accessToken, instanceUrl: tokenSet.instanceUrl };
}

function refreshSingleFlight(
  tenantId: string,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const existing = inFlightRefreshes.get(tenantId);
  if (existing) return existing;

  const promise = refreshAndCache(tenantId, fetchImpl).finally(() => {
    inFlightRefreshes.delete(tenantId);
  });
  inFlightRefreshes.set(tenantId, promise);
  return promise;
}

async function getValidAccessToken(
  tenantId: string,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const cached = getCachedAccessToken(tenantId, PROVIDER);
  if (cached && cached.expiresAtMs > Date.now() && cached.instanceUrl) {
    return { accessToken: cached.accessToken, instanceUrl: cached.instanceUrl };
  }

  return refreshSingleFlight(tenantId, fetchImpl);
}

function buildRequest(path: string, instanceUrl: string, accessToken: string, init?: RequestInit): [string, RequestInit] {
  // Defense-in-depth (T55 security review): parse-time validation in
  // token-exchange.ts is the write gate; re-checking here means even a row
  // tampered with after storage can never aim a Bearer token off-Salesforce.
  if (!isValidSalesforceInstanceUrl(instanceUrl)) {
    throw new SalesforceOAuthError("Stored Salesforce instance URL is not a valid Salesforce host.");
  }
  const url = `${instanceUrl}${path}`;
  const headers = { ...(init?.headers ?? {}), authorization: `Bearer ${accessToken}` };
  const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS);
  return [url, { ...init, headers, signal }];
}

/**
 * Returns `null` only when the tenant has never connected Salesforce (or has
 * disconnected — deleteTenantTokens removes the row entirely). A genuine
 * refresh failure (a real token-store query error, or Salesforce rejecting
 * the refresh itself — see this file's header on SalesforceReauthRequiredError)
 * throws instead of returning `null` — a caller can't mistake "the
 * connection just died" for "never connected".
 */
export async function getSalesforceClientForTenant(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceClient | null> {
  const valid = await getValidAccessToken(tenantId, fetchImpl);
  if (!valid) return null;

  return {
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      const current = (await getValidAccessToken(tenantId, fetchImpl)) ?? valid;
      const [url, requestInit] = buildRequest(path, current.instanceUrl, current.accessToken, init);
      const response = await fetchImpl(url, requestInit);
      if (response.status !== 401) return response;

      // Exactly one refresh+retry — see lib/hubspot/get-client.ts's header
      // for why a second 401 is treated as a real auth failure, not
      // transient staleness this layer can fix.
      clearCachedAccessToken(tenantId, PROVIDER);
      const retried = await getValidAccessToken(tenantId, fetchImpl);
      if (!retried) return response;

      const [retryUrl, retryInit] = buildRequest(path, retried.instanceUrl, retried.accessToken, init);
      return fetchImpl(retryUrl, retryInit);
    },
  };
}
