// Sprint 10, Ticket 52 — HubSpot OAuth app credentials + redirect URI.
// Read lazily (inside each function), not cached at module load, matching
// lib/encrypt-secret.ts's readEncryptionKey() and lib/portal-session.ts's
// PORTAL_SESSION_SECRET reads — a missing var fails loud at first USE, not
// at import time (which would break every test file that imports a module
// that transitively imports this one, even if it never calls these).

/**
 * Read-only scopes this ticket requests: enough to read deal, company, and
 * contact objects for the CRM ingestion pipeline (lib/crm/ingest.ts) to
 * eventually consume. No write scope — this integration never mutates
 * HubSpot data.
 */
export const HUBSPOT_SCOPES = [
  "crm.objects.deals.read",
  "crm.objects.companies.read",
  "crm.objects.contacts.read",
] as const;

export const HUBSPOT_SCOPE_STRING = HUBSPOT_SCOPES.join(" ");

export function getHubSpotClientId(): string {
  const value = process.env.HUBSPOT_CLIENT_ID;
  if (!value) {
    throw new Error("HUBSPOT_CLIENT_ID is not configured. See docs/environments.md.");
  }
  return value;
}

export function getHubSpotClientSecret(): string {
  const value = process.env.HUBSPOT_CLIENT_SECRET;
  if (!value) {
    throw new Error("HUBSPOT_CLIENT_SECRET is not configured. See docs/environments.md.");
  }
  return value;
}

// getbrava.tech is the registered production domain (founder decision
// 2026-08-16 — .tech, not .io); mirrors invite-actions.ts's FALLBACK_ORIGIN.
const FALLBACK_ORIGIN = "https://getbrava.tech";

/**
 * `/api/integrations/hubspot/oauth/callback`'s absolute URL — the redirect
 * URI HubSpot sends the authorization code back to. Deliberately sourced
 * ONLY from the deploy-configured NEXT_PUBLIC_APP_URL, unlike
 * invite-actions.ts's buildPortalUrl(), which falls back to
 * request-forwarded headers for a dev/preview convenience: the OAuth
 * redirect_uri must be registered, byte-for-byte, in the HubSpot app's
 * settings per environment (docs/environments.md) — a header-derived value
 * would silently mismatch that registration on any deploy where forwarded
 * headers aren't exactly the configured origin, turning into an opaque
 * HubSpot-side rejection rather than a clear config error here.
 */
export function getHubSpotRedirectUri(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = configured || FALLBACK_ORIGIN;
  return `${origin}/api/integrations/hubspot/oauth/callback`;
}
