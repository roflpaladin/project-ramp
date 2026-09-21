// Sprint 12, Ticket 60 (active-deal limit). The one call a caller makes to
// ask "what is THIS tenant allowed to do right now?" — the service-role read
// (subscription-repository.ts) joined to the pure rule (entitlement.ts).
//
// It lives here rather than in either of those two files on purpose:
// entitlement.ts must stay pure (no DB, no clock) so the grace boundary
// remains testable to the millisecond, and subscription-repository.ts must
// stay a boring data boundary with no billing rules in it. This module is
// the only place the two meet.
//
// NOTHING IS CAUGHT HERE. A failed billing read propagates, because the
// caller — and only the caller — knows what failing closed looks like in its
// own surface (the go-live gate turns it into BILLING_CHECK_FAILED plus a
// server log; a page can render a "we could not check your plan" state).
// Folding the failure into "free tier" here would silently paywall a paying
// customer every time the database hiccups.

import { resolveEntitlement, type Entitlement } from "./entitlement";
import { findByTenantId } from "./subscription-repository";

/**
 * `now` is injectable for the same reason resolveEntitlement takes it: the
 * 7-day grace boundary is a real decision and has to be testable without
 * waiting seven days. Production callers omit it.
 */
export async function getTenantEntitlement(tenantId: string, now: Date = new Date()): Promise<Entitlement> {
  const subscription = await findByTenantId(tenantId);
  return resolveEntitlement(subscription, now);
}
