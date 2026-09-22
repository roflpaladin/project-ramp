// Sprint 12, Ticket 65 — "Password Reset Flow". The fixed internal paths the
// reset flow moves between, in one place: app/auth/confirm, app/auth/recover
// and app/auth/reset all redirect among them, and the recovery marker cookie
// must be set and cleared on exactly the same path.

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const LINK_EXPIRED_PATH = `${FORGOT_PASSWORD_PATH}?error=link_expired`;
export const RECOVER_PATH = "/auth/recover";
export const RESET_PATH = "/auth/reset";
export const RESET_SUCCESS_PATH = "/admin";

// GoTrue's hashed recovery token is 56 hex characters today. Deliberately a
// little looser than that (URL-safe characters, bounded length) so a GoTrue
// format change does not break every reset link, while still refusing
// anything that could not be a token before it is forwarded or verified.
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isPlausibleTokenHash(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}
