"use client";

import { useActionState } from "react";
import { createPlanAction } from "./plan-actions";
import { describePlanError } from "./error-messages";

interface CreatePlanFormProps {
  workspaceId: string;
  companyName: string;
  /**
   * T60. 1 (the default) when this form IS the page — a workspace with no
   * plan at all. 2 when it sits underneath a closed deal's read-only plan,
   * which already owns the page's h1. Same form, same copy, one heading
   * level: a second h1 on the page would leave a screen-reader user with two
   * competing answers to "what is this page?".
   */
  headingLevel?: 1 | 2;
}

interface FormState {
  error: string | null;
}

const INITIAL_STATE: FormState = { error: null };

export function CreatePlanForm({ workspaceId, companyName, headingLevel = 1 }: CreatePlanFormProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  async function action(_previous: FormState, formData: FormData): Promise<FormState> {
    const result = await createPlanAction(workspaceId, formData);
    if (!result.ok) return { error: describePlanError(result.code) };
    return { error: null };
  }

  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="plan-stage flex flex-col gap-3">
      <Heading className="m-0 text-2xl font-semibold tracking-tight">Start a success plan</Heading>
      <p className="m-0 text-sm" style={{ color: "var(--slate)" }}>
        {companyName} has no open plan right now. Give it a title to start building stages and steps.
      </p>
      <label className="plan-field">
        Plan title
        <input className="plan-input" type="text" name="title" required placeholder="e.g. Onboarding plan" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="plan-field">
          Start date
          <input className="plan-input" type="date" name="start_date" />
        </label>
        <label className="plan-field">
          Target date
          <input className="plan-input" type="date" name="target_date" />
        </label>
      </div>

      {state.error ? (
        <p className="plan-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="plan-btn" disabled={isPending} style={{ width: "fit-content" }}>
        Create plan
      </button>
    </form>
  );
}
