import type { Metadata } from "next";

import { ResetStatus } from "@/components/auth/reset-status";
import "@/components/auth/password-reset.css";
import { requestReset } from "./actions";

// Sprint 12, Ticket 65 — "Password Reset Flow". Where a locked-out seller
// asks for a reset link. Bare Server Component + native <form action>, the
// same pattern as app/register and app/admin/login (no client JS). The
// confirmation copy never says whether the email has an account — see
// ./actions.ts for the rest of the no-enumeration reasoning.
export const metadata: Metadata = { title: "Reset your password — Brava" };

const SENT_MESSAGE = "If an account exists for that email, a reset link is on its way.";

// Codes come from ./actions.ts (invalid_email) and app/auth/confirm +
// app/auth/reset (link_expired). An unrecognised code gets the default — the
// raw query-string value is never rendered.
const ERROR_COPY: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  link_expired: "That reset link has expired or was already used. Request a new one.",
};
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again.";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const isSent = sent === "1";
  const errorMessage = error ? (ERROR_COPY[error] ?? DEFAULT_ERROR_MESSAGE) : null;

  return (
    <main data-surface="password-reset">
      <h1>Reset your password</h1>
      {isSent ? (
        <>
          <ResetStatus tone="done">{SENT_MESSAGE}</ResetStatus>
          <p className="pr-lede">The link works once and expires soon. Check your spam folder if it does not arrive.</p>
          <p className="pr-footer">
            <a href="/forgot-password">Use a different email</a>
          </p>
        </>
      ) : (
        <>
          <p className="pr-lede">Enter your account email. We send a link to set a new password.</p>
          {errorMessage ? <ResetStatus tone="risk">{errorMessage}</ResetStatus> : null}
          <form action={requestReset}>
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <button type="submit" className="pr-submit">
              Send reset link
            </button>
          </form>
        </>
      )}
      <p className="pr-footer">
        <a href="/admin/login">Back to sign in</a>
      </p>
    </main>
  );
}
