import { NextResponse } from "next/server";

import { HUBSPOT_SCOPE_STRING } from "@/lib/hubspot/env";
import { verifyOAuthState } from "@/lib/hubspot/oauth-state";
import { exchangeCodeForTokens } from "@/lib/hubspot/token-exchange";
import { saveTenantTokens } from "@/lib/crm-connections/token-store";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 10, Ticket 52 — completes the HubSpot OAuth flow started by
// .../oauth/start/route.ts. Every failure mode redirects to
// /settings/integrations with one of a fixed, closed set of `?error=` codes
// — never the raw exception/response text an upstream failure carried, so
// nothing HubSpot (or an attacker manipulating the callback URL) sends back
// is ever reflected into the page.
//
// requireSeller() runs first, exactly like every other guarded surface in
// this codebase (T28-9's contract) — the browser completing this redirect
// still carries the seller's own session cookie (same browser that started
// the flow), so this is a normal authenticated request, not a webhook.

type CallbackError =
  | "unauthenticated"
  | "missing_tenant"
  | "rate_limited"
  | "denied"
  | "invalid_state"
  | "missing_code"
  | "exchange_failed"
  | "save_failed";

function redirectWithError(request: Request, code: CallbackError): NextResponse {
  return NextResponse.redirect(new URL(`/settings/integrations?error=${code}`, request.url));
}

export async function GET(request: Request): Promise<NextResponse> {
  const seller = await requireSeller();
  if (!seller) {
    return redirectWithError(request, "unauthenticated");
  }
  if (!seller.tenantId) {
    return redirectWithError(request, "missing_tenant");
  }

  // T52 code review (MEDIUM) — keyed per seller, after the cheap auth checks
  // above and before this route does any real work (state verification,
  // the token exchange, or the DB write).
  const limit = checkRateLimit(
    `hubspot-oauth-callback:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return redirectWithError(request, "rate_limited");
  }

  const url = new URL(request.url);
  // HubSpot sends `error` (e.g. the user clicked "Don't allow") instead of a code.
  if (url.searchParams.get("error")) {
    return redirectWithError(request, "denied");
  }

  const state = url.searchParams.get("state");
  const verified = state ? verifyOAuthState(state) : null;
  if (!verified || verified.tenantId !== seller.tenantId) {
    return redirectWithError(request, "invalid_state");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return redirectWithError(request, "missing_code");
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only; the redirect above never carries this text.
    console.error("[hubspot oauth callback] token exchange failed:", error);
    return redirectWithError(request, "exchange_failed");
  }

  // external_account_id (the HubSpot hub id) is deliberately left unset here
  // — populating it needs a second call (GET /oauth/v1/access-tokens/{token})
  // this ticket doesn't otherwise need; the column exists (0010) for a
  // follow-up to fill in without a schema change.
  try {
    await saveTenantTokens({
      tenantId: seller.tenantId,
      refreshToken: tokens.refreshToken,
      scope: HUBSPOT_SCOPE_STRING,
      connectedBy: seller.userId,
    });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[hubspot oauth callback] saving tokens failed:", error);
    return redirectWithError(request, "save_failed");
  }

  return NextResponse.redirect(new URL("/settings/integrations?connected=1", request.url));
}
