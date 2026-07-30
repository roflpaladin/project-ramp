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

import type { OwnerSide, PlanStatus, StageStatus, StepStatus } from "./types";

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
