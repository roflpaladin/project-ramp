import { NextResponse } from "next/server";

import { SALESFORCE_SCOPE_STRING, getSalesforceClientId, getSalesforceLoginBaseUrl, getSalesforceRedirectUri } from "@/lib/salesforce/env";
import { signOAuthState } from "@/lib/salesforce/oauth-state";
import { codeChallengeS256, generateCodeVerifier, PKCE_COOKIE_MAX_AGE_SECONDS, PKCE_COOKIE_NAME, PKCE_COOKIE_PATH } from "@/lib/salesforce/pkce";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 11, Ticket 55 — begins the Salesforce OAuth flow. Mirrors
// app/api/integrations/hubspot/oauth/start/route.ts's shape (requireSeller
// -> rate limit -> signed state -> redirect straight to the provider's own
// authorize screen) — see that file's header for the reasoning behind each
// step, unchanged here. Two Salesforce-specific additions:
//
// 1. PKCE — the live org's External Client App forces it on (founder
//    config, 2026-09-04): this route generates a fresh code_verifier, sends
//    only its S256 code_challenge in the authorize URL, and stashes the
//    verifier itself in a short-lived, httpOnly cookie (mirrors
//    lib/portal-session.ts's cookie conventions — see lib/salesforce/pkce.ts's
//    header) for the callback route to read back and complete the exchange
//    with.
// 2. Login base URL — Salesforce's authorize/token/revoke hosts are
//    per-environment (login.salesforce.com vs a sandbox's test.salesforce.com),
//    unlike HubSpot's single fixed app.hubspot.com.
export async function GET(request: Request): Promise<NextResponse> {
  const seller = await requireSeller();
  if (!seller) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!seller.tenantId) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent("sf_missing_tenant")}`, request.url),
    );
  }

  // Same reasoning as the HubSpot route's identical check: keyed per seller,
  // after the cheap auth checks above and before this route does any real
  // work (building the authorize URL and handing the browser off to
  // Salesforce). CRM_OAUTH_RATE_LIMIT is shared with HubSpot's own
  // start/callback/disconnect routes (lib/rate-limit.ts) — same threat model,
  // one budget.
  const limit = checkRateLimit(
    `salesforce-oauth-start:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent("sf_rate_limited")}`, request.url),
    );
  }

  const codeVerifier = generateCodeVerifier();

  const authorizeUrl = new URL(`${getSalesforceLoginBaseUrl()}/services/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", getSalesforceClientId());
  authorizeUrl.searchParams.set("redirect_uri", getSalesforceRedirectUri());
  authorizeUrl.searchParams.set("scope", SALESFORCE_SCOPE_STRING);
  authorizeUrl.searchParams.set("state", signOAuthState(seller.tenantId));
  authorizeUrl.searchParams.set("code_challenge", codeChallengeS256(codeVerifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(PKCE_COOKIE_NAME, codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
    path: PKCE_COOKIE_PATH,
  });
  return response;
}
