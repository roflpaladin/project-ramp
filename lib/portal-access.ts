import { normalizeDomain } from "@/lib/domain";

// A buyer email is approved if it's explicitly whitelisted (multi-stakeholder
// deals) or if its domain matches the workspace's target_domain.

export interface ApprovalOptions {
  /**
   * Sprint 12, Ticket 60 (founder ruling, 2026-09-21). Domain auto-approval
   * is switched OFF for the SAMPLE workspace: it is the one deal the
   * active-deal limit does not count, so only the seller's own address —
   * explicitly whitelisted by the invite action — may reach it. Left on
   * (the default) everywhere else, which is every real deal.
   *
   * This matters because target_domain is seller-writable through PostgREST
   * (0001's workspace policy is `for all`): without this, pointing the
   * sample at a real customer's domain would re-open the door on the portal
   * side, where there is no seller identity to compare an address against.
   */
  readonly allowDomainMatch?: boolean;
}

export function isEmailApproved(
  email: string,
  approvedEmails: string[],
  targetDomain: string,
  options: ApprovalOptions = {},
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (approvedEmails.some((approved) => approved.trim().toLowerCase() === normalizedEmail)) {
    return true;
  }

  if (options.allowDomainMatch === false) return false;

  const emailDomain = normalizedEmail.split("@")[1];
  return Boolean(emailDomain) && emailDomain === normalizeDomain(targetDomain);
}
