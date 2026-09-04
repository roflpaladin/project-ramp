import { NextResponse } from "next/server";

import { SALESFORCE_SCOPE_STRING } from "@/lib/salesforce/env";
import { verifyOAuthState } from "@/lib/salesforce/oauth-state";
import { PKCE_COOKIE_NAME, PKCE_COOKIE_PATH, readCookieValue } from "@/lib/salesforce/pkce";
import { exchangeCodeForTokens } from "@/lib/salesforce/token-exchange";
import { saveTenantTokens } from "@/lib/crm-connections/token-store";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 11, Ticket 55 — completes the Salesforce OAuth flow started by
// .../oauth/start/route.ts. Mirrors app/api/integrations/hubspot/oauth/callback/route.ts's
// shape (requireSeller first, rate limit, verify signed state, exchange,
// save, fixed closed `?error=` code set that never carries a raw
// upstream response) — see that file's header for the full reasoning,
// unchanged here.
//
// `?error=` codes here are prefixed `sf_`, deliberately NOT reusing
// HubSpot's own bare code strings (`exchange_failed`, `save_failed`, etc.)
// even though several mean the same thing — app/settings/integrations/page.tsx
// renders ONE shared `?error=` query param for every integration on that
// page (HubSpot's routes, the CRM stage-mapping action, and now this one).
// An unprefixed `exchange_failed` from THIS route would otherwise satisfy
// hubspot-messages.ts's mapHubSpotErrorMessage() and render "We couldn't
// complete the HubSpot connection" for a Salesforce failure — wrong
// provider name shown to the seller. The `sf_` prefix keeps the two
// providers' error codes in disjoint namespaces on that one shared param.
type CallbackError =
  | "sf_unauthenticated"
  | "sf_missing_tenant"
  | "sf_rate_limited"
  | "sf_denied"
  | "sf_invalid_state"
  | "sf_missing_code"
  | "sf_missing_verifier"
  | "sf_exchange_failed"
  | "sf_save_failed";

function clearPkceCookie(response: NextResponse): void {
  response.cookies.set(PKCE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: PKCE_COOKIE_PATH,
  });
}

function redirectWithError(request: Request, code: CallbackError): NextResponse {
  const response = NextResponse.redirect(new URL(`/settings/integrations?error=${code}`, request.url));
  clearPkceCookie(response);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const seller = await requireSeller();
  if (!seller) {
    return redirectWithError(request, "sf_unauthenticated");
  }
  if (!seller.tenantId) {
    return redirectWithError(request, "sf_missing_tenant");
  }

  const limit = checkRateLimit(
    `salesforce-oauth-callback:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return redirectWithError(request, "sf_rate_limited");
  }

  const url = new URL(request.url);
  // Salesforce sends `error` (e.g. the user clicked "Deny") instead of a code.
  if (url.searchParams.get("error")) {
    return redirectWithError(request, "sf_denied");
  }

  const state = url.searchParams.get("state");
  const verified = state ? verifyOAuthState(state) : null;
  if (!verified || verified.tenantId !== seller.tenantId) {
    return redirectWithError(request, "sf_invalid_state");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return redirectWithError(request, "sf_missing_code");
  }

  // PKCE verifier the /start route stashed in a short-lived cookie — see
  // lib/salesforce/pkce.ts's header. Read from the raw Cookie header (not
  // next/headers's cookies()) so this route works against a plain `Request`
  // in tests exactly like the rest of this route's dependencies, with no
  // Next request-scope needed to read it.
  const codeVerifier = readCookieValue(request.headers.get("cookie"), PKCE_COOKIE_NAME);
  if (!codeVerifier) {
    return redirectWithError(request, "sf_missing_verifier");
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only; the redirect above never carries this text.
    console.error("[salesforce oauth callback] token exchange failed:", error);
    return redirectWithError(request, "sf_exchange_failed");
  }

  try {
    await saveTenantTokens({
      tenantId: seller.tenantId,
      provider: "salesforce",
      refreshToken: tokens.refreshToken,
      instanceUrl: tokens.instanceUrl,
      scope: SALESFORCE_SCOPE_STRING,
      connectedBy: seller.userId,
    });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[salesforce oauth callback] saving tokens failed:", error);
    return redirectWithError(request, "sf_save_failed");
  }

  const response = NextResponse.redirect(new URL("/settings/integrations?connected=salesforce", request.url));
  clearPkceCookie(response);
  return response;
}
