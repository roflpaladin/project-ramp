// T57 (Sprint 11, Ticket 57 — "Transactional email deliverability").
// Extracted from lib/email/send-access-code.ts so the branded copy is a pure,
// independently-testable function with no provider (Resend/SMTP/etc.)
// dependency. Behaviour is unchanged from the pre-T57 nodemailer version.

// Security review (T43): portalUrl can be derived from forwarded request
// headers, which are not guaranteed proxy-sanitized on every deployment, so
// it is escaped (lib/email/html-escape.ts) before interpolation into the
// HTML body.
import { escapeHtml } from "../html-escape";

export interface AccessCodeEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface AccessCodeEmailInput {
  readonly code: string;
  /**
   * T43 (Sprint 8, Ticket 43). When present, adds an "Open your deal room"
   * link to both bodies -- the seller-invite flow (unlike the existing
   * buyer-gate resend, which has no portal URL to hand yet at send time)
   * always has one, since the workspace being invited into is already known.
   */
  readonly portalUrl?: string;
}

// "Brava" is the product's user-facing name (getbrava.tech) -- this is a
// user-facing surface, so it says Brava, not the internal "Ramp" codename
// this repo otherwise uses throughout its code/comments.
export function buildAccessCodeEmail({ code, portalUrl }: AccessCodeEmailInput): AccessCodeEmailContent {
  const portalLinkText = portalUrl ? `\n\nOpen your deal room: ${portalUrl}` : "";
  const portalLinkHtml = portalUrl ? `<p><a href="${escapeHtml(portalUrl)}">Open your deal room</a></p>` : "";

  return {
    subject: "Your Brava deal room access code",
    text: `Your Brava access code is ${code}. It expires in 15 minutes.${portalLinkText}`,
    html: `<p>Your Brava access code is <strong>${code}</strong>. It expires in 15 minutes.</p>${portalLinkHtml}`,
  };
}
