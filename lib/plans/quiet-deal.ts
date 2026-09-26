// Sprint 12, Ticket 60 — "has this buyer gone quiet for long enough that the
// seller should think about closing the deal?"
//
// PURE. No I/O, no Supabase import, no clock of its own — it reads an
// EngagementSignal that lib/plans/engagement.ts has already computed against
// an injected `now`. Same discipline as engagement.ts itself, and for the
// same reason: the boundary is a real decision and has to be testable
// without waiting fourteen days.
//
// This is BUYER activity only. computeEngagementSignal counts nothing but
// workspace_analytics events (portal views, link clicks, step completions),
// so "quiet" here means the buyer has not opened the room — never that
// nothing has happened on the deal. The copy that renders this
// (app/admin/workspaces/[id]/engagement-copy.ts) has to say "your buyer" for
// exactly that reason.
//
// A buyer who has NEVER opened the room is deliberately not quiet: there is
// no "in N days" to state, and the ordinary stall copy already covers them.

import type { EngagementSignal } from "./engagement";

/**
 * Founder ruling (2026-09-21): two weeks of buyer silence is the point at
 * which "is this deal actually finished?" is worth asking out loud. Longer
 * than DEFAULT_STALL_THRESHOLD_DAYS (5) on purpose — a stalled deal wants a
 * nudge, a quiet one wants a decision.
 */
export const QUIET_DEAL_DAYS = 14;

export function isQuietDeal(signal: EngagementSignal, quietAfterDays: number = QUIET_DEAL_DAYS): boolean {
  // Recent activity always wins, exactly as it does in engagement.ts.
  if (signal.state === "active") return false;

  const { daysSinceLastActivity } = signal;
  if (daysSinceLastActivity === null) return false;

  return daysSinceLastActivity >= quietAfterDays;
}
