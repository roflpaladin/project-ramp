// T36-2 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Masks a
// buyer's email before it can reach /api/demo/pulse's activity feed — a
// session-less, unauthenticated endpoint (see that route's own scope-guard
// comment) that used to emit the raw address of every buyer who has ever
// opened a demo-tenant workspace. One shared function so every emit site in
// the route masks identically, rather than each call site inventing its own
// truncation.

const MASKED_LOCAL_SUFFIX = "***";
const MASKED_DOMAIN_LABEL = "***";
const FALLBACK_MASKED_EMAIL = "***@***";

/**
 * Keeps just enough of an email to read as "a real person interacted"
 * without naming them: the local part's first character, plus the domain's
 * TLD if it has one.
 *
 *   "sarah.chen@acme-logistics.example.com" -> "s***@***.com"
 *   "a@b.co"                                -> "a***@***.co"
 *   "buyer@localhost"                       -> "b***@***"       (no dot)
 *
 * Malformed input (no "@", or an empty local/domain half) masks completely
 * rather than guessing at a shape that isn't there.
 */
export function maskBuyerEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return FALLBACK_MASKED_EMAIL;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain.length === 0) return FALLBACK_MASKED_EMAIL;

  const domainParts = domain.split(".");
  const tld = domainParts.length > 1 ? domainParts[domainParts.length - 1] : "";
  const maskedDomain = tld ? `${MASKED_DOMAIN_LABEL}.${tld}` : MASKED_DOMAIN_LABEL;

  return `${local[0]}${MASKED_LOCAL_SUFFIX}@${maskedDomain}`;
}
