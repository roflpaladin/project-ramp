// Sprint 12, Ticket 65 — "Password Reset Flow". Pure, provider-independent
// template for the password-reset email — same shape and family as
// ./access-code.ts (T57). "Brava" is the product's user-facing name; this is
// a user-facing surface, so it says Brava, not the internal "Ramp" codename.
import type { EmailContent } from "../resend-transport";
import { escapeHtml } from "../html-escape";

export interface ResetPasswordEmailInput {
  /** Absolute link to /auth/confirm carrying the one-time recovery token. */
  readonly resetUrl: string;
}

// Email clients do not resolve CSS custom properties, so the design-system
// tokens are inlined by value here — light theme, from app/globals.css's
// :root block. Signal is the email's one action, per the one-Signal rule.
const TOKEN_INK = "#17181C";
const TOKEN_SLATE = "#686B73";
const TOKEN_SIGNAL = "#A85B12";
const TOKEN_SIGNAL_FG = "#FFFFFF";
const FONT_STACK = "'Geist','Inter',system-ui,-apple-system,sans-serif";

const ACTION_LABEL = "Set a new password";
const INTRO = "Someone asked to reset the password for your Brava account.";
const EXPIRY_NOTE = "The link works once and expires soon.";
const IGNORE_NOTE = "If you did not ask for this, ignore this email. Your password stays the same.";

export function buildResetPasswordEmail({ resetUrl }: ResetPasswordEmailInput): EmailContent {
  const safeUrl = escapeHtml(resetUrl);
  const bodyStyle = `font-family:${FONT_STACK};font-size:16px;line-height:24px;color:${TOKEN_INK};`;
  const buttonStyle =
    `display:inline-block;padding:10px 16px;border-radius:10px;font-weight:500;` +
    `text-decoration:none;background:${TOKEN_SIGNAL};color:${TOKEN_SIGNAL_FG};`;
  const metaStyle = `font-size:13px;line-height:18px;color:${TOKEN_SLATE};`;

  return {
    subject: "Reset your Brava password",
    text: `${INTRO}\n\n${ACTION_LABEL}: ${resetUrl}\n\n${EXPIRY_NOTE}\n\n${IGNORE_NOTE}`,
    html:
      `<div style="${bodyStyle}">` +
      `<p>${INTRO}</p>` +
      `<p><a href="${safeUrl}" style="${buttonStyle}">${ACTION_LABEL}</a></p>` +
      `<p style="${metaStyle}">${EXPIRY_NOTE}</p>` +
      `<p style="${metaStyle}">${IGNORE_NOTE}</p>` +
      `</div>`,
  };
}
