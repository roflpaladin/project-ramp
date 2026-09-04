import { createHash, randomBytes } from "node:crypto";

// Sprint 11, Ticket 55 — PKCE (RFC 7636) helpers for the Salesforce OAuth web
// server flow. Salesforce's External Client App has PKCE FORCED ON (founder
// config, 2026-09-04): every authorize request must carry a code_challenge,
// and the callback's token exchange must carry the matching code_verifier
// or Salesforce rejects the exchange outright. HubSpot's flow (lib/hubspot/*)
// has no PKCE requirement, so this has no HubSpot equivalent to mirror.

// 32 random bytes, base64url-encoded, is 43 characters — RFC 7636 §4.1's
// minimum length, comfortably inside its 43-128 range.
const CODE_VERIFIER_BYTES = 32;

/**
 * Generates a fresh PKCE code_verifier: cryptographically random bytes,
 * base64url-encoded. base64url's alphabet ([A-Za-z0-9-_]) is a subset of
 * RFC 7636 §4.1's unreserved character set (ALPHA / DIGIT / "-" / "." /
 * "_" / "~"), so every character it can produce is already valid — the RFC
 * doesn't require using the full set, only staying inside it.
 */
export function generateCodeVerifier(): string {
  return randomBytes(CODE_VERIFIER_BYTES).toString("base64url");
}

/**
 * Derives the S256 code_challenge for a code_verifier (RFC 7636 §4.2):
 * BASE64URL-ENCODE(SHA256(ASCII(code_verifier))). The verifier is always
 * ASCII by construction (generateCodeVerifier's base64url output), so
 * `"ascii"` is a safe, exact encoding to hash over rather than the wider
 * `"utf8"` default.
 */
export function codeChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

// PKCE verifier cookie — set by the /start route (alongside the redirect to
// Salesforce's authorize screen), read and cleared by the /callback route.
// Mirrors lib/portal-session.ts's cookie conventions (httpOnly, secure,
// sameSite=lax) — see that file's own cookie-set call sites (e.g.
// app/portal/[id]/gate-actions.ts) for the precedent. Scoped to this one
// path (not "/", unlike the portal session cookie, which several other
// routes also need) so the verifier is never sent anywhere except the two
// routes that need it.
export const PKCE_COOKIE_NAME = "sf_pkce_verifier";
export const PKCE_COOKIE_PATH = "/api/integrations/salesforce/oauth";
// 10 minutes — matches lib/salesforce/oauth-state.ts's signed `state` TTL;
// the verifier is only ever needed for the single round trip through
// Salesforce's own consent screen and back.
export const PKCE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/**
 * Reads a named cookie's value out of a raw `Cookie` request header.
 * Framework-agnostic (plain string in, string out) so it works against
 * both a real browser-sent header and the plain `Request` objects this
 * project's route-handler tests construct directly — no `next/headers`
 * dependency, which would need request-scope this module doesn't have.
 */
export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const value = pair.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
