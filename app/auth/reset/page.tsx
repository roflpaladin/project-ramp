import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResetStatus } from "@/components/auth/reset-status";
import "@/components/auth/password-reset.css";
import { hasRecoverySession } from "@/lib/auth/recovery-session";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/validation";
import { setNewPassword } from "./actions";

// Sprint 12, Ticket 65 — "Password Reset Flow". Where a seller lands after
// app/auth/confirm/route.ts verifies their reset link. /auth/* is outside
// middleware.ts's matcher, so this page guards itself: without a verified
// recovery session it sends the visitor to request a new link.
export const metadata: Metadata = {
  title: "Set a new password — Brava",
  referrer: "no-referrer",
};

const LINK_EXPIRED_PATH = "/forgot-password?error=link_expired";
const LENGTH_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

// Every code ./actions.ts can produce. An unrecognised code gets the
// default — the raw query-string value is never rendered.
const ERROR_COPY: Record<string, string> = {
  password_required: "Enter a new password in both fields.",
  password_too_short: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  password_mismatch: "The two passwords do not match. Enter the same password in both fields.",
  same_password: "That is your current password. Choose a different one.",
  update_failed: "Your password was not changed. Try again in a moment.",
};
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again.";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await hasRecoverySession())) {
    redirect(LINK_EXPIRED_PATH);
  }

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_COPY[error] ?? DEFAULT_ERROR_MESSAGE) : null;

  return (
    <main data-surface="password-reset">
      <h1>Set a new password</h1>
      <p className="pr-lede">After you save, you are signed in here and signed out everywhere else.</p>
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
