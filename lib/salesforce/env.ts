// Sprint 11, Ticket 55 — Salesforce OAuth app credentials, redirect URI, and
// login base URL. Mirrors lib/hubspot/env.ts's shape (lazy env reads inside
// each function, not cached at module load; same FALLBACK_ORIGIN) — see that
// file's header for the reasoning, reused verbatim here.

/**
 * Scopes granted on the live org's External Client App (founder config,
 * 2026-09-04): `api` (data access) + `refresh_token` (offline access, so the
 * connection survives past the user's own browser session — required for
 * this ticket's whole point, a per-tenant refresh-token lifecycle).
 *
 * T51's desk-research spike pack also listed `web` as a third scope — deliberately
 * omitted here: there is no web-session use case for an API-only server-to-server
 * integration (least privilege), and the live ECA the founder configured today
 * doesn't grant it either. Add it only if a real, concrete need for it appears.
 */
export const SALESFORCE_SCOPES = ["api", "refresh_token"] as const;

export const SALESFORCE_SCOPE_STRING = SALESFORCE_SCOPES.join(" ");

export function getSalesforceClientId(): string {
  const value = process.env.SALESFORCE_CLIENT_ID;
  if (!value) {
    throw new Error("SALESFORCE_CLIENT_ID is not configured. See docs/environments.md.");
  }
  return value;
}

export function getSalesforceClientSecret(): string {
  const value = process.env.SALESFORCE_CLIENT_SECRET;
  if (!value) {
    throw new Error("SALESFORCE_CLIENT_SECRET is not configured. See docs/environments.md.");
  }
  return value;
}

// getbrava.tech is the registered production domain (founder decision
// 2026-08-16 — .tech, not .io); mirrors lib/hubspot/env.ts's own
// FALLBACK_ORIGIN and invite-actions.ts's.
const FALLBACK_ORIGIN = "https://getbrava.tech";

/**
 * `/api/integrations/salesforce/oauth/callback`'s absolute URL. Deliberately
 * sourced ONLY from NEXT_PUBLIC_APP_URL, never request-forwarded headers —
 * same reasoning as lib/hubspot/env.ts's getHubSpotRedirectUri(): this value
 * must exactly match what's registered on the Salesforce External Client App
 * per environment (prod's registration: https://getbrava.tech/api/integrations/
 * salesforce/oauth/callback, confirmed 2026-09-04); a header-derived value
 * would silently mismatch that registration on any deploy where forwarded
 * headers aren't exactly the configured origin.
 */
export function getSalesforceRedirectUri(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = configured || FALLBACK_ORIGIN;
  return `${origin}/api/integrations/salesforce/oauth/callback`;
}

// The dev org (a Developer Edition) and prod both authenticate against
// Salesforce's standard production login host — a sandbox org would instead
// need https://test.salesforce.com. Optional override so a future sandbox
// connection (or a My Domain host) doesn't need a code change, only an env
// var, mirroring every other per-environment value in this file.
const DEFAULT_LOGIN_BASE_URL = "https://login.salesforce.com";

export function getSalesforceLoginBaseUrl(): string {
  const configured = process.env.SALESFORCE_LOGIN_BASE_URL?.trim();
  return configured || DEFAULT_LOGIN_BASE_URL;
}
