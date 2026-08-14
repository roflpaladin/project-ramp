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
