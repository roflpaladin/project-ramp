"use client";

import { useActionState } from "react";
import { createStepAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { OwnerToggle } from "./owner-toggle";

interface AddStepFormProps {
  workspaceId: string;
  stageId: string;
  nextDisplayOrder: number;
}

interface FormState {
  error: string | null;
}

const INITIAL_STATE: FormState = { error: null };

export function AddStepForm({ workspaceId, stageId, nextDisplayOrder }: AddStepFormProps) {
  async function action(_previous: FormState, formData: FormData): Promise<FormState> {
    const result = await createStepAction(workspaceId, stageId, formData);
    if (!result.ok) return { error: describePlanError(result.code) };
    return { error: null };
  }

  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <details className="plan-add-step">
      <summary className="plan-btn" style={{ width: "fit-content" }}>
        Add a step
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <label className="plan-field">
          Step
          <input className="plan-input" type="text" name="label" required placeholder="e.g. Send onboarding kit" />
        </label>
        <div className="plan-field">
          Owner
          <OwnerToggle name="owner_side" defaultValue="seller" idPrefix={`new-step-${stageId}`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="plan-field">
            Owner name
            <input className="plan-input" type="text" name="owner_name" />
          </label>
          <label className="plan-field">
            Due date
            <input className="plan-input" type="date" name="due_date" />
          </label>
        </div>
        <input type="hidden" name="display_order" defaultValue={nextDisplayOrder} key={nextDisplayOrder} />

        {state.error ? (
          <p className="plan-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <button type="submit" className="plan-btn" disabled={isPending} style={{ width: "fit-content" }}>
          Add step
        </button>
      </form>
    </details>
  );
}
