import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import {
  RECOVERY_MARKER_COOKIE,
  RECOVERY_MARKER_TTL_SECONDS,
  signRecoveryMarker,
} from "@/lib/auth/recovery-marker";
import { createClient } from "@/lib/supabase/server";

// Sprint 8, Ticket 39 — the emailRedirectTo target for both the magic-link
// sign-in (app/admin/login/actions.ts's sendMagicLink) and Supabase's own
// confirmation emails. GET only: this is the link a seller clicks from
// their inbox, not an API called from app code.
//
// Sprint 12, Ticket 65 — also the landing point for password-reset links
// (lib/auth/password-reset.ts). Closes the Sprint 12 panel finding: `type`
// used to be cast straight from the query string into verifyOtp. It is now
// allow-listed, and each allowed type maps to ONE fixed internal path. The
// ticket's original `?next=` idea was dropped on purpose — a destination read
// from the link is an open redirect on a route that also signs people in.
const INVALID_LINK_MESSAGE = "That sign-in link is invalid or has expired. Request a new one.";
const SIGN_IN_FAILURE_PATH = `/admin/login?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`;
const RECOVERY_FAILURE_PATH = "/forgot-password?error=link_expired";
const RECOVERY_SUCCESS_PATH = "/auth/reset";

interface LinkRoute {
  readonly successPath: string;
  readonly failurePath: string;
}

const SIGN_IN_ROUTE: LinkRoute = { successPath: "/admin", failurePath: SIGN_IN_FAILURE_PATH };

// Only the link types this app actually sends. Anything else (invite,
// email_change, phone_change, ...) is refused before Supabase is called.
const LINK_ROUTES: Partial<Record<EmailOtpType, LinkRoute>> = {
  email: SIGN_IN_ROUTE,
  magiclink: SIGN_IN_ROUTE,
  signup: SIGN_IN_ROUTE,
  recovery: { successPath: RECOVERY_SUCCESS_PATH, failurePath: RECOVERY_FAILURE_PATH },
};

function isAllowedLinkType(type: string): type is EmailOtpType {
  return Object.hasOwn(LINK_ROUTES, type);
}

async function setRecoveryMarker(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_MARKER_COOKIE, signRecoveryMarker(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: RECOVERY_SUCCESS_PATH,
    maxAge: RECOVERY_MARKER_TTL_SECONDS,
  });
}

export async function GET(request: Request): Promise<never> {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || !type || !isAllowedLinkType(type)) {
    redirect(SIGN_IN_FAILURE_PATH);
  }

  const route = LINK_ROUTES[type] ?? SIGN_IN_ROUTE;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error || !data.user) {
    redirect(route.failurePath);
  }

  if (type === "recovery") {
    await setRecoveryMarker(data.user.id);
  }

  redirect(route.successPath);
}
