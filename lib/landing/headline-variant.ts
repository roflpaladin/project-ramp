import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { HEADLINE_VARIANT_IDS, isHeadlineVariantId, type HeadlineVariantId } from "@/app/landing-variants";

// T48 (Sprint 9, Ticket 48 — headline variant instrumentation). Sticky 50/50
// assignment between the two ids in HEADLINE_VARIANT_IDS (app/landing-
// variants.ts, the shared T48 contract). Modelled on lib/landing/mode.ts:
// the pure resolver below never throws and is fully unit-testable with an
// injected `random`, separate from the NextRequest-touching cookie
// application at the bottom of this file (which mirrors the request+response
// cookie pattern in lib/supabase/middleware.ts).

export const HEADLINE_VARIANT_COOKIE_NAME = "brava_hl";

const SECONDS_PER_DAY = 60 * 60 * 24;
const HEADLINE_VARIANT_COOKIE_MAX_AGE_DAYS = 180;
export const HEADLINE_VARIANT_COOKIE_MAX_AGE_SECONDS =
  HEADLINE_VARIANT_COOKIE_MAX_AGE_DAYS * SECONDS_PER_DAY;

/** A fresh 50/50 pick between HEADLINE_VARIANT_IDS's two ids. `random` is
 * injectable so this is deterministically testable (matches
 * resolveLandingMode's env-injection style in lib/landing/mode.ts). */
export function assignHeadlineVariant(random: () => number = Math.random): HeadlineVariantId {
  const [first, second] = HEADLINE_VARIANT_IDS;
  return random() < 0.5 ? first : second;
}

/** Sticky resolution: an already-assigned, still-valid cookie value wins;
 * anything else (missing, malformed, or a stale id from a retired variant
 * set) falls back to a fresh assignment rather than trusting the cookie or
 * throwing. Never trusts the cookie without isHeadlineVariantId. */
export function resolveHeadlineVariant(
  cookieValue: string | undefined,
  random: () => number = Math.random,
): HeadlineVariantId {
  return isHeadlineVariantId(cookieValue) ? cookieValue : assignHeadlineVariant(random);
}

/**
 * Middleware-side cookie assignment. Runs only for "/" (see middleware.ts's
 * matcher/branch) — leaves an already-valid cookie untouched, otherwise
 * assigns and writes it to BOTH `request.cookies` and the response: the
 * request-side write is what lets the root Server Component read the
 * freshly-assigned value via next/headers `cookies()` on this very first
 * request (same trick lib/supabase/middleware.ts uses for the auth
 * session) — without it, the first visit would render as "unassigned"
 * server-side and only take effect on the next load.
 */
export function applyHeadlineVariantCookie(request: NextRequest): NextResponse {
  const existing = request.cookies.get(HEADLINE_VARIANT_COOKIE_NAME)?.value;
  if (isHeadlineVariantId(existing)) {
    return NextResponse.next({ request });
  }

  const variant = assignHeadlineVariant();
  request.cookies.set(HEADLINE_VARIANT_COOKIE_NAME, variant);

  const response = NextResponse.next({ request });
  // httpOnly + secure match every other cookie-writer in this codebase
  // (portal/view gate-actions, invite-actions); nothing client-side ever
  // reads this cookie — the client receives the variant as a rendered prop.
  response.cookies.set(HEADLINE_VARIANT_COOKIE_NAME, variant, {
    maxAge: HEADLINE_VARIANT_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secure: true,
  });
  return response;
}
