import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applyHeadlineVariantCookie } from "@/lib/landing/headline-variant";

export function middleware(request: NextRequest) {
  // T48: the headline A/B cookie is assigned here rather than at render
  // time — the trade-off (forcing the root page out of static generation
  // so it can read the cookie with zero client-side flash) is documented
  // beside the `cookies()` call in app/page.tsx. "/" only ever needs this
  // branch, never the Supabase auth-session refresh below.
  if (request.nextUrl.pathname === "/") {
    return applyHeadlineVariantCookie(request);
  }
  return updateSession(request);
}

// /admin and /settings are gated here — /portal has its own access model
// (magic-link token, not Supabase Auth) built in the Security Gate ticket.
export const config = {
  matcher: ["/", "/admin/:path*", "/settings/:path*"],
};
