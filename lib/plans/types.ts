// Hand-written row types for the mutual success plan tree.
//
// Deliberately NOT generated from the Supabase schema. A generated type widens
// itself the moment someone adds a column, which is exactly the failure mode the
// buyer boundary (Ticket 25) is built to resist: BuyerPayload must never inherit
// a new private field by accident. Keeping these hand-written means a schema
// change surfaces as a compile error in a diff someone reads, rather than as
// silent widening.
//
// The string-literal unions mirror the CHECK constraints in migration 0005
// exactly. If a constraint changes there it must change here too — the database
// is the authority, this is the mirror.

/** success_plans.status */
export type PlanStatus = "draft" | "active" | "won" | "lost";

/** plan_stages.status */
export type StageStatus = "upcoming" | "current" | "done";

/** plan_steps.status */
export type StepStatus = "open" | "done" | "blocked";

/**
 * plan_steps.owner_side — the core two-sided differentiator (PRD §2.5).
 * Exactly two sides. There is no "both": the completion endpoint (Ticket 35)
 * rejects a buyer completing a row where owner_side is 'seller'.
 */
export type OwnerSide = "seller" | "buyer";

export interface SuccessPlanRow {
  id: string;
  workspace_id: string;
  title: string;
  /** Postgres `date`, serialized "YYYY-MM-DD" — not a timestamp. */
  start_date: string | null;
  target_date: string | null;
  status: PlanStatus;
  /** timestamptz, serialized "2026-07-05T14:00:00+00:00". */
  created_at: string;
}

export interface PlanStageRow {
  id: string;
  plan_id: string;
  title: string;
  display_order: number;
  status: StageStatus;
}

export interface PlanStepRow {
  id: string;
  stage_id: string;
  label: string;
  owner_side: OwnerSide;
  owner_name: string | null;
  owner_email: string | null;
  /** Postgres `date`, serialized "YYYY-MM-DD". */
  due_date: string | null;
  status: StepStatus;
  display_order: number;
  /**
   * Migration 0005 enforces (status = 'done') = (completed_at is not null),
   * so these two can never disagree at rest.
   */
  completed_at: string | null;
  completed_by_email: string | null;
  /**
   * SELLER-PRIVATE. Must be stripped from every buyer payload (PRD §3.3).
   * Its presence here is correct: this is the raw seller-side shape. The strip
   * happens in lib/portal-payload.ts (Ticket 25), never in this layer.
   */
  private_note: string | null;
}

/** A stage with its steps attached, ordered. */
export interface PlanStage extends PlanStageRow {
  steps: PlanStepRow[];
}

/** The assembled tree: one plan, its stages, and their steps — all ordered. */
export interface PlanTree extends SuccessPlanRow {
  stages: PlanStage[];
}
