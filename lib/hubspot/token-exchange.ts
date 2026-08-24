import { getHubSpotClientId, getHubSpotClientSecret, getHubSpotRedirectUri } from "./env";

// Sprint 10, Ticket 52 — HubSpot's oauth/v1 endpoints (token exchange,
// refresh, revoke). Mirrors lib/crm/brand-scrape.ts's outbound-fetch shape
// (AbortSignal.timeout, never leaks raw response text to the caller) but,
// unlike brand-scrape.ts, DOES throw on failure — a silent null here would
// let app/api/integrations/hubspot/oauth/callback/route.ts and
// lib/hubspot/get-client.ts's refresh-on-401 path treat a failed token
// exchange as "nothing happened" instead of a real, actionable failure. The
// thrown HubSpotOAuthError always carries a fixed, app-authored message —
// HubSpot's raw response body (which can include internal error detail, or
// even attacker-influenced echo in some failure modes) is never surfaced to
// a caller, logged server-side by the caller instead.

const FETCH_TIMEOUT_MS = 8000;
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

export class HubSpotOAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HubSpotOAuthError";
  }
}

export interface HubSpotTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

interface RawHubSpotTokenResponseBody {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

interface ParsedHubSpotTokenResponseBody {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

function isTokenResponseBody(value: unknown): value is ParsedHubSpotTokenResponseBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as RawHubSpotTokenResponseBody;
  return (
    typeof body.access_token === "string" &&
    typeof body.refresh_token === "string" &&
    typeof body.expires_in === "number"
  );
}

function toTokenSet(body: ParsedHubSpotTokenResponseBody): HubSpotTokenSet {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSeconds: body.expires_in,
  };
}

async function postToken(params: URLSearchParams, fetchImpl: typeof fetch): Promise<HubSpotTokenSet> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new HubSpotOAuthError("Couldn't reach HubSpot to complete the token request.", error);
  }

  if (!response.ok) {
    throw new HubSpotOAuthError(`HubSpot rejected the token request (status ${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new HubSpotOAuthError("HubSpot's token response was not valid JSON.", error);
  }

  if (!isTokenResponseBody(body)) {
    throw new HubSpotOAuthError("HubSpot's token response was missing expected fields.");
  }

  return toTokenSet(body);
}

/** Exchanges an authorization `code` (from the OAuth callback) for an access + refresh token pair. */
export async function exchangeCodeForTokens(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HubSpotTokenSet> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getHubSpotClientId(),
    client_secret: getHubSpotClientSecret(),
    redirect_uri: getHubSpotRedirectUri(),
    code,
  });
  return postToken(params, fetchImpl);
}

/** Exchanges a stored refresh token for a new access token — HubSpot may rotate the refresh token itself. */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HubSpotTokenSet> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: getHubSpotClientId(),
    client_secret: getHubSpotClientSecret(),
    refresh_token: refreshToken,
  });
  return postToken(params, fetchImpl);
}

/**
 * Revokes a refresh token on HubSpot's side (disconnectHubSpot's
 * best-effort step). Resolves on any 2xx/204; throws HubSpotOAuthError
 * otherwise — the caller (hubspot-actions.ts) decides whether a revoke
 * failure should still proceed with the local delete.
 */
export async function revokeRefreshToken(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new HubSpotOAuthError("Couldn't reach HubSpot to revoke the connection.", error);
  }

  if (!response.ok) {
    throw new HubSpotOAuthError(`HubSpot rejected the revoke request (status ${response.status}).`);
  }
}
