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

import { ensurePlanIsOpen, isClosedPlanStatus, type ClosedPlanStatus } from "@/lib/plans/closed-plans";
import { goLivePlan } from "@/lib/plans/go-live";
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

/**
 * T60. Going live and closing a deal both change what the WORKSPACE page
 * shows (its activation checklist, its deal-limit notice), not just the plan
 * page — so those two actions refresh both. Ordinary title/step edits still
 * refresh only the plan page, as before.
 *
 * Takes the workspace id off the ROW the write returned, never the action's
 * own argument: the row is server-derived, the argument came from a URL.
 * They agree in every real flow, and preferring the row costs nothing.
 *
 * (Both actions keep their `workspaceId` parameter even though they no
 * longer read it — it is part of the bound-action signature the UI already
 * uses, `markPlanLiveAction.bind(null, workspaceId, planId)`.)
 */
function revalidateDealPaths(workspaceId: string): void {
  revalidatePath(planPath(workspaceId));
  revalidatePath(`/admin/workspaces/${workspaceId}`);
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

  // T60: `status` is not a field this form may set — at all. It used to be
  // (any legal PlanStatus was accepted here), which meant a crafted form
  // field could make a plan live without ever meeting the active-deal limit.
  // Going live is markPlanLiveAction; closing is closePlanAction.
  if (formData.has("status")) return { ok: false, code: "VALIDATION_ERROR" };

  const gate = await ensurePlanIsOpen(session.client, { planId });
  if (!gate.ok) return gate;

  const patch: PlanPatch = {
    title: patchStringField(formData, "title") ?? undefined,
    start_date: patchStringField(formData, "start_date"),
    target_date: patchStringField(formData, "target_date"),
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

  const gate = await ensurePlanIsOpen(session.client, { planId });
  if (!gate.ok) return gate;

  const result = await deletePlan(planId, session.client);
  if (result.ok) revalidatePath(planPath(workspaceId));
  return result;
}

/**
 * Sprint 12, Ticket 60 — "close deal". Won and lost behave identically
 * (founder ruling, 2026-09-21): the plan keeps every row it had, the seller
 * keeps seeing it read-only with its outcome, and the tenant gets their
 * active-deal seat back. 0005's unique index covers draft+active only, so a
 * closed plan also leaves the workspace free for a new one.
 *
 * `outcome` is a bound argument, not a FormData field, for the same reason
 * `workspaceId` is throughout this file — and it is re-validated here anyway,
 * because a client component can send anything.
 */
export async function closePlanAction(
  workspaceId: string,
  planId: string,
  outcome: ClosedPlanStatus,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  if (!isClosedPlanStatus(outcome)) return { ok: false, code: "VALIDATION_ERROR" };

  // Closing an already-closed deal is refused rather than treated as a no-op:
  // it would otherwise silently rewrite a Won deal as Lost.
  const gate = await ensurePlanIsOpen(session.client, { planId });
  if (!gate.ok) return gate;

  const result = await updatePlan(planId, { status: outcome }, session.client);
  if (result.ok) revalidateDealPaths(result.data.workspace_id);
  return result;
}

/**
 * Sprint 11, Ticket 58 — the onboarding checklist's "make it live" button.
 * Sprint 12, Ticket 60 — and now the one place the active-deal limit is
 * applied.
 *
 * It no longer writes `status: 'active'` through the ordinary patch path:
 * that path cannot count anything, and two tabs could both pass a check made
 * in application code. The whole decision (billing state, the tier's cap, the
 * locked count, the write) lives in lib/plans/go-live.ts and 0015's
 * mark_plan_live(); this stays what every other action here is — requireSeller,
 * delegate, revalidate.
 *
 * The signature is unchanged, so `markPlanLiveAction.bind(null, workspaceId,
 * planId)` still works exactly as T58 wired it.
 */
export async function markPlanLiveAction(
  workspaceId: string,
  planId: string,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const result = await goLivePlan(session, planId);
  if (result.ok) revalidateDealPaths(result.data.workspace_id);
  return result;
}

// --- stages ------------------------------------------------------------
//
// T60: every stage and step mutation resolves its owning plan through
// ensurePlanIsOpen() before it writes. A closed deal (won/lost) stays fully
// visible to the seller, so "read-only" has to be a server rule — hidden
// buttons are not a boundary. One extra round trip per mutation, accepted
// deliberately (see lib/plans/closed-plans.ts for the alternative).

export async function createStageAction(
  workspaceId: string,
  planId: string,
  formData: FormData,
): Promise<PlanActionResult<PlanStageRow>> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const gate = await ensurePlanIsOpen(session.client, { planId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stageId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stageId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stageId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stepId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stepId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { planId });
  if (!gate.ok) return gate;

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

  const gate = await ensurePlanIsOpen(session.client, { stageId });
  if (!gate.ok) return gate;

  const validated = validateReorderInput(order);
  if (!validated.ok) return validated;

  return reorderSteps(stageId, validated.data, session.client);
}
