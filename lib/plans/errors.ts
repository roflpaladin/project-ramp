// Postgres error -> application error code mapping for the plan write paths.
//
// T28-5 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Discriminates on
// SQLSTATE + constraint name TOGETHER, never SQLSTATE alone — two different
// named CHECKs on plan_steps both raise 23514, and only the constraint name
// tells them apart. Never surfaces error.message / error.details to a
// caller: that is raw Postgres text, and none of this module's callers
// should leak it into an HTTP response or a server action result.

import {
  GO_LIVE_NOT_PERMITTED_MESSAGE,
  PLAN_STEPS_COMPLETION_COHERENT_CHECK,
  REORDER_SET_MISMATCH_MESSAGE,
  SUCCESS_PLANS_DATE_ORDER_CHECK,
  SUCCESS_PLANS_ONE_LIVE_PER_WORKSPACE_INDEX,
} from "./constraints";

/**
 * The full closed set of codes an action against the plan tree can fail
 * with. Every caller (route.ts, plan-actions.ts, write.ts, validate.ts)
 * works off this single union so a switch over it can be exhaustive.
 *
 * - UNAUTHENTICATED never comes out of this module — require-seller.ts
 *   produces it before a Postgres call is even made. It lives in the same
 *   union so a caller handles one closed set rather than two.
 * - VALIDATION_ERROR is validate.ts's generic code for a field failure that
 *   isn't specifically the date-range case (empty title, malformed email,
 *   out-of-range enum, malformed reorder id, ...).
 * - UNKNOWN_ERROR is this module's catch-all: an unrecognised Postgres error
 *   maps here instead of leaking raw Postgres text to a caller.
 *
 * Sprint 12, Ticket 60 added five, four of which no Postgres error produces —
 * they are decided above this module, by the go-live gate and the read-only
 * guard, and live in the same union so a caller still handles ONE closed set:
 * - PLAN_CLOSED: the plan is won/lost. Closing deletes nothing and the seller
 *   keeps seeing the deal, so every mutation on it is refused server-side
 *   rather than merely hidden in the UI.
 * - DEAL_LIMIT_REACHED: the tenant is at their tier's active-deal cap. The
 *   upgrade wall — and ONLY ever that, never an infrastructure failure.
 * - SAMPLE_DEAL_LOCKED: the plan is in the sample workspace, which the limit
 *   never counts. Not a wall (no upgrade fixes it) and not an error — the
 *   seller is told to make a real deal.
 * - BILLING_PAST_DUE: payment failed and the 7-day grace is over. Existing
 *   deals and buyers are untouched; only NEW deals are refused.
 * - BILLING_CHECK_FAILED: we could not read the tenant's billing state at
 *   all. Fails closed (no new deal) but says so honestly, because rendering
 *   the upgrade wall for our own outage would be a lie about money.
 * - GO_LIVE_NOT_PERMITTED is the one Postgres DOES produce: 0015's go-live
 *   trigger, mapped below.
 */
export type PlanErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "PLAN_ALREADY_LIVE"
  | "PLAN_CLOSED"
  | "DEAL_LIMIT_REACHED"
  | "SAMPLE_DEAL_LOCKED"
  | "BILLING_PAST_DUE"
  | "BILLING_CHECK_FAILED"
  | "GO_LIVE_NOT_PERMITTED"
  | "INVALID_DATE_RANGE"
  | "INCOHERENT_COMPLETION"
  | "REORDER_SET_MISMATCH"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ERROR";

export interface PlanErrorMapping {
  readonly code: PlanErrorCode;
  readonly status: number;
}

/**
 * The subset of @supabase/supabase-js's PostgrestError this module actually
 * reads, expressed structurally rather than imported. Lets the unit tests
 * construct a synthetic error without pulling in a real Supabase client —
 * this mapper's correctness is provable with plain objects, no DB required.
 */
export interface PostgrestErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

const UNKNOWN_ERROR: PlanErrorMapping = { code: "UNKNOWN_ERROR", status: 500 };

/**
 * Postgres always names a CHECK/UNIQUE violation in its error text, even an
 * auto-generated name for an unnamed inline `check (...)` — so this
 * extraction is reliable for every 23505/23514 this module sees.
 *
 * No SQLSTATE+relation fallback is implemented for the date-range case
 * (contrast the "otherwise map by SQLSTATE+relation" language in the
 * ticket): T28-4's audit confirmed `success_plans_date_order` is an
 * explicitly named constraint (0005 lines 30-31), so the primary
 * name-match branch below is always reachable in practice. A looser
 * relation-only fallback ("message mentions success_plans") was considered
 * and rejected — success_plans also has an unnamed `status` CHECK, whose
 * auto-generated name (`success_plans_status_check`) also mentions the
 * `success_plans` relation, and a relation-only fallback would misclassify
 * that violation as INVALID_DATE_RANGE. Falling through to UNKNOWN_ERROR for
 * an unrecognised 23514 is the safer default.
 */
function extractConstraintName(error: PostgrestErrorLike): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  const match = /constraint "([^"]+)"/.exec(source);
  return match?.[1] ?? null;
}

export function mapPostgrestError(error: PostgrestErrorLike): PlanErrorMapping {
  const sqlState = error.code ?? "";
  const message = error.message ?? "";

  // 0007's reorder_plan_stages / reorder_plan_steps raise a plain exception
  // with errcode 'P0001' and this exact message when the submitted id set
  // doesn't match the parent's real, RLS-scoped set.
  if (sqlState === "P0001" && message.includes(REORDER_SET_MISMATCH_MESSAGE)) {
    return { code: "REORDER_SET_MISMATCH", status: 400 };
  }

  // 0015's trg_success_plans_go_live_guard, same SQLSTATE, told apart by the
  // same message contract. 403 rather than 404 here — unlike the 42501 case
  // below, this trigger only fires AFTER RLS has already accepted the row as
  // the caller's own, so the status confirms nothing a foreign caller could
  // use to enumerate anything.
  if (sqlState === "P0001" && message.includes(GO_LIVE_NOT_PERMITTED_MESSAGE)) {
    return { code: "GO_LIVE_NOT_PERMITTED", status: 403 };
  }

  const constraintName = extractConstraintName(error);

  if (sqlState === "23505") {
    if (constraintName === SUCCESS_PLANS_ONE_LIVE_PER_WORKSPACE_INDEX) {
      return { code: "PLAN_ALREADY_LIVE", status: 409 };
    }
    return UNKNOWN_ERROR;
  }

  if (sqlState === "23514") {
    if (constraintName === PLAN_STEPS_COMPLETION_COHERENT_CHECK) {
      // A bug, not user error: the app layer builds StepCompletionInput so
      // that status = 'done' and completed_at can never disagree (see
      // lib/plans/mutations.ts). Reaching this branch means that invariant
      // broke somewhere upstream of the database call.
      return { code: "INCOHERENT_COMPLETION", status: 500 };
    }
    if (constraintName === SUCCESS_PLANS_DATE_ORDER_CHECK) {
      return { code: "INVALID_DATE_RANGE", status: 400 };
    }
    return UNKNOWN_ERROR;
  }

  if (sqlState === "42501") {
    // RLS's `with check` rejected the write. Never 403: a 403 confirms the
    // resource exists in a tenant the caller cannot access, which is itself
    // the enumeration leak the buyer-boundary work exists to prevent — the
    // same reasoning /api/demo/pulse and getPlanForSeller already apply.
    return { code: "NOT_FOUND", status: 404 };
  }

  return UNKNOWN_ERROR;
}
