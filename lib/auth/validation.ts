// Sprint 12, Ticket 65 — "Password Reset Flow". The email and password rules
// registration has enforced since Sprint 8, Ticket 39, moved here from their
// two hand-synced copies (app/register/actions.ts and
// lib/auth/provision-seller.ts) so the reset flow applies the SAME rules
// rather than a third copy that could drift. Rules are unchanged.

export const MIN_PASSWORD_LENGTH = 8;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export type NewPasswordError = "password_required" | "password_too_short" | "password_mismatch";

/** Returns the first rule the pair breaks, or `null` when it is acceptable. */
export function validateNewPassword(password: string, confirmPassword: string): NewPasswordError | null {
  if (!password || !confirmPassword) return "password_required";
  if (password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password !== confirmPassword) return "password_mismatch";
  return null;
}
