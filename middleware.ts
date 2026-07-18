import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

// /admin and /settings are gated here — /portal has its own access model
// (magic-link token, not Supabase Auth) built in the Security Gate ticket.
export const config = {
  matcher: ["/admin/:path*", "/settings/:path*"],
};
