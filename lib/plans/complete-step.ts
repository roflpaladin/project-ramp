// Buyer-side write path for a single plan_steps completion.
//
// T35-1..T35-4 (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7). Split out
// of app/api/steps/[id]/complete/route.ts (rather than kept inline) so it can
// be unit-exercised and so the route file stays a thin guard chain. NEVER
// createSellerClient here: buyers hold no Supabase Auth session, so this file
// is deliberately admin-client-only and deliberately NOT lib/plans/write.ts,
// which forbids exactly that. The route handler is what verifies the portal
// session and the owner_side BEFORE calling anything below -- this file trusts
// its caller on that, the same division of labour queries.ts and
// portal-payload.ts already use (raw read here, boundary enforced elsewhere).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostgrestErrorLike } from "./errors";
import type { OwnerSide, PlanStepRow, StepStatus } from "./types";

export type CompleteStepClient = SupabaseClient;

export interface StepForCompletion {
  readonly id: string;
  readonly ownerSide: OwnerSide;
  readonly status: StepStatus;
  readonly workspaceId: string;
}

/** PostgREST's embed shape for the child -> parent -> parent chain below. */
interface RawStepWithWorkspace {
  id: string;
  owner_side: OwnerSide;
  status: StepStatus;
  plan_stages: { success_plans: { workspace_id: string } | null } | null;
}

const STEP_WORKSPACE_SELECT = "id, owner_side, status, plan_stages ( success_plans ( workspace_id ) )";

/**
 * T35-2. Resolves a step's workspace by walking step -> stage -> plan ->
 * workspace, NEVER from a client-supplied value. This is the ONLY trusted
 * input to the completion endpoint (the step id, from the URL path) --
 * everything else the route needs (which cookie name to read, which
 * owner_side to check) is derived from what this returns. Callers MUST call
 * this first and use its workspaceId to pick a single cookie name to read
 * next; reading any cookie first and trusting whichever workspace it names is
 * the exact bug this ordering exists to make unreachable (T35-10 is the
 * human review gate for that ordering; this comment is not a substitute for
 * it, only a pointer to it).
 *
 * Returns null for "no such step" -- callers turn that into 404, same
 * NOT_FOUND-not-403 reasoning as the rest of this codebase's write paths.
 */
export async function resolveStepWorkspace(
  stepId: string,
  client: CompleteStepClient,
): Promise<StepForCompletion | null> {
  const { data, error } = await client
    .from("plan_steps")
    .select(STEP_WORKSPACE_SELECT)
    .eq("id", stepId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as RawStepWithWorkspace;
  const workspaceId = row.plan_stages?.success_plans?.workspace_id;
  // Not reachable given 0005's NOT NULL FKs (stage_id, plan_id are both NOT
  // NULL) -- defensive only. Treated the same as "step not found" rather
  // than thrown: a step this endpoint cannot resolve a workspace for is not
  // completable, for the caller's purposes that's identical to absent.
  if (!workspaceId) return null;

  return { id: row.id, ownerSide: row.owner_side, status: row.status, workspaceId };
}

export type CompleteStepOutcome =
  | { readonly kind: "completed"; readonly step: PlanStepRow }
  | { readonly kind: "already-done"; readonly step: PlanStepRow }
  | { readonly kind: "blocked" }
  // Defensive only -- see the comment above the branch that produces this in
  // completeStepAsBuyer. Never expected to be reachable in practice.
  | { readonly kind: "unexpected"; readonly status: StepStatus };

const STEP_ROW_SELECT =
  "id, stage_id, label, owner_side, owner_name, owner_email, due_date, status, display_order, completed_at, completed_by_email, private_note";

/**
 * T35-3. Idempotency by conditional UPDATE, not check-then-act: the WHERE
 * clause requires status = 'open' AND owner_side = 'buyer'. The owner_side
 * arm is REDUNDANT with the route handler's own pre-read guard (belt and
 * braces, near-zero cost) -- it closes the TOCTOU window between that read
 * and this write rather than reasoning about whether the race is currently
 * reachable.
 *
 * Decision (plans/sprint-6-7-replan.md §1, open item "Replay of an
 * already-completed step"): replaying a completed step returns the EXISTING
 * row, 200, as an idempotent no-op -- not an error. A `blocked` step must
 * NEVER fall into that same branch, so an empty UPDATE result re-reads the
 * step's actual current status and branches explicitly on it, rather than
 * assuming "empty result means already done."
 */
export async function completeStepAsBuyer(
  stepId: string,
  buyerEmail: string,
  client: CompleteStepClient,
): Promise<CompleteStepOutcome> {
  const { data: updated, error: updateError } = await client
    .from("plan_steps")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by_email: buyerEmail,
    })
    .eq("id", stepId)
    .eq("status", "open")
    .eq("owner_side", "buyer")
    .select(STEP_ROW_SELECT);

  if (updateError) throw updateError;

  if (updated && updated.length > 0) {
    return { kind: "completed", step: updated[0] as PlanStepRow };
  }

  // The WHERE matched nothing: the step is not currently 'open'. The route
  // handler's pre-read guard already confirmed owner_side = 'buyer' before
  // calling this function, so the only remaining explanations left in
  // status's CHECK-bounded value domain ('open' | 'done' | 'blocked') are
  // 'done' (a replay) or 'blocked' (must be rejected, never silently 200'd).
  const { data: current, error: readError } = await client
    .from("plan_steps")
    .select(STEP_ROW_SELECT)
    .eq("id", stepId)
    .single();

  if (readError) throw readError;

  const row = current as PlanStepRow;
  if (row.status === "done") return { kind: "already-done", step: row };
  if (row.status === "blocked") return { kind: "blocked" };

  // Unreachable in practice: owner_side is fixed at step creation (this
  // endpoint never changes it) and the CHECK-bounded status domain has no
  // fourth value. Left explicit rather than an `else` so a future status
  // value added to 0005 fails loudly here instead of being silently treated
  // as either "done" or "blocked".
  return { kind: "unexpected", status: row.status };
}

/** Narrows `unknown` to the shape errors.ts's mapPostgrestError expects. */
export function isPostgrestErrorLike(error: unknown): error is PostgrestErrorLike {
  return typeof error === "object" && error !== null && "code" in error;
}
