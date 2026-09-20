// Sprint 12, Ticket 59 (slice 2 code review fix — HIGH, reflected content
// spoofing). page.tsx used to render the raw `?error=` query string param
// verbatim inside this trusted page — anyone could craft
// `/settings/billing?error=<arbitrary text>` (e.g. a fake "your card was
// declined, call this number" phishing line) and have it rendered as if it
// came from us. React's escaping stops a script injection, but it does
// nothing to stop a false STATEMENT from being shown inside a trusted
// surface — the fix is a closed set of codes, not better escaping.
//
// Importers: app/settings/billing/actions.ts (redirects with `?error=<code>`
// only — it never puts free text in the URL) and app/settings/billing/page.tsx
// (never renders the raw param; only this module's fixed message strings
// ever reach the DOM).

export type BillingErrorCode = "signed_out" | "no_account" | "rate_limited" | "misconfigured" | "generic";

const BILLING_ERROR_MESSAGES: Readonly<Record<BillingErrorCode, string>> = Object.freeze({
  signed_out: "Sign in again to continue to billing.",
  no_account: "There's no billing account to manage yet.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
  misconfigured: "Billing isn't available right now. Try again shortly.",
  generic: "We couldn't open the billing portal. Try again.",
});

const BILLING_ERROR_CODES = Object.keys(BILLING_ERROR_MESSAGES) as readonly BillingErrorCode[];

function isBillingErrorCode(value: unknown): value is BillingErrorCode {
  return typeof value === "string" && (BILLING_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Boundary validator for the `?error=` query param. `undefined` (the param
 * is absent — the common case) maps to `null`, so the page renders nothing.
 * EVERYTHING else — a known code, an unrecognised string (tampered, stale,
 * a future typo), a duplicated query param (which Next.js hands back as an
 * array), or any other shape — resolves to one of the five FIXED messages
 * above. The raw value itself is never returned, so there is nothing left
 * for an attacker-crafted URL to inject into this page.
 */
export function messageForBillingErrorCode(raw: unknown): string | null {
  if (raw === undefined) return null;
  return isBillingErrorCode(raw) ? BILLING_ERROR_MESSAGES[raw] : BILLING_ERROR_MESSAGES.generic;
}
