import { getSalesforceClientId, getSalesforceClientSecret, getSalesforceLoginBaseUrl, getSalesforceRedirectUri } from "./env";

// Sprint 11, Ticket 55 — Salesforce's services/oauth2/{token,revoke}
// endpoints. Mirrors lib/hubspot/token-exchange.ts's outbound-fetch shape
// (AbortSignal.timeout, throws rather than returning a sentinel, never
// echoes a raw response body to the caller) — see that file's header for the
// full "why throw" reasoning, unchanged here. Two Salesforce-specific
// differences from HubSpot's module:
//
// 1. PKCE — the live org's External Client App has PKCE forced on (founder
//    config, 2026-09-04): exchangeCodeForTokens takes a `codeVerifier`
//    HubSpot's exchange has no equivalent of.
// 2. instance_url — every Salesforce API call (T56's problem, not this
//    ticket's) goes to a per-org instance host returned in the token
//    response, unlike HubSpot's single fixed api.hubapi.com. Both grants
//    capture it.
//
// `expires_in` is typed as `number | null`, not required, on BOTH grants —
// Salesforce's default token response does not reliably include one (unlike
// HubSpot's, which always does), so this module treats it as genuinely
// optional rather than asserting a shape Salesforce doesn't promise. The
// fallback default TTL this makes necessary lives in lib/salesforce/get-client.ts's
// cache math, not here — this module's only job is honest parsing.

const FETCH_TIMEOUT_MS = 8000;

function tokenUrl(): string {
  return `${getSalesforceLoginBaseUrl()}/services/oauth2/token`;
}

function revokeUrl(): string {
  return `${getSalesforceLoginBaseUrl()}/services/oauth2/revoke`;
}

export class SalesforceOAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SalesforceOAuthError";
  }
}

/**
 * Thrown specifically when Salesforce's refresh grant fails with
 * `error: "invalid_grant"`. Per the T51 spike's evidence pack, Salesforce's
 * refresh-token expiry policy is per-org admin-controlled (e.g. "expire
 * after N days of unused"), so a dead refresh token is an EXPECTED lifecycle
 * event here, not an anomaly — the tenant's connection is simply gone and
 * the seller needs to reconnect. A distinct subclass (rather than a string
 * code on the base class) lets a caller `instanceof`-check it without
 * parsing message text, while still being a SalesforceOAuthError for any
 * caller that only wants the generic catch.
 */
export class SalesforceReauthRequiredError extends SalesforceOAuthError {
  constructor(cause?: unknown) {
    super("Your Salesforce connection needs to be reconnected.", cause);
    this.name = "SalesforceReauthRequiredError";
  }
}

export interface SalesforceAuthCodeTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly instanceUrl: string;
  readonly expiresInSeconds: number | null;
}

export interface SalesforceRefreshTokenSet {
  readonly accessToken: string;
  /** Salesforce does not rotate refresh tokens on every refresh grant by default — null unless Salesforce actually issues a new one. */
  readonly refreshToken: string | null;
  readonly instanceUrl: string;
  readonly expiresInSeconds: number | null;
}

interface RawTokenResponseBody {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly instance_url?: unknown;
  readonly expires_in?: unknown;
}

interface ParsedTokenResponseBody {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly instanceUrl: string;
  readonly expiresInSeconds: number | null;
}

// Security review (T55): instance_url is persisted and later used as the base
// URL for Bearer-authenticated API calls (lib/salesforce/get-client.ts). A
// poisoned value would be a durable SSRF primitive that ships the tenant's
// access token to an arbitrary host on every future call, so it must look
// like a real Salesforce instance host (https + a documented Salesforce
// domain) before it is ever stored.
const SALESFORCE_INSTANCE_HOST_PATTERN = /(^|\.)(my\.)?salesforce\.com$|(^|\.)force\.com$/;

export function isValidSalesforceInstanceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && SALESFORCE_INSTANCE_HOST_PATTERN.test(url.hostname);
}

function parseTokenResponseBody(body: unknown): ParsedTokenResponseBody | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as RawTokenResponseBody;
  if (typeof raw.access_token !== "string" || typeof raw.instance_url !== "string") return null;
  if (!isValidSalesforceInstanceUrl(raw.instance_url)) return null;

  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    instanceUrl: raw.instance_url,
    expiresInSeconds: typeof raw.expires_in === "number" ? raw.expires_in : null,
  };
}

/** Best-effort read of Salesforce's `{ error: "..." }` failure body — never throws, returns null on anything unexpected. */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // Not JSON, or an unexpected shape — the caller falls back to a generic error.
  }
  return null;
}

async function postToken(params: URLSearchParams, fetchImpl: typeof fetch): Promise<ParsedTokenResponseBody> {
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new SalesforceOAuthError("Couldn't reach Salesforce to complete the token request.", error);
  }

  if (!response.ok) {
    throw new SalesforceOAuthError(`Salesforce rejected the token request (status ${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new SalesforceOAuthError("Salesforce's token response was not valid JSON.", error);
  }

  const parsed = parseTokenResponseBody(body);
  if (!parsed) {
    throw new SalesforceOAuthError("Salesforce's token response was missing expected fields.");
  }
  return parsed;
}

/** Exchanges an authorization `code` + PKCE `codeVerifier` (from the OAuth callback) for an access + refresh token pair. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceAuthCodeTokenSet> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getSalesforceClientId(),
    client_secret: getSalesforceClientSecret(),
    redirect_uri: getSalesforceRedirectUri(),
    code,
    code_verifier: codeVerifier,
  });

  const parsed = await postToken(params, fetchImpl);
  if (!parsed.refreshToken) {
    throw new SalesforceOAuthError("Salesforce's token response was missing expected fields.");
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    instanceUrl: parsed.instanceUrl,
    expiresInSeconds: parsed.expiresInSeconds,
  };
}

/**
 * Exchanges a stored refresh token for a new access token. No `code_verifier`
 * on this grant — PKCE only applies to the initial authorization_code
 * exchange (RFC 7636 §1.1); a refresh grant authenticates with the client
 * credentials + refresh token alone, same as HubSpot's.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceRefreshTokenSet> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: getSalesforceClientId(),
    client_secret: getSalesforceClientSecret(),
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetchImpl(tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new SalesforceOAuthError("Couldn't reach Salesforce to complete the token request.", error);
  }

  if (!response.ok) {
    const errorCode = await readErrorCode(response);
    if (errorCode === "invalid_grant") {
      throw new SalesforceReauthRequiredError();
    }
    throw new SalesforceOAuthError(`Salesforce rejected the token request (status ${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new SalesforceOAuthError("Salesforce's token response was not valid JSON.", error);
  }

  const parsed = parseTokenResponseBody(body);
  if (!parsed) {
    throw new SalesforceOAuthError("Salesforce's token response was missing expected fields.");
  }
  return parsed;
}

/**
 * Revokes a token (access or refresh) on Salesforce's side —
 * disconnectSalesforce's (salesforce-actions.ts) best-effort step. Resolves
 * on any 2xx; throws SalesforceOAuthError otherwise — the caller decides
 * whether a revoke failure should still proceed with the local delete.
 */
export async function revokeRefreshToken(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(revokeUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new SalesforceOAuthError("Couldn't reach Salesforce to revoke the connection.", error);
  }

  if (!response.ok) {
    throw new SalesforceOAuthError(`Salesforce rejected the revoke request (status ${response.status}).`);
  }
}
