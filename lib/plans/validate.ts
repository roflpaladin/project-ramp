// Boundary validators for the mutual success plan tree.
//
// T28-6 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Hand-rolled
// rather than Zod, per the ticket's own reversal trigger: "if exhaustive
// per-branch unit tests cannot be delivered in the same day, take Zod
// instead — an untested hand-rolled validator is strictly worse than a
// schema library." tests/plans/validate.spec.ts ships alongside this file
// with exhaustive per-branch coverage, so the trigger does not fire.
//
// Each check mirrors a NOT NULL / CHECK column in migration 0005 — named in
// the doc comment on the function that enforces it — plus a small amount of
// app-level sanity (e.g. rejecting a negative display_order, or a malformed
// email) that is NOT a database constraint at all; those are called out
// individually below rather than presented as if they came from 0005.
//
// Callers are expected to run these BEFORE calling into lib/plans/write.ts.
// They are a UX/latency optimisation and a field-attributable error source,
// never the security boundary — RLS (0005) and 0007's CHECKs remain the
// actual guarantee, and lib/plans/errors.ts maps a DB-level violation that
// slips past these to the same PlanErrorCode a caller would have gotten here.

import type {
  NewPlanInput,
  NewStageInput,
  NewStepInput,
  PlanActionResult,
  PlanPatch,
  ReorderInput,
  StagePatch,
  StepPatch,
} from "./mutations";
import type { OwnerSide, PlanStatus, StageStatus, StepStatus } from "./types";

const PLAN_STATUSES: readonly PlanStatus[] = ["draft", "active", "won", "lost"];
const STAGE_STATUSES: readonly StageStatus[] = ["upcoming", "current", "done"];
/** plan_steps.status on a create/update boundary — 'done' only via step completion (Ticket 35). */
const STEP_STATUSES_ON_WRITE: readonly Exclude<StepStatus, "done">[] = ["open", "blocked"];
const OWNER_SIDES: readonly OwnerSide[] = ["seller", "buyer"];

/** Postgres `date`, serialized "YYYY-MM-DD" — matches every *_date field's doc comment in types.ts. */
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
/** App-level sanity only — 0005 has no email format CHECK on owner_email. */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** App-level sanity only — a reorder id must at least be UUID-shaped before any RPC round trip. */
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail<T>(code: "VALIDATION_ERROR" | "INVALID_DATE_RANGE"): PlanActionResult<T> {
  return { ok: false, code };
}

function isValidDateString(value: string): boolean {
  return DATE_FORMAT.test(value) && !Number.isNaN(Date.parse(value));
}

