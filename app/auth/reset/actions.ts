"use server";

// Sprint 12, Ticket 65 — "Password Reset Flow". The set-a-new-password half.
// Reached only after app/auth/recover/actions.ts verified a recovery link.
// Same plain "use server" action + redirect-with-a-code pattern as
// app/register: a raw Supabase message never reaches the seller —
// app/auth/reset/page.tsx owns turning a code into human copy.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RECOVERY_MARKER_COOKIE } from "@/lib/auth/recovery-marker";
import { getRecoveryUser } from "@/lib/auth/recovery-session";
import { LINK_EXPIRED_PATH, RESET_PATH, RESET_SUCCESS_PATH } from "@/lib/auth/reset-routes";
import { validateNewPassword, type NewPasswordError } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const SAME_PASSWORD_CODE = "same_password";

// Type-only export: erased at build time, so it is legal in a "use server"
// file. ./page.tsx keys its copy table on it, so a new code without copy is
// a compile error rather than a silent "Something went wrong".
export type ResetErrorCode = NewPasswordError | "same_password" | "update_failed";

function redirectWithError(code: ResetErrorCode): never {
  redirect(`${RESET_PATH}?error=${code}`);
}

export async function setNewPassword(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const supabase = await createClient();
  if (!(await getRecoveryUser(supabase))) {
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

  redirect(RESET_SUCCESS_PATH);
}
