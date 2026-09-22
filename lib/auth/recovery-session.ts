import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { RECOVERY_MARKER_COOKIE, verifyRecoveryMarker } from "./recovery-marker";

// Sprint 12, Ticket 65 — "Password Reset Flow". The one guard in front of
// /auth/reset, shared by the page (to decide whether to render the form) and
// the action (to decide whether to change the password). /auth/* is outside
// middleware.ts's matcher, so nothing else protects this route.
//
// Both conditions must hold: a signed-in Supabase user, AND a recovery
// marker signed for that same user — see ./recovery-marker.ts for why a
// session alone is not enough.

export interface RecoveryUser {
  readonly id: string;
  /** Shown on the reset page so the visitor can see WHOSE password this is. */
  readonly email: string;
}

/** The user this browser may set a new password for, or `null`. */
export async function getRecoveryUser(client?: SupabaseClient): Promise<RecoveryUser | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const cookieStore = await cookies();
  const marker = cookieStore.get(RECOVERY_MARKER_COOKIE)?.value;
  if (!verifyRecoveryMarker(marker, data.user.id)) return null;

  return { id: data.user.id, email: data.user.email ?? "" };
}
