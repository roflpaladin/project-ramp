// Named constraint / index / RPC-error contract mirrored from migrations
// 0005 and 0007.
//
// T28-4 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). errors.ts
// discriminates Postgres errors on SQLSTATE + constraint name TOGETHER, never
// SQLSTATE alone — two different named CHECKs on plan_steps both raise
// 23514, and only the constraint name tells them apart. These names are
// therefore application contract: rename one of these in a future migration
// without updating this file and the error mapper silently falls back to a
// generic 500 instead of the specific code it should return.
//
// AUDIT RESULT (T28-4), checked directly against
// supabase/migrations/0005_success_plans.sql: every name below is an
// EXPLICITLY NAMED constraint/index. In particular,
// `success_plans_date_order` was flagged in the ticket as a possible
// UNNAMED inline CHECK before this audit — it is in fact named, via
// `constraint success_plans_date_order check (...)` at 0005 lines 30-31, not
// an unnamed inline `check (...)` on a column. No SQLSTATE+relation fallback
// is implemented in errors.ts for that case as a result (see errors.ts's
// comment for the reasoning). Only export constants for names that truly
// exist — this file deliberately omits 0005's UNNAMED inline CHECKs
// (`success_plans_status_check`, `plan_stages_status_check`,
// `plan_steps_owner_side_check`, `plan_steps_status_check` — all
// auto-generated names from a bare `check (col in (...))` on a column, never
// written out in the migration) because nothing in this ticket's scope needs
// to discriminate on them.

/**
 * Unique partial index enforcing at most one draft/active plan per workspace.
 * Source: 0005_success_plans.sql, lines 37-39
 * (`create unique index if not exists idx_success_plans_one_live_per_workspace ...`).
 */
export const SUCCESS_PLANS_ONE_LIVE_PER_WORKSPACE_INDEX =
  "idx_success_plans_one_live_per_workspace";

/**
 * Named CHECK: target_date >= start_date whenever both are present.
 * Source: 0005_success_plans.sql, lines 30-31
 * (`constraint success_plans_date_order check (...)`).
 */
export const SUCCESS_PLANS_DATE_ORDER_CHECK = "success_plans_date_order";

/**
 * Named CHECK: (status = 'done') = (completed_at is not null).
 * Source: 0005_success_plans.sql, lines 81-82
 * (`constraint plan_steps_completion_coherent check (...)`).
 */
export const PLAN_STEPS_COMPLETION_COHERENT_CHECK = "plan_steps_completion_coherent";

/**
 * Not a constraint or index — the fixed exception message 0007's
 * `reorder_plan_stages` / `reorder_plan_steps` raise (via
 * `raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001'`) whenever
 * the submitted id array doesn't exactly match the parent's real, RLS-scoped
 * id set. Tracked here anyway: it is the same kind of naming contract
 * between a migration and errors.ts as the constraints above.
 * Source: 0007_plan_reorder.sql, e.g. lines 60, 77, 91 (reorder_plan_stages)
 * and lines 126, 142, 156 (reorder_plan_steps).
 */
export const REORDER_SET_MISMATCH_MESSAGE = "REORDER_SET_MISMATCH";
