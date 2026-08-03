"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import type { PlanStage, SuccessPlanRow } from "@/lib/plans/types";
import { reorderStagesAction, reorderStepsAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { findLiveStepId, mergeStageOrder, mergeStepOrder, moveIndex, type ReorderDirection } from "./plan-tree-utils";
import { AddStageForm } from "./add-stage-form";
import { PlanDetailsForm } from "./plan-details-form";
import { StageRow } from "./stage-row";

interface PlanBuilderProps {
  workspaceId: string;
  plan: SuccessPlanRow;
  initialStages: PlanStage[];
}

// Orchestrates the plan tree's client-side state (Ticket 29, T29-5).
//
// `stages` is the CONFIRMED tree. Create/update/delete go through
// revalidatePath, which re-renders the Server Component and hands this
// instance a new `initialStages` prop — the effect below syncs that in.
// Reorder deliberately does NOT call revalidatePath (a full RSC round trip
// per move-up/down press would flicker), so `stages` only advances on
// reorder via the action's own returned authoritative order, merged in by
// hand below.
//
// `optimisticStages` is the tree actually rendered. useOptimistic's
// "passthrough" reducer just returns whatever value was pushed — the
// computed reordering happens in the two handlers, not in the reducer —
// and reverts to `stages` on its own once a transition settles without a
// matching `setStages` call, which is exactly the "visibly revert on
// reject" behaviour a failed reorder needs.
export function PlanBuilder({ workspaceId, plan, initialStages }: PlanBuilderProps) {
  const [stages, setStages] = useState<PlanStage[]>(initialStages);
  const [optimisticStages, setOptimisticStages] = useOptimistic<PlanStage[], PlanStage[]>(
    stages,
    (_current, next) => next,
  );
  const [isPending, startTransition] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    setStages(initialStages);
  }, [initialStages]);

  const liveStepId = findLiveStepId(optimisticStages);

  function handleMoveStage(stageId: string, direction: ReorderDirection) {
    const index = optimisticStages.findIndex((stage) => stage.id === stageId);
    if (index === -1) return;
    const reordered = moveIndex(optimisticStages, index, direction);
    if (reordered === optimisticStages) return;

    setReorderError(null);
    startTransition(async () => {
      setOptimisticStages(reordered);
      const result = await reorderStagesAction(
        plan.id,
        reordered.map((stage) => stage.id),
      );
      if (result.ok) {
        setStages((current) => mergeStageOrder(current, result.data));
      } else {
        setReorderError(describePlanError(result.code));
      }
    });
  }

  function handleMoveStep(stageId: string, stepId: string, direction: ReorderDirection) {
    const stageIndex = optimisticStages.findIndex((stage) => stage.id === stageId);
    if (stageIndex === -1) return;
    const stage = optimisticStages[stageIndex];
    const stepIndex = stage.steps.findIndex((step) => step.id === stepId);
    const reorderedSteps = moveIndex(stage.steps, stepIndex, direction);
    if (reorderedSteps === stage.steps) return;

    const nextTree = optimisticStages.map((current, index) =>
      index === stageIndex ? { ...current, steps: reorderedSteps } : current,
    );

    setReorderError(null);
    startTransition(async () => {
      setOptimisticStages(nextTree);
      const result = await reorderStepsAction(
        stageId,
        reorderedSteps.map((step) => step.id),
      );
      if (result.ok) {
        setStages((current) => mergeStepOrder(current, stageId, result.data));
      } else {
        setReorderError(describePlanError(result.code));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PlanDetailsForm workspaceId={workspaceId} plan={plan} />

      {reorderError ? (
        <p className="plan-error" role="alert">
          {reorderError}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {optimisticStages.map((stage, index) => (
          <StageRow
            key={stage.id}
            workspaceId={workspaceId}
            stage={stage}
            isFirst={index === 0}
            isLast={index === optimisticStages.length - 1}
            isPending={isPending}
            liveStepId={liveStepId}
            onMoveStageUp={() => handleMoveStage(stage.id, "up")}
            onMoveStageDown={() => handleMoveStage(stage.id, "down")}
            onMoveStep={(stepId, direction) => handleMoveStep(stage.id, stepId, direction)}
          />
        ))}
      </div>

      <AddStageForm workspaceId={workspaceId} planId={plan.id} nextDisplayOrder={stages.length} />
    </div>
  );
}
