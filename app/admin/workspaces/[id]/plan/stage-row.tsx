"use client";

import { useState } from "react";
import type { PlanStage, StageStatus } from "@/lib/plans/types";
import { deleteStageAction, updateStageAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { AddStepForm } from "./add-step-form";
import { MoveButtons } from "./move-buttons";
import { StatusBadge, stageStatusMeta } from "./status-badge";
import { StepRow } from "./step-row";

const STAGE_STATUSES: readonly StageStatus[] = ["upcoming", "current", "done"];

interface StageRowProps {
  workspaceId: string;
  stage: PlanStage;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
  liveStepId: string | null;
  onMoveStageUp: () => void;
  onMoveStageDown: () => void;
  onMoveStep: (stepId: string, direction: "up" | "down") => void;
}

export function StageRow({
  workspaceId,
  stage,
  isFirst,
  isLast,
  isPending,
  liveStepId,
  onMoveStageUp,
  onMoveStageDown,
  onMoveStep,
}: StageRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = stageStatusMeta(stage.status);

  const updateStageForThisStage = updateStageAction.bind(null, workspaceId, stage.id);
  const deleteStageForThisStage = deleteStageAction.bind(null, workspaceId, stage.id);

  async function handleUpdate(formData: FormData) {
    const result = await updateStageForThisStage(formData);
    if (!result.ok) {
      setError(describePlanError(result.code));
      return;
    }
    setError(null);
    setIsEditing(false);
  }

  async function handleDelete() {
    const result = await deleteStageForThisStage();
    if (!result.ok) setError(describePlanError(result.code));
  }

  return (
    <section className="plan-stage" aria-label={stage.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-lg font-semibold">{stage.title}</h2>
          <StatusBadge tone={meta.tone} label={meta.label} />
        </div>
        <div className="flex items-center gap-2">
          <MoveButtons
            itemLabel={stage.title}
            isFirst={isFirst}
            isLast={isLast}
            isPending={isPending}
            onMoveUp={onMoveStageUp}
            onMoveDown={onMoveStageDown}
          />
          <button type="button" className="plan-btn" onClick={() => setIsEditing((current) => !current)}>
            {isEditing ? "Cancel" : "Edit"}
          </button>
          <form action={handleDelete}>
            <button type="submit" className="plan-btn">
              Delete stage
            </button>
          </form>
        </div>
      </div>

      {isEditing ? (
        <form action={handleUpdate} className="flex flex-col gap-3">
          <label className="plan-field">
            Stage title
            <input className="plan-input" type="text" name="title" defaultValue={stage.title} required />
          </label>
          <label className="plan-field">
            Status
            <select className="plan-select" name="status" defaultValue={stage.status}>
              {STAGE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {stageStatusMeta(status).label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="plan-btn" style={{ width: "fit-content" }}>
            Save stage
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="plan-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {stage.steps.map((step, index) => (
          <StepRow
            key={step.id}
            workspaceId={workspaceId}
            step={step}
            isFirst={index === 0}
            isLast={index === stage.steps.length - 1}
            isPending={isPending}
            isLive={step.id === liveStepId}
            onMoveUp={() => onMoveStep(step.id, "up")}
            onMoveDown={() => onMoveStep(step.id, "down")}
          />
        ))}
      </div>

      <AddStepForm workspaceId={workspaceId} stageId={stage.id} nextDisplayOrder={stage.steps.length} />
    </section>
  );
}
