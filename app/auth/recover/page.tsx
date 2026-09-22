import type { Metadata } from "next";
import { redirect } from "next/navigation";

import "@/components/auth/password-reset.css";
import { LINK_EXPIRED_PATH, isPlausibleTokenHash } from "@/lib/auth/reset-routes";
import { continueRecovery } from "./actions";

// Sprint 12, Ticket 65 — "Password Reset Flow" (security review MEDIUM-2/3).
// The one-button step between the emailed link and the reset form. Rendering
// this page touches nothing: the recovery token is only spent when a person
// presses the button (./actions.ts), so a mail scanner that pre-opens the
// link leaves it intact. The token rides in a hidden field; `no-referrer`
// keeps it out of any Referer header.
export const metadata: Metadata = {
  title: "Set a new password — Brava",
  referrer: "no-referrer",
};

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { token_hash: tokenHash } = await searchParams;
  if (!isPlausibleTokenHash(tokenHash)) {
    redirect(LINK_EXPIRED_PATH);
  }

  return (
    <main data-surface="password-reset">
      <h1>Set a new password</h1>
      <p className="pr-lede">Your reset link is ready. It works once.</p>
      <form action={continueRecovery}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <button type="submit" className="pr-submit">
          Continue to set a new password
        </button>
      </form>
    </main>
  );
}
