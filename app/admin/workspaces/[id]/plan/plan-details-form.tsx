"use client";

import { useActionState } from "react";
import type { SuccessPlanRow } from "@/lib/plans/types";
import { updatePlanAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { StatusBadge, planStatusMeta } from "./status-badge";

interface PlanDetailsFormProps {
  workspaceId: string;
  plan: SuccessPlanRow;
}

interface FormState {
  error: string | null;
}

const INITIAL_STATE: FormState = { error: null };

export function PlanDetailsForm({ workspaceId, plan }: PlanDetailsFormProps) {
  const meta = planStatusMeta(plan.status);

  async function action(_previous: FormState, formData: FormData): Promise<FormState> {
    const result = await updatePlanAction(workspaceId, plan.id, formData);
    if (!result.ok) return { error: describePlanError(result.code) };
    return { error: null };
  }

  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="plan-stage flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{plan.title}</h1>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="plan-field">
          Plan title
          <input className="plan-input" type="text" name="title" defaultValue={plan.title} required />
        </label>
        <label className="plan-field">
          Start date
          <input className="plan-input" type="date" name="start_date" defaultValue={plan.start_date ?? ""} />
        </label>
        <label className="plan-field">
          Target date
          <input className="plan-input" type="date" name="target_date" defaultValue={plan.target_date ?? ""} />
        </label>
      </div>

      {state.error ? (
        <p className="plan-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="plan-btn" disabled={isPending} style={{ width: "fit-content" }}>
        Save plan details
      </button>
    </form>
  );
}
