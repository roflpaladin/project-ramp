"use client";

import { useActionState } from "react";
import { createStageAction } from "./plan-actions";
import { describePlanError } from "./error-messages";

interface AddStageFormProps {
  workspaceId: string;
  planId: string;
  nextDisplayOrder: number;
}

interface FormState {
  error: string | null;
}

const INITIAL_STATE: FormState = { error: null };

export function AddStageForm({ workspaceId, planId, nextDisplayOrder }: AddStageFormProps) {
  async function action(_previous: FormState, formData: FormData): Promise<FormState> {
    const result = await createStageAction(workspaceId, planId, formData);
    if (!result.ok) return { error: describePlanError(result.code) };
    return { error: null };
  }

  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="plan-stage flex flex-col gap-3">
      <h2 className="m-0 text-base font-semibold">Add a stage</h2>
      <label className="plan-field">
        Stage title
        <input className="plan-input" type="text" name="title" required placeholder="e.g. Kickoff" />
      </label>
      <input type="hidden" name="display_order" defaultValue={nextDisplayOrder} key={nextDisplayOrder} />

      {state.error ? (
        <p className="plan-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="plan-btn" disabled={isPending} style={{ width: "fit-content" }}>
        Add stage
      </button>
    </form>
  );
}
