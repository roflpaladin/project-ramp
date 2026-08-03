// RLS-scoped write functions for the mutual success plan tree.
//
// T28-8 (Sprint 6, Ticket 28). Mirrors queries.ts's injectable-client
// testability pattern: production callers omit `client` and get the
// RLS-scoped seller client built from next/headers cookies(); tests inject a
// signed-in client instead, since the default constructor throws outside a
// request context.
//
// NEVER createAdminClient here. Every function below runs AS the calling
// role, so 0005's "AE manages own tenant ..." RLS policies are the actual
// authorization boundary — the same reason 0007's reorder RPCs are SECURITY
// INVOKER, not DEFINER (see 0007's header comment). A foreign tenant's row is
// either invisible to a read-back (returns null -> NOT_FOUND) or its write is
// rejected with SQLSTATE 42501, which errors.ts maps to NOT_FOUND, never a
// leaked 403.
//
// Callers are expected to have already run the matching lib/plans/validate.ts
// check; this file does not re-validate input shape, only maps whatever
// Postgres actually says about the write.
//
// Behavioural DB tests for this file are QA's T28-14 (plans/sprint-6-7-replan.md
// §6) — this file is authored and typechecked here, not integration-tested.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient as createSellerClient } from "@/lib/supabase/server";
import { mapPostgrestError, type PostgrestErrorLike } from "./errors";
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
import type { PlanStageRow, PlanStepRow, SuccessPlanRow } from "./types";

/** Any Supabase client — see queries.ts's PlanReadClient for the same rationale. */
export type PlanWriteClient = SupabaseClient;

async function resolveClient(client?: PlanWriteClient): Promise<PlanWriteClient> {
  return client ?? (await createSellerClient());
}

function fromError<T>(error: PostgrestErrorLike): PlanActionResult<T> {
  return { ok: false, code: mapPostgrestError(error).code };
}

// --- success_plans -----------------------------------------------------

export async function createPlan(
  input: NewPlanInput,
  client?: PlanWriteClient,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase.from("success_plans").insert(input).select().single();

  if (error) return fromError(error);
  return { ok: true, data };
}

export async function updatePlan(
  planId: string,
  patch: PlanPatch,
  client?: PlanWriteClient,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("success_plans")
    .update(patch)
    .eq("id", planId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  // RLS hides a foreign tenant's row rather than erroring on the SELECT half
  // of this round trip — null covers both "no such plan" and "not this
  // caller's tenant" with the one NOT_FOUND code, on purpose.
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

export async function deletePlan(
  planId: string,
  client?: PlanWriteClient,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("success_plans")
    .delete()
    .eq("id", planId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

// --- plan_stages -----------------------------------------------------------

export async function createStage(
  input: NewStageInput,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStageRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase.from("plan_stages").insert(input).select().single();

  if (error) return fromError(error);
  return { ok: true, data };
}

export async function updateStage(
  stageId: string,
  patch: StagePatch,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStageRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("plan_stages")
    .update(patch)
    .eq("id", stageId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

export async function deleteStage(
  stageId: string,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStageRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("plan_stages")
    .delete()
    .eq("id", stageId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

// --- plan_steps --------------------------------------------------------

export async function createStep(
  input: NewStepInput,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStepRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase.from("plan_steps").insert(input).select().single();

  if (error) return fromError(error);
  return { ok: true, data };
}

export async function updateStep(
  stepId: string,
  patch: StepPatch,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStepRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("plan_steps")
    .update(patch)
    .eq("id", stepId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

export async function deleteStep(
  stepId: string,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStepRow>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("plan_steps")
    .delete()
    .eq("id", stepId)
    .select()
    .maybeSingle();

  if (error) return fromError(error);
  if (!data) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data };
}

// --- reorder (0007) ------------------------------------------------------

/**
 * Calls 0007's `reorder_plan_stages` RPC. The function itself computes the
 * real, RLS-scoped id set server-side and raises REORDER_SET_MISMATCH
 * (SQLSTATE P0001) on any mismatch — this wrapper does no set comparison of
 * its own, only maps whatever the RPC returns.
 */
export async function reorderStages(
  planId: string,
  order: ReorderInput,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStageRow[]>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase.rpc("reorder_plan_stages", {
    p_plan_id: planId,
    p_stage_ids: order,
  });

  if (error) return fromError(error);
  return { ok: true, data: data ?? [] };
}

/** Calls 0007's `reorder_plan_steps` RPC — see reorderStages for the shape rationale. */
export async function reorderSteps(
  stageId: string,
  order: ReorderInput,
  client?: PlanWriteClient,
): Promise<PlanActionResult<PlanStepRow[]>> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase.rpc("reorder_plan_steps", {
    p_stage_id: stageId,
    p_step_ids: order,
  });

  if (error) return fromError(error);
  return { ok: true, data: data ?? [] };
}
