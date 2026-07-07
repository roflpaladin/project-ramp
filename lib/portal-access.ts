import { normalizeDomain } from "@/lib/domain";

// A buyer email is approved if it's explicitly whitelisted (multi-stakeholder
// deals) or if its domain matches the workspace's target_domain.
export function isEmailApproved(email: string, approvedEmails: string[], targetDomain: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (approvedEmails.some((approved) => approved.trim().toLowerCase() === normalizedEmail)) {
    return true;
  }

  const emailDomain = normalizedEmail.split("@")[1];
  return Boolean(emailDomain) && emailDomain === normalizeDomain(targetDomain);
}
