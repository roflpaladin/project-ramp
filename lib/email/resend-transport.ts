import { Resend } from "resend";

// The Resend plumbing every transactional email shares (T57, Sprint 11,
// Ticket 57 — "Transactional email deliverability"). Extracted from
// lib/email/send-access-code.ts in Sprint 12, Ticket 65, when the
// password-reset email became its second caller. Fail-soft by design:
// returns `{ ok: false }` and logs, never throws, so a provider outage can
// not crash the request that triggered the email.

export interface EmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface SendEmailInput {
  readonly to: string;
  readonly content: EmailContent;
  /** Prefix for log lines, e.g. "send-access-code". */
  readonly logTag: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

export async function sendViaResend({ to, content, logTag }: SendEmailInput): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    console.error(`[${logTag}] Resend env vars are not fully configured; cannot send.`);
    return { ok: false };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, ...content });

    if (error) {
      // Resend's SDK resolves API-level failures (invalid key, unverified
      // domain, rate limit, ...) into this `error` field rather than
      // throwing -- only network-level failures reach the catch below. Log
      // the error's own message/name, never the API key.
      console.error(`[${logTag}] Resend rejected the send:`, error.name, error.message);
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    // Name and message only -- never the raw error object, which could
    // carry the request (and with it a one-time code or reset link).
    console.error(`[${logTag}] failed to send email:`, describeError(error));
    return { ok: false };
  }
}
