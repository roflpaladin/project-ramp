// Shared domain-string normalization/validation for target_domain, used by
// both workspace creation (Seller Builder UI) and, later, the favicon
// scraper (Instant Branding Engine) and the Security Gate whitelist.

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export function isValidDomain(input: string): boolean {
  return DOMAIN_PATTERN.test(input);
}