/** App-level sanity, not a 0005 constraint: negative/non-integer display_order is meaningless, not merely unusual. */
function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * T28-18: the TypeScript pre-check for target_date < start_date, kept
 * ALONGSIDE 0005's `success_plans_date_order` DB CHECK, not instead of it.
 * The DB is the guarantee; this is the field-attributable message — it
 * returns INVALID_DATE_RANGE deterministically, by field, before any network
 * round trip, which matters because the DB CHECK's own constraint name could
 * only be resolved by lib/plans/errors.ts if PostgREST's error text happens
 * to carry it (it does — see errors.ts's audit note — but this pre-check
 * doesn't depend on that at all).
 *
 * Pure function, no I/O. Only ever returns `ok: false` for a genuine
 * ordering violation — a missing date on either side is not this function's
 * concern (0005 explicitly allows either date to be null).
 */
export function checkDateOrder(
  startDate: string | null | undefined,
  targetDate: string | null | undefined,
): PlanActionResult<void> {
  if (!startDate || !targetDate) return { ok: true, data: undefined };
  if (targetDate < startDate) return fail("INVALID_DATE_RANGE");
  return { ok: true, data: undefined };
}

// --- success_plans -----------------------------------------------------

/** title: NOT NULL. workspace_id: NOT NULL (FK). start_date/target_date: nullable `date`, ordered by checkDateOrder. status: CHECK'd enum. */
export function validateNewPlanInput(input: NewPlanInput): PlanActionResult<NewPlanInput> {
  const title = input.title.trim();
  if (!title) return fail("VALIDATION_ERROR");
  if (!input.workspace_id) return fail("VALIDATION_ERROR");

  if (input.start_date != null && !isValidDateString(input.start_date)) return fail("VALIDATION_ERROR");
  if (input.target_date != null && !isValidDateString(input.target_date)) return fail("VALIDATION_ERROR");

  const dateOrder = checkDateOrder(input.start_date, input.target_date);
  if (!dateOrder.ok) return dateOrder;

  if (input.status !== undefined && !PLAN_STATUSES.includes(input.status)) return fail("VALIDATION_ERROR");

  return { ok: true, data: { ...input, title } };
}

/**
 * All fields optional — only what's present in the patch is checked.
 * IMPORTANT: the cross-field date-order check only runs when BOTH dates are
 * present in THIS patch. An update that sets only target_date against an
 * existing start_date can't be validated here without reading the row first;
 * lib/plans/write.ts's round trip against 0005's CHECK is the actual
 * guarantee for that partial-update case, not this function.
 */
export function validatePlanPatch(patch: PlanPatch): PlanActionResult<PlanPatch> {
  if (patch.title !== undefined && !patch.title.trim()) return fail("VALIDATION_ERROR");
  if (patch.start_date != null && !isValidDateString(patch.start_date)) return fail("VALIDATION_ERROR");
  if (patch.target_date != null && !isValidDateString(patch.target_date)) return fail("VALIDATION_ERROR");

  if (patch.start_date != null && patch.target_date != null) {
    const dateOrder = checkDateOrder(patch.start_date, patch.target_date);
    if (!dateOrder.ok) return dateOrder;
  }

  if (patch.status !== undefined && !PLAN_STATUSES.includes(patch.status)) return fail("VALIDATION_ERROR");

  return { ok: true, data: patch };
}

// --- plan_stages ---------------------------------------------------------

/** title: NOT NULL. plan_id: NOT NULL (FK). display_order: app-level non-negative-integer sanity. status: CHECK'd enum. */
export function validateNewStageInput(input: NewStageInput): PlanActionResult<NewStageInput> {
  const title = input.title.trim();
  if (!title) return fail("VALIDATION_ERROR");
  if (!input.plan_id) return fail("VALIDATION_ERROR");
  if (input.display_order !== undefined && !isNonNegativeInteger(input.display_order)) {
    return fail("VALIDATION_ERROR");
  }
  if (input.status !== undefined && !STAGE_STATUSES.includes(input.status)) return fail("VALIDATION_ERROR");

  return { ok: true, data: { ...input, title } };
}

export function validateStagePatch(patch: StagePatch): PlanActionResult<StagePatch> {
  if (patch.title !== undefined && !patch.title.trim()) return fail("VALIDATION_ERROR");
  if (patch.display_order !== undefined && !isNonNegativeInteger(patch.display_order)) {
    return fail("VALIDATION_ERROR");
  }
  if (patch.status !== undefined && !STAGE_STATUSES.includes(patch.status)) return fail("VALIDATION_ERROR");

  return { ok: true, data: patch };
}

// --- plan_steps ------------------------------------------------------------

/**
 * label: NOT NULL. stage_id: NOT NULL (FK). owner_side: CHECK'd enum, NOT
 * NULL. owner_email: nullable, app-level format sanity only (0005 has no
 * email CHECK). due_date: nullable `date`. display_order: app-level
 * non-negative-integer sanity. status: CHECK'd enum, but re-validated at
 * RUNTIME against STEP_STATUSES_ON_WRITE rather than trusted from the
 * NewStepInput type alone — the type excludes 'done' at compile time, but a
 * caller assembling input from FormData (plan-actions.ts) can still produce
 * an object with status: 'done' at runtime, and this boundary must not trust
 * the type system for input that didn't originate as a literal.
 */
export function validateNewStepInput(input: NewStepInput): PlanActionResult<NewStepInput> {
  const label = input.label.trim();
  if (!label) return fail("VALIDATION_ERROR");
  if (!input.stage_id) return fail("VALIDATION_ERROR");
  if (!OWNER_SIDES.includes(input.owner_side)) return fail("VALIDATION_ERROR");

  if (input.owner_email != null && input.owner_email !== "" && !EMAIL_FORMAT.test(input.owner_email)) {
    return fail("VALIDATION_ERROR");
  }
  if (input.due_date != null && !isValidDateString(input.due_date)) return fail("VALIDATION_ERROR");
  if (input.display_order !== undefined && !isNonNegativeInteger(input.display_order)) {
    return fail("VALIDATION_ERROR");
  }
  if (input.status !== undefined && !STEP_STATUSES_ON_WRITE.includes(input.status)) {
    return fail("VALIDATION_ERROR");
  }

  return { ok: true, data: { ...input, label } };
}

export function validateStepPatch(patch: StepPatch): PlanActionResult<StepPatch> {
  if (patch.label !== undefined && !patch.label.trim()) return fail("VALIDATION_ERROR");
  if (patch.owner_side !== undefined && !OWNER_SIDES.includes(patch.owner_side)) {
    return fail("VALIDATION_ERROR");
  }
  if (patch.owner_email != null && patch.owner_email !== "" && !EMAIL_FORMAT.test(patch.owner_email)) {
    return fail("VALIDATION_ERROR");
  }
  if (patch.due_date != null && !isValidDateString(patch.due_date)) return fail("VALIDATION_ERROR");
  if (patch.display_order !== undefined && !isNonNegativeInteger(patch.display_order)) {
    return fail("VALIDATION_ERROR");
  }
  if (patch.status !== undefined && !STEP_STATUSES_ON_WRITE.includes(patch.status)) {
    return fail("VALIDATION_ERROR");
  }

  return { ok: true, data: patch };
}

// --- reorder -----------------------------------------------------------

/**
 * Format sanity only: is this an array of UUID-shaped strings. Deliberately
 * does NOT reject duplicates or check the array against the real parent set
 * — that exact-set check must run against the server-computed, RLS-scoped
 * real set anyway (0007's reorder RPCs do it), and duplicating it here would
 * just be a second place for the two checks to drift out of sync.
 */
export function validateReorderInput(order: ReorderInput): PlanActionResult<ReorderInput> {
  if (!Array.isArray(order)) return fail("VALIDATION_ERROR");
  if (order.some((id) => typeof id !== "string" || !UUID_FORMAT.test(id))) {
    return fail("VALIDATION_ERROR");
  }

  return { ok: true, data: order };
}
