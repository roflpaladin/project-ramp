// Shared engagement-state copy (Sprint 6, Ticket 31, T31-4; Sprint 7, Ticket
// 36, T36-5; plans/sprint-6-7-replan.md §6/§7). Single source of truth for
// how an EngagementSignal reads as a sentence, reused by:
//   - forecast-nudge.tsx (Ticket 31) — shown beside the seller-private
//     CRM strip's cached data, only visible when a workspace has synced.
//   - stall-alert.tsx (Ticket 36, T36-5) — shown as a standalone
//     always-visible banner, independent of CRM sync.
//
// Text only — no colour/tone decision lives here. Each caller owns its own
// Signal budget for its own scope (see stall-alert.tsx's header comment for
// the page's one-Signal audit).

import type { EngagementSignal } from "@/lib/plans/engagement";
import { isQuietDeal } from "@/lib/plans/quiet-deal";

function describeRecency(daysSinceLastActivity: number | null): string {
  if (daysSinceLastActivity === null) return "no recorded activity yet";
  if (daysSinceLastActivity === 0) return "active today";
  if (daysSinceLastActivity === 1) return "active 1 day ago";
  return `active ${daysSinceLastActivity} days ago`;
}

/** Derived entirely from computeEngagementSignal's real output — never a hardcoded string. */
export function describeEngagementState(signal: EngagementSignal): string {
  switch (signal.state) {
    case "stalled": {
      const stepWord = signal.openBuyerStepCount === 1 ? "step" : "steps";
      return `Buyer's gone quiet — ${signal.openBuyerStepCount} open buyer ${stepWord} waiting on them.`;
    }
    case "waiting":
      return "Waiting on you — no open buyer steps right now.";
    case "active":
      return `Buyer's engaged — ${describeRecency(signal.daysSinceLastActivity)}.`;
  }
}

/**
 * Sprint 12, Ticket 60 — the quiet-deal line, folded into the stall alert
 * rather than given a banner of its own (orchestrator call, 2026-09-21): a
 * second banner about the same silence would be the page shouting twice.
 *
 * Null whenever the deal isn't quiet, which is the common case — the caller
 * renders nothing rather than a manufactured "all good" line.
 *
 * "Your buyer" is deliberate and load-bearing. lib/plans/engagement.ts
 * measures BUYER activity only (workspace_analytics), so this sentence must
 * never read as "nothing has happened on this deal" — plenty may have, just
 * not in the buyer's room.
 */
export function describeQuietDeal(signal: EngagementSignal): string | null {
  if (!isQuietDeal(signal)) return null;

  return `Your buyer hasn't opened this in ${signal.daysSinceLastActivity} days. If the deal is finished, close it to free a slot.`;
}

/** The plain link beside the line above — the plan page is where Close deal lives. */
export const QUIET_DEAL_LINK_LABEL = "Close this deal";
