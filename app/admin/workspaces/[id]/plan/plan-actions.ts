"use server";

// T28-10 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). All plan CRUD
// plus reorder for the builder page. `workspaceId` is always a BOUND
// argument (mirrors app/admin/workspaces/[id]/links-actions.ts's
// `addLink(workspaceId, formData)` pattern) — never read from FormData, so a
// tampered form field can never retarget a mutation at a workspace the
// caller didn't navigate to.
//
// `requireSeller()` is the first call in every exported function. `null` ->
// `{ ok: false, code: "UNAUTHENTICATED" }`, per T28-10's spec — never a
// redirect or a thrown error, so every action here returns the same
// PlanActionResult<T> shape regardless of which layer rejected it.
//
// Mutation ACs are a result union, not HTTP status codes (Server Actions
// can't speak HTTP) — status codes remain the GET route's contract only
// (Notion amendment, plans/sprint-6-7-replan.md §10).

import { revalidatePath } from "next/cache";

import type {
  NewPlanInput,
  NewStageInput,
  NewStepInput,
  PlanActionResult,
  PlanPatch,
  ReorderInput,
  StagePatch,
  StepPatch,
} from "@/lib/plans/mutations";
import { requireSeller } from "@/lib/plans/require-seller";
import type { PlanStageRow, PlanStepRow, SuccessPlanRow } from "@/lib/plans/types";
import {
  validateNewPlanInput,
  validateNewStageInput,
  validateNewStepInput,
  validatePlanPatch,
  validateReorderInput,
  validateStagePatch,
  validateStepPatch,
} from "@/lib/plans/validate";
import {
  createPlan,
  createStage,
  createStep,
  deletePlan,
  deleteStage,
  deleteStep,
  reorderStages,
  reorderSteps,
  updatePlan,
  updateStage,
  updateStep,
} from "@/lib/plans/write";

function planPath(workspaceId: string): string {
  return `/admin/workspaces/${workspaceId}/plan`;
}

