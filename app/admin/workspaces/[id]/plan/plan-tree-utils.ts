// Pure helpers for the plan builder's client-side tree state (Ticket 29,
// T29-5). No React, no I/O — everything here is a plain function over
// PlanStage / PlanStageRow / PlanStepRow so it is unit-testable without
// mounting a component or touching Supabase.

import type { PlanStage, PlanStageRow, PlanStepRow } from "@/lib/plans/types";

export type ReorderDirection = "up" | "down";

/**
 * Swaps `index` with its up/down neighbour. Returns the SAME array
 * reference (not a copy) when the move is out of bounds, so a caller can
 * cheaply check `result === items` to detect a no-op. The move buttons'
 * disabled state already prevents this from being reachable through the UI
 * (first item's "up" and last item's "down" are disabled) — this is the
 * belt-and-braces check for anything that calls the mover directly.
 */
export function moveIndex<T>(items: readonly T[], index: number, direction: ReorderDirection): T[] {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || targetIndex < 0 || targetIndex >= items.length) {
    return items as T[];
  }
  const next = [...items];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

/**
 * Reconciles a client-held stage tree against a reorderStagesAction result.
 * That result is the authoritative ORDER (and status/title/etc.) but never
 * carries `steps` — plan_stages columns only — so this keeps each stage's
 * own steps from the current tree and takes every other field from the
 * authoritative row, in the authoritative order.
 */
export function mergeStageOrder(current: readonly PlanStage[], authoritative: readonly PlanStageRow[]): PlanStage[] {
  const stepsById = new Map(current.map((stage) => [stage.id, stage.steps]));
  return authoritative.map((row) => ({ ...row, steps: stepsById.get(row.id) ?? [] }));
}

/** Same idea as mergeStageOrder, scoped to one stage's steps. */
export function mergeStepOrder(
  current: readonly PlanStage[],
  stageId: string,
  authoritative: readonly PlanStepRow[],
): PlanStage[] {
  return current.map((stage) => (stage.id === stageId ? { ...stage, steps: [...authoritative] } : stage));
}

/**
 * The one "live" step for the whole plan (Ticket 29's ramp gesture /
 * signal-wash target): the first step, in plan order, whose status is
 * 'open'. 'done' and 'blocked' steps are skipped — a blocked step isn't the
 * next move, it's what's in the way of it. Returns null once every step is
 * done or blocked, or the plan has no steps at all — there is then no
 * amber anywhere on the page, which is correct: Signal marks an available
 * action, and there isn't one.
 */
export function findLiveStepId(stages: readonly PlanStage[]): string | null {
  for (const stage of stages) {
    for (const step of stage.steps) {
      if (step.status === "open") return step.id;
    }
  }
  return null;
}
