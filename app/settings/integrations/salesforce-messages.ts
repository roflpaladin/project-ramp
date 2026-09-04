// Sprint 11, Ticket 55 — friendly copy for the redirect query params the
// Salesforce OAuth routes (app/api/integrations/salesforce/oauth/start|callback)
// and disconnectSalesforce (salesforce-actions.ts) send back to
// /settings/integrations. Mirrors app/settings/integrations/hubspot-messages.ts's
// shape (a plain, pure module — no JSX, no server-only import — so the
// mapping itself is unit-testable without rendering anything).
//
// Every code here is prefixed `sf_` — see the OAuth callback route's own
// header for why: this page's `?error=`/`?warning=` query params are shared
// across HubSpot's routes, this ticket's Salesforce routes, and the
// pre-existing CRM stage-mapping action's free-text errors, all landing on
// the SAME query param. mapSalesforceErrorMessage only recognizes this
// closed, `sf_`-prefixed set; anything else (including a bare HubSpot code)
// returns null, exactly like mapHubSpotErrorMessage does for anything
// outside its own set.

const SALESFORCE_ERROR_MESSAGES: Record<string, string> = {
  sf_unauthenticated: "You need to be signed in to connect Salesforce.",
  sf_missing_tenant: "Your account has no tenant assigned yet, so it can't connect to Salesforce.",
  sf_rate_limited: "Too many requests. Wait a minute and try again.",
  sf_denied: "Salesforce authorization was cancelled.",
  sf_invalid_state: "That Salesforce connection request expired or was invalid. Try connecting again.",
  sf_missing_code: "Salesforce didn't return an authorization code. Try connecting again.",
  sf_missing_verifier:
    "That Salesforce connection request expired or was opened in a different browser. Try connecting again.",
  sf_exchange_failed: "We couldn't complete the Salesforce connection. Try again.",
  sf_save_failed: "Salesforce connected, but we couldn't save the connection. Try again.",
  sf_disconnect_failed: "We couldn't disconnect Salesforce. Try again.",
};

/**
 * Maps a Salesforce-flow error code to friendly, sentence-case copy. Returns
 * null for any value outside this closed `sf_`-prefixed set — see this
 * file's header for why that matters on this shared-query-param page.
 */
export function mapSalesforceErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return SALESFORCE_ERROR_MESSAGES[code] ?? null;
}

export const SALESFORCE_REVOKE_FAILED_WARNING_MESSAGE =
  "Salesforce was disconnected here, but revoking access on Salesforce's side failed. " +
  "You can also revoke access from your Salesforce account's Connected Apps settings.";

/**
 * `sf_reauth_required` — forward groundwork for T56's CRM read paths: when
 * lib/salesforce/get-client.ts's refresh fails with a
 * SalesforceReauthRequiredError (lib/salesforce/token-exchange.ts's header —
 * Salesforce's per-org refresh-token-expiry policy makes this an EXPECTED
 * lifecycle event, not an anomaly), the seller needs to reconnect, not see a
 * scary failure. Nothing in this ticket redirects with this code yet (no
 * route today calls getSalesforceClientForTenant) — the message is defined
 * now so T56 has a calm, ready-made way to surface it. Deliberately NOT in
 * SALESFORCE_ERROR_MESSAGES / rendered in the card's red error box — see
 * salesforce-card.tsx's SalesforceConnectionCardProps.reauthRequiredWarning.
 */
export const SALESFORCE_REAUTH_REQUIRED_MESSAGE =
  "Your Salesforce connection expired. Reconnect to keep your deal data in sync.";
