import { Resend } from "resend";

import { buildAccessCodeEmail } from "./templates/access-code";

// Sends the buyer's 4-digit portal access code via Resend (T57, Sprint 11,
// Ticket 57 -- "Transactional email deliverability"). Replaces the Google
// Workspace SMTP relay this repo sent through via nodemailer through
// Sprint 10: Workspace SMTP gives no bounce/delivery visibility, which is a
// hard AC ahead of the Nov 1 sellable date, and Resend's dashboard does. The
// public contract (params, `{ ok: boolean }` return) is unchanged so every
// caller -- app/portal/[id]/gate-actions.ts, app/api/auth/send-token/route.ts,
// app/admin/workspaces/[id]/invite-actions.ts (via
// lib/portal-access-token.ts) -- needed zero changes.
export async function sendAccessCodeEmail({
  to,
  code,
  portalUrl,
}: {
  to: string;
  code: string;
  /**
   * T43 (Sprint 8, Ticket 43). When present, adds an "Open your deal room"
   * link to both bodies -- the seller-invite flow (unlike the existing
   * buyer-gate resend, which has no portal URL to hand yet at send time)
   * always has one, since the workspace being invited into is already known.
   */
  portalUrl?: string;
}): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    console.error("[send-access-code] Resend env vars are not fully configured; cannot send.");
    return { ok: false };
  }

  try {
    const resend = new Resend(apiKey);
    const { subject, text, html } = buildAccessCodeEmail({ code, portalUrl });

    const { error } = await resend.emails.send({ from, to, subject, text, html });

    if (error) {
      // Resend's SDK resolves API-level failures (invalid key, unverified
      // domain, rate limit, ...) into this `error` field rather than
      // throwing -- only network-level failures reach the catch below. Log
      // the error's own message/name, never the API key.
      console.error("[send-access-code] Resend rejected the send:", error.name, error.message);
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("[send-access-code] failed to send email:", error);
    return { ok: false };
  }
}
