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
import { isValidEmail } from "@/lib/auth/validation";
import { checkRateLimit, PASSWORD_RESET_RATE_LIMIT } from "@/lib/rate-limit";

const SENT_PATH = "/forgot-password?sent=1";
const INVALID_EMAIL_PATH = "/forgot-password?error=invalid_email";

function callerIp(headerList: Headers): string {
  const forwardedFor = headerList.get("x-forwarded-for");
  const firstEntry = forwardedFor?.split(",")[0]?.trim();
  return firstEntry || "unknown";
}

function isWithinBudget(key: string): boolean {
  const { limit, windowMs } = PASSWORD_RESET_RATE_LIMIT;
  return checkRateLimit(key, limit, windowMs).allowed;
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

  // Both budgets are always charged (no short-circuit), so a caller who is
  // over the IP budget still spends the target email's budget and vice versa.
  const isIpWithinBudget = isWithinBudget(`password-reset:ip:${callerIp(headerList)}`);
  const isEmailWithinBudget = isWithinBudget(`password-reset:email:${email}`);

  if (isIpWithinBudget && isEmailWithinBudget) {
    const origin = resolveAppOrigin(headerList);
    after(() => sendResetQuietly(email, origin));
  }

  redirect(SENT_PATH);
}
