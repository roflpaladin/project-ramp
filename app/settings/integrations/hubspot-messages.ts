// Sprint 10, Ticket 52 — friendly copy for the redirect query params the
// HubSpot OAuth routes (app/api/integrations/hubspot/oauth/start|callback)
// and disconnectHubSpot (hubspot-actions.ts) send back to this page. Kept as
// a plain, pure module (no JSX, no server-only import) so the mapping itself
// is unit-testable without rendering anything.
//
// NOTE on a pre-existing param collision: this page's `?error=` query
// param is already used by the CRM stage-mapping save action (actions.ts,
// Sprint 3), which puts arbitrary free-text sentences on it (e.g. "Pick a
// stage from the list."), not a fixed code. mapHubSpotErrorMessage only
// recognizes the closed set of codes the HubSpot routes actually emit (each
// route's own CallbackError-shaped union — see the callback route's header);
// anything else, including the CRM action's free text, returns null so
// page.tsx's existing generic error paragraph keeps rendering it verbatim,
// unchanged. The two features were built independently and happen to share
// one query param; this is the least invasive way to keep both working
// without changing either action's already-committed redirect contract.

const HUBSPOT_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "You need to be signed in to connect HubSpot.",
  missing_tenant: "Your account has no tenant assigned yet, so it can't connect to HubSpot.",
  // T52 code review (MEDIUM) — emitted by the OAuth start/callback routes
  // and disconnectHubSpot when lib/rate-limit.ts's HUBSPOT_OAUTH_RATE_LIMIT
  // is exceeded for this seller.
  rate_limited: "Too many requests. Wait a minute and try again.",
  denied: "HubSpot authorization was cancelled.",
  invalid_state: "That HubSpot connection request expired or was invalid. Try connecting again.",
  missing_code: "HubSpot didn't return an authorization code. Try connecting again.",
  exchange_failed: "We couldn't complete the HubSpot connection. Try again.",
  save_failed: "HubSpot connected, but we couldn't save the connection. Try again.",
  disconnect_failed: "We couldn't disconnect HubSpot. Try again.",
};

/**
 * Maps a HubSpot-flow error code to friendly, sentence-case copy. Returns
 * null for any value outside the closed set of codes the HubSpot routes
 * emit — see this file's header for why that matters on this particular
 * page (an unrecognized value is treated as "not ours" rather than shown as
 * a generic HubSpot failure).
 */
export function mapHubSpotErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return HUBSPOT_ERROR_MESSAGES[code] ?? null;
}

export const REVOKE_FAILED_WARNING_MESSAGE =
  "HubSpot was disconnected here, but revoking access on HubSpot's side failed. " +
  "You can also revoke access from your HubSpot account settings.";
