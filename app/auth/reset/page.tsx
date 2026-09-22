import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResetStatus } from "@/components/auth/reset-status";
import "@/components/auth/password-reset.css";
import { getRecoveryUser } from "@/lib/auth/recovery-session";
import { LINK_EXPIRED_PATH } from "@/lib/auth/reset-routes";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/validation";
import { setNewPassword, type ResetErrorCode } from "./actions";

// Sprint 12, Ticket 65 — "Password Reset Flow". Where a seller lands after
// app/auth/recover verifies their reset link. /auth/* is outside
// middleware.ts's matcher, so this page guards itself: without a verified
// recovery session it sends the visitor to request a new link.
//
// The account's email is shown above the form (security review MEDIUM-1): a
// real-looking reset link for SOMEONE ELSE'S account is a phishing route, and
// naming the account is what lets the visitor notice before typing.
export const metadata: Metadata = {
  title: "Set a new password — Brava",
  referrer: "no-referrer",
};

const LENGTH_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

// Every code ./actions.ts can produce. An unrecognised code gets the
// default — the raw query-string value is never rendered.
const ERROR_COPY: Record<ResetErrorCode, string> = {
  password_required: "Enter a new password in both fields.",
  password_too_short: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  password_mismatch: "The two passwords do not match. Enter the same password in both fields.",
  same_password: "That is your current password. Choose a different one.",
  update_failed: "Your password was not changed. Try again in a moment.",
};
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again.";

function copyFor(code: string): string | undefined {
  return Object.hasOwn(ERROR_COPY, code) ? ERROR_COPY[code as ResetErrorCode] : undefined;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const recoveryUser = await getRecoveryUser();
  if (!recoveryUser) {
    redirect(LINK_EXPIRED_PATH);
  }

  const { error } = await searchParams;
  const errorMessage = error ? (copyFor(error) ?? DEFAULT_ERROR_MESSAGE) : null;

  return (
    <main data-surface="password-reset">
      <h1>Set a new password</h1>
      <p className="pr-lede">
        For <span className="pr-account">{recoveryUser.email}</span>. After you save, you are signed in here and signed
        out everywhere else.
      </p>
      {errorMessage ? <ResetStatus tone="risk">{errorMessage}</ResetStatus> : null}
      <form action={setNewPassword}>
        {/* The hint sits outside the <label> so the field's accessible name
            stays exactly "New password"; aria-describedby ties them. */}
        <div className="pr-field">
          <label htmlFor="pr-password">New password</label>
          <input
            id="pr-password"
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby="pr-length-hint"
            required
          />
          <span id="pr-length-hint" className="pr-hint">
            {LENGTH_HINT}
          </span>
        </div>
        <label>
          Confirm new password
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <button type="submit" className="pr-submit">
          Set new password
        </button>
      </form>
    </main>
  );
}
