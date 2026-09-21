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
export async function hasRecoverySession(client?: SupabaseClient): Promise<boolean> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;

  const cookieStore = await cookies();
  const marker = cookieStore.get(RECOVERY_MARKER_COOKIE)?.value;
  return verifyRecoveryMarker(marker, data.user.id);
}
