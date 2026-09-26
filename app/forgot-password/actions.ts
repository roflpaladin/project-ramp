"use server";

// Sprint 12, Ticket 65 — "Password Reset Flow". The request half: a seller
// types their email, we (maybe) email them a reset link. Same plain
// "use server" action + redirect-with-a-code pattern as app/register.
//
// The one rule that shapes this file: the caller must not be able to tell
// whether an email has an account. So every path past input validation ends
// in the SAME redirect — account found, no account, provider failure, and
// over-budget alike (distinguishing the last would hand back a probe signal,
// same reasoning as sendMagicLink in app/admin/login/actions.ts). And the
// lookup + send run in after(), once the response is already out, so
// response TIME does not leak it either.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { resolveAppOrigin } from "@/lib/auth/app-origin";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/reset-routes";
import { isValidEmail } from "@/lib/auth/validation";
import { clientIp } from "@/lib/client-ip";
import { PASSWORD_RESET_RATE_LIMIT } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

const SENT_PATH = `${FORGOT_PASSWORD_PATH}?sent=1`;
const INVALID_EMAIL_PATH = `${FORGOT_PASSWORD_PATH}?error=invalid_email`;

async function isWithinBudget(key: string): Promise<boolean> {
  return (await checkDurableRateLimit(key, PASSWORD_RESET_RATE_LIMIT)).allowed;
}

async function sendResetQuietly(email: string, origin: string): Promise<void> {
  try {
    await requestPasswordReset({ email, origin });
  } catch (error) {
    // Runs after the response — nothing to tell the caller, and by design
    // nothing we WOULD tell them. Name/message only: never the email.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    console.error("[forgot-password] reset request failed:", detail);
  }
}

export async function requestReset(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!isValidEmail(email)) {
    redirect(INVALID_EMAIL_PATH);
  }

  const headerList = await headers();

  // The email budget is only charged once the IP budget has passed: an
  // over-budget caller sends nothing either way, so charging a second key
  // for it buys nothing. The redirect below is identical on every path, so
  // the short-circuit is not observable. Both budgets count on the shared
  // store since T62 (lib/rate-limit-durable.ts); the durable per-account
  // brake is lib/auth/recovery-cooldown.ts.
  const isIpWithinBudget = await isWithinBudget(`password-reset:ip:${clientIp(headerList)}`);
  const isEmailWithinBudget = isIpWithinBudget && (await isWithinBudget(`password-reset:email:${email}`));

  if (isIpWithinBudget && isEmailWithinBudget) {
    const origin = resolveAppOrigin(headerList);
    after(() => sendResetQuietly(email, origin));
  }

  redirect(SENT_PATH);
}
