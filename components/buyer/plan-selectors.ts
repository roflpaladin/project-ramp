// Pure, presentation-only helpers over the buyer-safe plan shape (Sprint 7,
// Ticket 33; plans/sprint-6-7-replan.md §7). No React, no I/O — mirrors
// app/admin/workspaces/[id]/plan/plan-tree-utils.ts's pattern (Ticket 29) so
// the same "unit-testable without mounting a component" property holds here.
//
// Everything below operates ONLY on the types re-exported from
// lib/portal-payload.ts (BuyerPlan / BuyerStage / BuyerStep) and the
// StageStatus / StepStatus string-literal unions from lib/plans/types.ts.
// Those unions carry no shape to leak — importing them is safe the same way
// importing `boolean` would be. Nothing here imports a raw row type; nothing
// here has any business doing so.

import type { StageStatus, StepStatus } from "@/lib/plans/types";
import type { BuyerPlan, BuyerStage, BuyerStep } from "@/lib/portal-payload";

export type StatusTone = "done" | "risk" | "wait";

export interface StepLocation {
  readonly stage: BuyerStage;
  readonly step: BuyerStep;
}

/**
 * The next actionable step for the whole plan, in stage/step display order.
 * Mirrors plan-tree-utils.ts's `findLiveStepId` (Ticket 29) — first step
 * whose status is 'open', skipping 'done' (already handled) and 'blocked'
 * (not actionable, it's what's IN THE WAY of the next move, not the move
 * itself). Returns the owning stage alongside it because the "Your move"
 * card needs that context, not just an id.
 */
export function findNextOpenStep(plan: BuyerPlan): StepLocation | null {
  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      if (step.status === "open") return { stage, step };
    }
  }
  return null;
}

/**
 * The stage the seller has manually marked 'current' (plan_stages.status —
 * an authored field, not derived). This is what the ramp gesture marks
 * (T33-3), independently of which single step `findNextOpenStep` names —
 * in well-formed data they usually coincide, but this renderer trusts the
 * seller's own field rather than re-deriving it, exactly as the seller
 * builder's own stage header badge already does (status-badge.tsx).
 */
export function findCurrentStage(plan: BuyerPlan): BuyerStage | null {
  return plan.stages.find((stage) => stage.status === "current") ?? null;
}

/** Every blocked step, in plan order, with its owning stage. */
export function collectBlockedSteps(plan: BuyerPlan): StepLocation[] {
  const result: StepLocation[] = [];
  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      if (step.status === "blocked") result.push({ stage, step });
    }
  }
  return result;
}

/**
 * Buyer-owned, still-open steps past their due date. PRD §5 / T33-4: these
 * stay in the rail for now rather than escalating into their own banner —
 * revisit after the Proximus reaction. Date-only comparison, both sides at
 * UTC midnight, so a step due "today" is never flagged overdue before the
 * day has actually ended.
 */
export function collectOverdueBuyerSteps(plan: BuyerPlan, now: Date): StepLocation[] {
  const today = startOfUtcDay(now).getTime();
  const result: StepLocation[] = [];
  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      if (step.owner_side !== "buyer" || step.status !== "open" || !step.due_date) continue;
      const due = parsePlanDate(step.due_date);
      if (due && due.getTime() < today) result.push({ stage, step });
    }
  }
  return result;
}

export interface RunwayInfo {
  readonly dayIndex: number;
  readonly totalDays: number;
  /** 0–100, today's position between start and target for the marker. */
  readonly percent: number;
  readonly startDate: string;
  readonly targetDate: string;
}

/**
 * Null whenever either boundary date is missing or unparsable — the caller
 * renders the "no dates yet" banner instead of guessing (T33-5: a plan
 * with no dates must never render a broken runway banner).
 */
export function computeRunway(plan: BuyerPlan, now: Date): RunwayInfo | null {
  if (!plan.start_date || !plan.target_date) return null;
  const start = parsePlanDate(plan.start_date);
  const target = parsePlanDate(plan.target_date);
  if (!start || !target) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.round((target.getTime() - start.getTime()) / msPerDay) + 1);
  const elapsed = Math.round((startOfUtcDay(now).getTime() - start.getTime()) / msPerDay) + 1;
  const dayIndex = Math.min(totalDays, Math.max(1, elapsed));
  const percent =
    totalDays <= 1 ? (elapsed >= 1 ? 100 : 0) : Math.min(100, Math.max(0, ((elapsed - 1) / (totalDays - 1)) * 100));

  return { dayIndex, totalDays, percent, startDate: plan.start_date, targetDate: plan.target_date };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Postgres `date` columns serialize as "YYYY-MM-DD" (lib/plans/types.ts).
 * Parsed at UTC midnight so a local timezone offset can never shift the
 * displayed day. Returns null on anything that doesn't round-trip rather
 * than rendering "Invalid Date" — never trust external data at the boundary.
 */
export function parsePlanDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Human-readable form of a plan date for display. Falls back to the raw
 *  string (never throws, never "Invalid Date") if it doesn't parse. */
export function formatPlanDate(value: string): string {
  const date = parsePlanDate(value);
  return date ? DATE_FORMATTER.format(date) : value;
}

export function stepTone(status: StepStatus): StatusTone {
  switch (status) {
    case "done":
      return "done";
    case "blocked":
      return "risk";
    case "open":
      return "wait";
  }
}

export function stepStatusLabel(status: StepStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
    case "open":
      return "Open";
  }
}

/** 'current' and 'upcoming' are both ordinary waiting states — only 'done'
 *  speaks (design system: "waiting renders in Slate, never a loud colour"). */
export function stageTone(status: StageStatus): StatusTone {
  return status === "done" ? "done" : "wait";
}

export function stageStatusLabel(status: StageStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "current":
      return "In progress";
    case "upcoming":
      return "Upcoming";
  }
}

/** Sentence-case, side-aware label for a step's dot-adjacent ownership text
 *  (T33-6: buyer-owned vs seller-owned distinguished by dot + text, never
 *  colour alone). */
export function ownerSideLabel(step: BuyerStep): string {
  return step.owner_side === "seller" ? "Seller" : "Buyer";
}

/** mailto: invite affordance for the buying committee (T33-4). Needs no
 *  backend — every field it uses is already on the buyer-safe payload. A
 *  real "add a committee member" flow (persisted membership, notifications)
 *  is not modelled anywhere in BuyerPayload yet and is out of this
 *  renderer's scope; this is a genuinely working affordance today, not a
 *  placeholder that does nothing on click. */
export function buildCommitteeInviteHref(targetCompanyName: string): string {
  const subject = encodeURIComponent(`Join our shared plan — ${targetCompanyName}`);
  const body = encodeURIComponent(
    "Hi,\n\nI'd like to bring you into our shared success plan so you can see where things stand. I'll send the link separately.\n\nThanks!",
  );
  return `mailto:?subject=${subject}&body=${body}`;
}
