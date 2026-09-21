"use server";

// Sprint 12, Ticket 65 — "Password Reset Flow". The set-a-new-password half.
// Reached only after app/auth/confirm/route.ts verified a recovery link.
// Same plain "use server" action + redirect-with-a-code pattern as
// app/register: a raw Supabase message never reaches the seller —
// app/auth/reset/page.tsx owns turning a code into human copy.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RECOVERY_MARKER_COOKIE } from "@/lib/auth/recovery-marker";
import { hasRecoverySession } from "@/lib/auth/recovery-session";
import { validateNewPassword } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const LINK_EXPIRED_PATH = "/forgot-password?error=link_expired";
const RESET_PATH = "/auth/reset";
const SUCCESS_PATH = "/admin";
const SAME_PASSWORD_CODE = "same_password";

type ResetErrorCode = "password_required" | "password_too_short" | "password_mismatch" | "same_password" | "update_failed";

function redirectWithError(code: ResetErrorCode): never {
  redirect(`${RESET_PATH}?error=${code}`);
}

export async function setNewPassword(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const supabase = await createClient();
  if (!(await hasRecoverySession(supabase))) {
    redirect(LINK_EXPIRED_PATH);
  }

  const inputError = validateNewPassword(password, confirmPassword);
  if (inputError) {
    redirectWithError(inputError);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === SAME_PASSWORD_CODE) {
      redirectWithError("same_password");
    }
    console.error("[reset-password] updating the password failed:", error.code ?? error.name);
    redirectWithError("update_failed");
  }

  // The seller may be resetting because someone else knows the old password.
  // End every OTHER session; this browser stays signed in. Not fatal if it
  // fails — the password itself has already changed.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.error("[reset-password] signing out other sessions failed:", signOutError.name);
  }

  const cookieStore = await cookies();
  cookieStore.delete({ name: RECOVERY_MARKER_COOKIE, path: RESET_PATH });

  redirect(SUCCESS_PATH);
}
