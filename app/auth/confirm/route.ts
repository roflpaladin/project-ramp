import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { LINK_EXPIRED_PATH, RECOVER_PATH, isPlausibleTokenHash } from "@/lib/auth/reset-routes";
import { createClient } from "@/lib/supabase/server";

// Sprint 8, Ticket 39 — the emailRedirectTo target for both the magic-link
// sign-in (app/admin/login/actions.ts's sendMagicLink) and Supabase's own
// confirmation emails. GET only: this is the link a seller clicks from
// their inbox, not an API called from app code.
//
// Sprint 12, Ticket 65 — also the landing point for password-reset links
// (lib/auth/password-reset.ts). Closes the Sprint 12 panel finding: `type`
// used to be cast straight from the query string into verifyOtp. It is now
// allow-listed, and every destination is a fixed internal path. The ticket's
// original `?next=` idea was dropped on purpose — a destination read from
// the link is an open redirect on a route that also signs people in.
//
// A recovery link is NOT verified here (security review MEDIUM-2/3). Mail
// scanners (Outlook Safe Links, Proofpoint, Mimecast) open links before the
// person does; verifying on GET would let the scanner burn the one-time
// token — and be handed a live session for the seller. The token is only
// forwarded to /auth/recover, whose button POSTs it. Sign-in link types keep
// their existing verify-on-GET behaviour; changing that is out of T65 scope.
const INVALID_LINK_MESSAGE = "That sign-in link is invalid or has expired. Request a new one.";
const SIGN_IN_FAILURE_PATH = `/admin/login?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`;
const SIGN_IN_SUCCESS_PATH = "/admin";
const RECOVERY_TYPE = "recovery";

// Only the link types this app actually sends. Anything else (invite,
// email_change, phone_change, ...) is refused before Supabase is called.
const SIGN_IN_LINK_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup"];

function isSignInLinkType(type: string): type is EmailOtpType {
  return (SIGN_IN_LINK_TYPES as readonly string[]).includes(type);
}

function forwardRecoveryLink(tokenHash: string): never {
  if (!isPlausibleTokenHash(tokenHash)) {
    redirect(LINK_EXPIRED_PATH);
  }
  const query = new URLSearchParams({ token_hash: tokenHash });
  redirect(`${RECOVER_PATH}?${query.toString()}`);
}

export async function GET(request: Request): Promise<never> {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || !type) {
    redirect(SIGN_IN_FAILURE_PATH);
  }

  if (type === RECOVERY_TYPE) {
    forwardRecoveryLink(tokenHash);
  }

  if (!isSignInLinkType(type)) {
    redirect(SIGN_IN_FAILURE_PATH);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    redirect(SIGN_IN_FAILURE_PATH);
  }

  redirect(SIGN_IN_SUCCESS_PATH);
}
