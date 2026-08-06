// Buyer engagement heuristic (Ticket 31, T31-1).
//
// PURE FUNCTION. Zero I/O, no Supabase import, no Next.js import, no
// Date.now()/new Date() call for "now" anywhere in this file. `now` is always
// an injected argument. This is deliberate, not stylistic: Ticket 36 reuses
// this exact module for the seller-dashboard pulse without forking it ("AC:
// this ticket adds zero new engagement math" — sprint-6-7-replan.md T36-4),
// and every stall-boundary test QA writes against this file is a clock test —
// it can only assert deterministically if the clock is a parameter.
//
// State definitions (relative to `now` and `stallThresholdDays`):
//
//   "active"  — the buyer has an engagement event within the threshold
//               window: `daysSinceLastActivity <= stallThresholdDays`. The
//               buyer is visibly present regardless of what the plan still
//               needs from them.
//
//   "stalled" — the buyer does NOT have recent activity (either the last
//               event is older than the threshold, or there has never been
//               one at all) AND at least one buyer-owned step is still
//               `open`. This is the state that should drive a nudge: the
//               plan is blocked on the buyer and the buyer has gone quiet
//               (or never showed up). A buyer who has never engaged is
//               treated as stalled here, not as a softer "waiting" — if the
//               plan requires their action, silence from day one is exactly
//               the condition the nudge exists to surface.
//
//   "waiting" — everything else: no recent buyer activity, but nothing
//               buyer-owned is currently open (the ball is in the seller's
//               court, or the plan has no buyer-owned open steps at all —
//               including the no-steps-yet case). Rendered in Slate per the
//               design guideline; silence here is expected, not a problem.
//
// Precedence is active > stalled > waiting: recent activity always wins,
// regardless of step state.

import type { PlanStepRow } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The minimal shape this module needs from a buyer engagement event — not
 * the full workspace_analytics row. Keeping this local (rather than importing
 * a DB row type) is what keeps the function importable without a Supabase
 * dependency anywhere in its module graph.
 */
export interface EngagementEventInput {
  readonly actionType: string;
  /** timestamptz, serialized "2026-07-05T14:00:00+00:00". */
  readonly createdAt: string;
}

export type EngagementState = "active" | "stalled" | "waiting";

export interface EngagementSignal {
  readonly state: EngagementState;
  /** ISO timestamp of the most recent event, or null if there has never been one. */
  readonly lastActivityAt: string | null;
  /** Whole days between lastActivityAt and `now`, or null when lastActivityAt is null. */
  readonly daysSinceLastActivity: number | null;
  /** Count of steps with owner_side='buyer' and status='open' — the input to the stall determination. */
  readonly openBuyerStepCount: number;
}

function parseDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`engagement.ts: invalid date input "${String(value)}"`);
  }
  return date;
}

/**
 * Latest event by createdAt. Events with an unparsable createdAt are skipped
 * rather than thrown on — a single malformed cached row should degrade this
 * computation gracefully, not break the whole plan render.
 */
function findLastActivity(events: readonly EngagementEventInput[]): Date | null {
  let latest: Date | null = null;

  for (const event of events) {
    const parsed = new Date(event.createdAt);
    if (Number.isNaN(parsed.getTime())) continue;
    if (latest === null || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }

  return latest;
}

function countOpenBuyerSteps(steps: readonly PlanStepRow[]): number {
  return steps.filter((step) => step.owner_side === "buyer" && step.status === "open").length;
}

/**
 * Computes a buyer engagement signal for a plan.
 *
 * @param events buyer engagement events (portal_view / link_click / step_complete)
 * @param steps the plan's steps (or a readonly slice) — used only for owner_side/status
 * @param now injected "current time" — a Date or ISO string. Never resolved internally.
 * @param stallThresholdDays the number of days of buyer silence before a plan
 *   with an open buyer-owned step counts as stalled.
 */
export function computeEngagementSignal(
  events: readonly EngagementEventInput[],
  steps: readonly PlanStepRow[],
  now: Date | string,
  stallThresholdDays: number,
): EngagementSignal {
  const nowDate = parseDate(now);
  const lastActivity = findLastActivity(events);
  const openBuyerStepCount = countOpenBuyerSteps(steps);

  const daysSinceLastActivity =
    lastActivity === null
      ? null
      : Math.floor((nowDate.getTime() - lastActivity.getTime()) / MS_PER_DAY);

  const isRecentlyActive =
    daysSinceLastActivity !== null && daysSinceLastActivity <= stallThresholdDays;

  const state: EngagementState = isRecentlyActive
    ? "active"
    : openBuyerStepCount > 0
      ? "stalled"
      : "waiting";

  return {
    state,
    lastActivityAt: lastActivity === null ? null : lastActivity.toISOString(),
    daysSinceLastActivity,
    openBuyerStepCount,
  };
}
