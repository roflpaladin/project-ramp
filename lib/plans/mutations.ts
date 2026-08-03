// Write shapes for the mutual success plan tree.
//
// Scaffolded here, exercised in Ticket 28 (Sprint 6) where the plan endpoints
// land. Deliberately types-only: stub functions that throw "not implemented"
// are reachable code that does nothing useful, and something always ends up
// calling one. Ticket 28 adds the implementations alongside their tests.
//
// Every shape below is derived from the NOT NULL and CHECK columns in migration
// 0005 rather than guessed from the PRD, so it cannot drift from what the
// database will actually accept.

import type { PlanErrorCode } from "./errors";
import type { OwnerSide, PlanStatus, StageStatus, StepStatus } from "./types";

// PlanErrorCode's canonical home is errors.ts (mapPostgrestError needs it and
// has no dependency on this file), re-exported here so callers of the write
// layer can import both the result type and its error vocabulary from one
// place — lib/plans/mutations.ts, per T28-7.
export type { PlanErrorCode } from "./errors";

/**
 * The result every plan mutation returns instead of throwing or returning
 * void (T28-7). Deliberately just `{ ok: false; code: PlanErrorCode }` on
 * failure — no free-text `message` field — because every caller in this
 * codebase (server actions, write.ts, tests) works off `code`, and a
 * free-text field is exactly the raw-Postgres leak surface errors.ts's
 * mapping exists to avoid.
 */
export type PlanActionResult<T> = { ok: true; data: T } | { ok: false; code: PlanErrorCode };

export interface NewPlanInput {
  workspace_id: string;
  title: string;
  /** "YYYY-MM-DD". 0005 CHECKs target_date >= start_date when both are present. */
  start_date?: string | null;
  target_date?: string | null;
  /** Defaults to 'draft' in the database. */
  status?: PlanStatus;
}

export interface NewStageInput {
  plan_id: string;
  title: string;
  display_order?: number;
  status?: StageStatus;
}

export interface NewStepInput {
  stage_id: string;
  label: string;
  owner_side: OwnerSide;
  owner_name?: string | null;
  owner_email?: string | null;
  /** "YYYY-MM-DD". */
  due_date?: string | null;
  /** A step cannot be created already done — completion needs StepCompletionInput. */
  status?: Exclude<StepStatus, "done">;
  display_order?: number;
  /** Seller-private. Never accepted from a buyer-facing endpoint. */
  private_note?: string | null;
}

/**
 * Completion is one input, not three independent fields, because 0005 enforces
 *   (status = 'done') = (completed_at is not null)
 * A caller that sets status without completed_at gets a constraint violation, so
 * the type makes the coupling explicit rather than leaving it to be discovered
 * at runtime.
 *
 * Reopening a step is the 'open' | 'blocked' branch, which clears completed_at.
 */
export type StepCompletionInput =
  | {
      status: "done";
      /** timestamptz, e.g. "2026-07-05T14:00:00+00:00". */
      completed_at: string;
      completed_by_email: string;
    }
  | {
      status: Exclude<StepStatus, "done">;
      completed_at?: null;
      completed_by_email?: null;
    };

// --- Patch shapes (T28-7) ---------------------------------------------------
//
// Each patch OMITS its parent FK by construction: `Omit<New*Input, fk>` first,
// `Partial<...>` second — never a bare `Partial<New*Input>`. A bare
// `Partial<NewPlanInput>` would leave `workspace_id` an assignable (if
// optional) key on the patch type, and an update path that forwarded it
// unfiltered could move a plan between two of the seller's own workspaces.
// lib/plans/write.ts's updatePlan/updateStage/updateStep never accept the
// parent FK for exactly this reason — it isn't on the type to accept.

/** workspace_id omitted by construction — see the note above. */
export type PlanPatch = Partial<Omit<NewPlanInput, "workspace_id">>;

/** plan_id omitted by construction — see the note above. */
export type StagePatch = Partial<Omit<NewStageInput, "plan_id">>;

/** stage_id omitted by construction — see the note above. */
export type StepPatch = Partial<Omit<NewStepInput, "stage_id">>;

/**
 * The full, ordered id set for one parent (a plan's stages, or a stage's
 * steps) after a move-up/move-down reorder (Ticket 29, decision 5 — drag-and-
 * drop was cut). Matches 0007's RPC wire format exactly: an ordered id array,
 * not (id, display_order) pairs (Notion amendment, plans/sprint-6-7-replan.md
 * §10) — a pairs array can express duplicates, gaps and negatives, which is
 * why "validate the whole batch" was an AC in the first place; an ordered
 * array of the full set cannot express any of those, so that AC is deleted
 * rather than tested.
 */
export type ReorderInput = readonly string[];
