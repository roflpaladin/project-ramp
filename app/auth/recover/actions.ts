"use server";

// Sprint 12, Ticket 65 — "Password Reset Flow" (security review MEDIUM-2/3).
// The ONLY place a recovery token is spent. It runs on the POST from
// ./page.tsx's button — never on the GET an emailed link produces — so a
// mail scanner pre-opening the link cannot burn the token or be handed the
// seller's session. On success it sets the recovery marker
// (lib/auth/recovery-marker.ts) that /auth/reset requires.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  RECOVERY_MARKER_COOKIE,
  RECOVERY_MARKER_TTL_SECONDS,
  signRecoveryMarker,
} from "@/lib/auth/recovery-marker";
import { LINK_EXPIRED_PATH, RESET_PATH, isPlausibleTokenHash } from "@/lib/auth/reset-routes";
import { createClient } from "@/lib/supabase/server";

const PREFLIGHT_USER_ID = "preflight";

// Signing throws when APP_ENCRYPTION_KEY is missing or malformed. Finding
// that out AFTER verifyOtp would burn the seller's one-time token on a
// request that then fails, so it is checked first.
function canSignRecoveryMarker(): boolean {
  try {
    signRecoveryMarker(PREFLIGHT_USER_ID);
    return true;
  } catch (error) {
    console.error(
      "[auth-recover] the recovery marker cannot be signed:",
      error instanceof Error ? error.name : "unknown error",
    );
    return false;
  }
}

export async function continueRecovery(formData: FormData): Promise<void> {
  const tokenHash = formData.get("token_hash");

  if (typeof tokenHash !== "string" || !isPlausibleTokenHash(tokenHash) || !canSignRecoveryMarker()) {
    redirect(LINK_EXPIRED_PATH);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });

  if (error || !data.user) {
    redirect(LINK_EXPIRED_PATH);
  }

  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_MARKER_COOKIE, signRecoveryMarker(data.user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: RESET_PATH,
    maxAge: RECOVERY_MARKER_TTL_SECONDS,
  });

  redirect(RESET_PATH);
}
