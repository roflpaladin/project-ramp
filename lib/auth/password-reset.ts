import { reserveEmailSend } from "@/lib/email/send-guard";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWithinRecoveryCooldown } from "./recovery-cooldown";

// Sprint 12, Ticket 65 — "Password Reset Flow". Creates a one-time recovery
// token for a seller and emails them a link to it.
//
// Founder ruling 2026-09-21 ("go A"): the link is generated here with the
// Admin API and sent through our own Resend template, instead of calling
// supabase.auth.resetPasswordForEmail and relying on the dashboard's "Reset
// password" template. Consequences worth knowing:
//   - No Supabase email-template edits and no redirect-allowlist entries on
//     either project: verifyOtp({ token_hash }) runs server-side in
//     app/auth/confirm/route.ts and involves no Supabase-side redirect.
//   - GoTrue's own per-email send throttle does not apply to generateLink.
//     ./recovery-cooldown.ts replaces it with a durable per-account cooldown
//     (security review HIGH-1); app/forgot-password/actions.ts's in-memory
//     limits sit in front of that.

const CONFIRM_PATH = "/auth/confirm";
const RECOVERY_TYPE = "recovery";

export interface RequestPasswordResetInput {
  /** Already trimmed, lower-cased and format-checked by the caller. */
  readonly email: string;
  /** Trusted base address — see lib/auth/app-origin.ts. */
  readonly origin: string;
}

export interface RequestPasswordResetResult {
  /** Internal only. Callers must never reveal this to the requester. */
  readonly sent: boolean;
}

function buildResetUrl(origin: string, tokenHash: string): string {
  const url = new URL(CONFIRM_PATH, origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", RECOVERY_TYPE);
  return url.toString();
}

export async function requestPasswordReset({
  email,
  origin,
}: RequestPasswordResetInput): Promise<RequestPasswordResetResult> {
  // Checked BEFORE generating: a second token would invalidate the link
  // already in the seller's inbox.
  if (await isWithinRecoveryCooldown(email)) {
    return { sent: false };
  }

  // T62 email abuse guard. No tenant is known yet (the requester is
  // anonymous until the link is used), so only the global budget applies.
  // Checked BEFORE generating, like the cooldown: a refused send must not
  // mint a token that silently invalidates the link already in the inbox.
  const reservation = await reserveEmailSend({ tenantId: null });
  if (!reservation.allowed) {
    return { sent: false };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: RECOVERY_TYPE, email });

  if (error || !data.properties?.hashed_token) {
    // The expected case here is "no account with that email" — not an
    // incident, and deliberately indistinguishable to the requester. Log the
    // error code only: never the email (would turn the log into an
    // enumeration record) and never a token.
    if (error && error.code !== "user_not_found") {
      console.error("[password-reset] generating a recovery link failed:", error.code ?? error.name);
    }
    return { sent: false };
  }

  const { ok } = await sendPasswordResetEmail({
    to: email,
    resetUrl: buildResetUrl(origin, data.properties.hashed_token),
  });
  return { sent: ok };
}
