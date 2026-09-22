import { sendViaResend } from "./resend-transport";
import { buildAccessCodeEmail } from "./templates/access-code";

// Sends the buyer's portal access code via Resend (T57, Sprint 11,
// Ticket 57 -- "Transactional email deliverability"). Replaces the Google
// Workspace SMTP relay this repo sent through via nodemailer through
// Sprint 10: Workspace SMTP gives no bounce/delivery visibility, which is a
// hard AC ahead of the Nov 1 sellable date, and Resend's dashboard does. The
// public contract (params, `{ ok: boolean }` return) is unchanged so every
// caller -- app/portal/[id]/gate-actions.ts, app/api/auth/send-token/route.ts,
// app/admin/workspaces/[id]/invite-actions.ts (via
// lib/portal-access-token.ts) -- needed zero changes. The Resend plumbing
// itself lives in ./resend-transport.ts (shared with the password-reset
// email since Sprint 12, Ticket 65).
export async function sendAccessCodeEmail({
  to,
  code,
  portalUrl,
}: {
  to: string;
  /** ACCESS_CODE_LENGTH digits (six since Sprint 12, Ticket 62 — four was
   *  10,000 possibilities); see lib/portal-access-code.ts. */
  code: string;
  /**
   * T43 (Sprint 8, Ticket 43). When present, adds an "Open your deal room"
   * link to both bodies -- the seller-invite flow (unlike the existing
   * buyer-gate resend, which has no portal URL to hand yet at send time)
   * always has one, since the workspace being invited into is already known.
   */
  portalUrl?: string;
}): Promise<{ ok: boolean }> {
  return sendViaResend({
    to,
    content: buildAccessCodeEmail({ code, portalUrl }),
    logTag: "send-access-code",
  });
}
