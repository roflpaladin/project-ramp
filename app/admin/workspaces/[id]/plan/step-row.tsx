"use client";

import { useState, type CSSProperties } from "react";
import type { PlanStepRow, StepStatus } from "@/lib/plans/types";
import { deleteStepAction, updateStepAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { MoveButtons } from "./move-buttons";
import { OwnerToggle } from "./owner-toggle";
import { StatusBadge, stepStatusMeta } from "./status-badge";

// 'done' is deliberately excluded: lib/plans/validate.ts's write boundary
// only ever accepts 'open' | 'blocked' here — completion is a separate
// endpoint (Ticket 35), not this form.
const STEP_STATUSES_ON_WRITE: readonly Exclude<StepStatus, "done">[] = ["open", "blocked"];

interface StepRowProps {
  workspaceId: string;
  step: PlanStepRow;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
  isLive: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function StepRow({ workspaceId, step, isFirst, isLast, isPending, isLive, onMoveUp, onMoveDown }: StepRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = stepStatusMeta(step.status);

  const updateStepForThisStep = updateStepAction.bind(null, workspaceId, step.id);
  const deleteStepForThisStep = deleteStepAction.bind(null, workspaceId, step.id);

  async function handleUpdate(formData: FormData) {
    const result = await updateStepForThisStep(formData);
    if (!result.ok) {
      setError(describePlanError(result.code));
      return;
    }
    setError(null);
    setIsEditing(false);
  }

  async function handleDelete() {
    const result = await deleteStepForThisStep();
    if (!result.ok) setError(describePlanError(result.code));
  }

  // The live step's wash + rail gradient are the page's ONE Signal element
  // (design system MUST). Set inline (not via an external stylesheet
  // selector) so the contract is provable directly on the rendered DOM.
  const railStyle: CSSProperties = {
    background: isLive
      ? "linear-gradient(180deg, var(--signal), var(--signal-hover))"
      : step.owner_side === "seller"
        ? "var(--seller-marker)"
        : "var(--buyer-marker)",
  };
  const rowStyle: CSSProperties | undefined = isLive ? { backgroundColor: "var(--signal-wash)" } : undefined;

  return (
    <article className="plan-step" data-owner={step.owner_side} data-live={isLive} style={rowStyle}>
      <span aria-hidden="true" className="plan-step-rail" style={railStyle} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h3 className="plan-step-title">{step.label}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={meta.tone} label={meta.label} />
            <span className="plan-owner-chip" data-side={step.owner_side}>
              {step.owner_side === "seller" ? "Seller" : "Buyer"}
            </span>
          </div>
          <p className="plan-step-meta">
            {step.owner_name ? <span>{step.owner_name}</span> : null}
            <span>{step.due_date ? `Due ${step.due_date}` : "No due date"}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <MoveButtons
            itemLabel={step.label}
            isFirst={isFirst}
            isLast={isLast}
            isPending={isPending}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
          <button type="button" className="plan-btn" onClick={() => setIsEditing((current) => !current)}>
            {isEditing ? "Cancel" : "Edit"}
          </button>
          <form action={handleDelete}>
            <button type="submit" className="plan-btn">
              Delete
            </button>
          </form>
        </div>
      </div>

      {isEditing ? (
        <form action={handleUpdate} className="flex flex-col gap-3">
          <label className="plan-field">
            Step
            <input className="plan-input" type="text" name="label" defaultValue={step.label} required />
          </label>
          <div className="plan-field">
            Owner
            <OwnerToggle name="owner_side" defaultValue={step.owner_side} idPrefix={`edit-step-${step.id}`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="plan-field">
              Owner name
              <input className="plan-input" type="text" name="owner_name" defaultValue={step.owner_name ?? ""} />
            </label>
            <label className="plan-field">
              Owner email
              <input className="plan-input" type="email" name="owner_email" defaultValue={step.owner_email ?? ""} />
            </label>
            <label className="plan-field">
              Due date
              <input className="plan-input" type="date" name="due_date" defaultValue={step.due_date ?? ""} />
            </label>
            {step.status === "done" ? null : (
              <label className="plan-field">
                Status
                <select className="plan-select" name="status" defaultValue={step.status}>
                  {STEP_STATUSES_ON_WRITE.map((status) => (
                    <option key={status} value={status}>
                      {stepStatusMeta(status).label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="plan-field">
            Private note
            <textarea className="plan-textarea" name="private_note" defaultValue={step.private_note ?? ""} rows={2} />
          </label>
          <button type="submit" className="plan-btn" style={{ width: "fit-content" }}>
            Save step
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="plan-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
