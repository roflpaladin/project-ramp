import { sendViaResend } from "./resend-transport";
import { buildResetPasswordEmail } from "./templates/reset-password";

// Sprint 12, Ticket 65 — "Password Reset Flow". Sends the branded reset
// email through Resend (founder ruling 2026-09-21: our own template in code,
// not Supabase Auth's dashboard template — no per-project template edits).
// Same fail-soft `{ ok: boolean }` contract as ./send-access-code.ts.
export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}): Promise<{ ok: boolean }> {
  return sendViaResend({
    to,
    content: buildResetPasswordEmail({ resetUrl }),
    logTag: "send-password-reset",
  });
}
