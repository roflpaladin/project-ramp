import nodemailer from "nodemailer";

// Security review (T43): portalUrl can be derived from forwarded request
// headers, which are not guaranteed proxy-sanitized on every deployment. A
// value containing `"` or `<` must not be able to break out of the href
// attribute or inject markup into an email we send to a third party, so it
// is escaped before interpolation into the HTML body.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Sends the buyer's 4-digit portal access code via the Supabase project's
// SMTP relay (Auth -> SMTP settings in the dashboard), not a Supabase-specific
// email API -- Supabase has no endpoint for sending arbitrary transactional
// email, so we talk to the same SMTP server directly with nodemailer.
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
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !password || !from) {
    console.error("[send-access-code] SMTP env vars are not fully configured; cannot send.");
    return { ok: false };
  }

  try {
    // T44 finding: without explicit timeouts, nodemailer's defaults (minutes)
    // let an unreachable relay hang the calling server action — the invite
    // panel freezes in "Sending invite" instead of reaching its recoverable
    // send-failed state. Fail fast; the caller already handles { ok: false }.
    const transport = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    // "Brava" is the product's user-facing name (getbrava.io) -- this is a
    // user-facing surface, so it says Brava, not the internal "Ramp"
    // codename this repo otherwise uses throughout its code/comments.
    const portalLinkText = portalUrl ? `\n\nOpen your deal room: ${portalUrl}` : "";
    const portalLinkHtml = portalUrl ? `<p><a href="${escapeHtml(portalUrl)}">Open your deal room</a></p>` : "";

    await transport.sendMail({
      from,
      to,
      subject: "Your Brava deal room access code",
      text: `Your Brava access code is ${code}. It expires in 15 minutes.${portalLinkText}`,
      html: `<p>Your Brava access code is <strong>${code}</strong>. It expires in 15 minutes.</p>${portalLinkHtml}`,
    });

    return { ok: true };
  } catch (error) {
    console.error("[send-access-code] failed to send email:", error);
    return { ok: false };
  }
}