/** `undefined` (field absent) means "no change" on a patch; `""` means "clear to null". */
function patchStringField(formData: FormData, key: string): string | null | undefined {
  if (!formData.has(key)) return undefined;
  const trimmed = String(formData.get(key) ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function patchNumberField(formData: FormData, key: string): number | undefined {
  if (!formData.has(key)) return undefined;
  const raw = String(formData.get(key) ?? "").trim();
  return raw === "" ? undefined : Number(raw);
}

// --- plans -----------------------------------------------------------------

export async function createPlanAction(
  workspaceId: string,
  formData: FormData,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const input: NewPlanInput = {
    workspace_id: workspaceId,
    title: String(formData.get("title") ?? "").trim(),
    start_date: patchStringField(formData, "start_date") ?? null,
    target_date: patchStringField(formData, "target_date") ?? null,
  };

  const validated = validateNewPlanInput(input);
  if (!validated.ok) return validated;

  const result = await createPlan(validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function updatePlanAction(
  workspaceId: string,
  planId: string,
  formData: FormData,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const patch: PlanPatch = {
    title: patchStringField(formData, "title") ?? undefined,
    start_date: patchStringField(formData, "start_date"),
    target_date: patchStringField(formData, "target_date"),
    status: (patchStringField(formData, "status") ?? undefined) as PlanPatch["status"],
  };

  const validated = validatePlanPatch(patch);
  if (!validated.ok) return validated;

  const result = await updatePlan(planId, validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function deletePlanAction(
  workspaceId: string,
  planId: string,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const result = await deletePlan(planId, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

/**
 * Sprint 11, Ticket 58 — "In-App Onboarding Checklist"'s "plan live" step
 * needs a way to flip a plan's status to 'active' without a full patch form.
 * A minimal, explicit wrapper around the same validate -> write -> revalidate
 * path updatePlanAction already takes for a `status` patch — status: 'active'
 * is already a legal PlanPatch value there (validatePlanPatch checks it
 * against PLAN_STATUSES), so this adds no new write behaviour, only a
 * narrower, button-bindable entry point (`markPlanLiveAction.bind(null,
 * workspaceId, planId)`) that never needs a FormData at all.
 */
export async function markPlanLiveAction(
  workspaceId: string,
  planId: string,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const validated = validatePlanPatch({ status: "active" });
  if (!validated.ok) return validated;

  const result = await updatePlan(planId, validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

// --- stages ------------------------------------------------------------

export async function createStageAction(
  workspaceId: string,
  planId: string,
  formData: FormData,
): Promise<PlanActionResult<PlanStageRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const input: NewStageInput = {
    plan_id: planId,
    title: String(formData.get("title") ?? "").trim(),
    display_order: patchNumberField(formData, "display_order"),
  };

  const validated = validateNewStageInput(input);
  if (!validated.ok) return validated;

  const result = await createStage(validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function updateStageAction(
  workspaceId: string,
  stageId: string,
  formData: FormData,
): Promise<PlanActionResult<PlanStageRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const patch: StagePatch = {
    title: patchStringField(formData, "title") ?? undefined,
    display_order: patchNumberField(formData, "display_order"),
    status: (patchStringField(formData, "status") ?? undefined) as StagePatch["status"],
  };

  const validated = validateStagePatch(patch);
  if (!validated.ok) return validated;

  const result = await updateStage(stageId, validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function deleteStageAction(
  workspaceId: string,
  stageId: string,
): Promise<PlanActionResult<PlanStageRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const result = await deleteStage(stageId, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

// --- steps ---------------------------------------------------------------

export async function createStepAction(
  workspaceId: string,
  stageId: string,
  formData: FormData,
): Promise<PlanActionResult<PlanStepRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const input: NewStepInput = {
    stage_id: stageId,
    label: String(formData.get("label") ?? "").trim(),
    owner_side: String(formData.get("owner_side") ?? "") as NewStepInput["owner_side"],
    owner_name: patchStringField(formData, "owner_name") ?? null,
    owner_email: patchStringField(formData, "owner_email") ?? null,
    due_date: patchStringField(formData, "due_date") ?? null,
    private_note: patchStringField(formData, "private_note") ?? null,
    display_order: patchNumberField(formData, "display_order"),
  };

  const validated = validateNewStepInput(input);
  if (!validated.ok) return validated;

  const result = await createStep(validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function updateStepAction(
  workspaceId: string,
  stepId: string,
  formData: FormData,
): Promise<PlanActionResult<PlanStepRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const patch: StepPatch = {
    label: patchStringField(formData, "label") ?? undefined,
    owner_side: (patchStringField(formData, "owner_side") ?? undefined) as StepPatch["owner_side"],
    owner_name: patchStringField(formData, "owner_name"),
    owner_email: patchStringField(formData, "owner_email"),
    due_date: patchStringField(formData, "due_date"),
    private_note: patchStringField(formData, "private_note"),
    display_order: patchNumberField(formData, "display_order"),
    status: (patchStringField(formData, "status") ?? undefined) as StepPatch["status"],
  };

  const validated = validateStepPatch(patch);
  if (!validated.ok) return validated;

  const result = await updateStep(stepId, validated.data, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

export async function deleteStepAction(
  workspaceId: string,
  stepId: string,
): Promise<PlanActionResult<PlanStepRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const result = await deleteStep(stepId, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

// --- reorder -------------------------------------------------------------
//
// No revalidatePath here (Notion amendment / Ticket 29's T29-5): a full RSC
// round trip per move-up/move-down press would produce flicker
// indistinguishable from the "revert visibly on reject" behaviour the AC
// demands. The FE reconciles from this action's own returned authoritative
// ordered set via useOptimistic instead.

export async function reorderStagesAction(
  planId: string,
  order: ReorderInput,
): Promise<PlanActionResult<PlanStageRow[]>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const validated = validateReorderInput(order);
  if (!validated.ok) return validated;

  return reorderStages(planId, validated.data, session.client);
}

export async function reorderStepsAction(
  stageId: string,
  order: ReorderInput,
): Promise<PlanActionResult<PlanStepRow[]>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const validated = validateReorderInput(order);
  if (!validated.ok) return validated;

  return reorderSteps(stageId, validated.data, session.client);
}
