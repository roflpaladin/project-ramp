import { NextResponse } from "next/server";

import { HUBSPOT_SCOPE_STRING, getHubSpotClientId, getHubSpotRedirectUri } from "@/lib/hubspot/env";
import { signOAuthState } from "@/lib/hubspot/oauth-state";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 10, Ticket 52 — begins the HubSpot OAuth flow. Redirects an
// authenticated seller's browser straight to HubSpot's own authorize screen
// (no intermediate page needed) carrying a signed `state`
// (lib/hubspot/oauth-state.ts) that the callback route verifies before
// trusting the request came from the flow this route actually started for
// this tenant, not a CSRF'd redirect.
//
// GET (not a "use server" action) because this route's whole job is a
// browser navigation/redirect, exactly like app/portal/[id]'s sibling
// gate routes and the invite flow's portal link — there is no form
// submission here to make a Server Action a better fit.
const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";

export async function GET(request: Request): Promise<NextResponse> {
  const seller = await requireSeller();
  if (!seller) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!seller.tenantId) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent("missing_tenant")}`, request.url),
    );
  }

  // T52 code review (MEDIUM) — keyed per seller, after the cheap auth checks
  // above and before this route does any real work (building the authorize
  // URL and handing the browser off to HubSpot).
  const limit = checkRateLimit(
    `hubspot-oauth-start:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent("rate_limited")}`, request.url),
    );
  }

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", getHubSpotClientId());
  authorizeUrl.searchParams.set("redirect_uri", getHubSpotRedirectUri());
  authorizeUrl.searchParams.set("scope", HUBSPOT_SCOPE_STRING);
  authorizeUrl.searchParams.set("state", signOAuthState(seller.tenantId));

  return NextResponse.redirect(authorizeUrl);
}
