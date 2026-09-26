"use client";

import { useActionState, type RefObject } from "react";
import type { SuccessPlanRow } from "@/lib/plans/types";
import { updatePlanAction } from "./plan-actions";
import { describePlanError } from "./error-messages";
import { StatusBadge, planStatusMeta } from "./status-badge";

interface PlanDetailsFormProps {
  workspaceId: string;
  plan: SuccessPlanRow;
  /** T60: a closed deal. The header stays; the editable fields and Save do not. */
  isReadOnly?: boolean;
  /**
   * T60 HIGH fix. The plan title heading renders in BOTH modes
   * (PlanHeader, below) — the one element on this page proven to survive a
   * close (isReadOnly flipping true unmounts everything else in
   * plan-builder.tsx's "Close this deal" fragment). plan-builder.tsx uses
   * this to give the h1 a stable, tabIndex={-1} focus target so a
   * successful close can hand focus there instead of dropping it to <body>.
   */
  headingRef?: RefObject<HTMLHeadingElement | null>;
}

interface FormState {
  error: string | null;
}

const INITIAL_STATE: FormState = { error: null };

const DATE_FALLBACK = "—";

/** Shared by PlanHeader and ReadOnlyPlanDetails below — both need the plan and the T60 focus-target ref. */
interface PlanHeaderProps {
  readonly plan: SuccessPlanRow;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

/** Title + outcome badge — identical in both modes, so it is written once. */
function PlanHeader({ plan, headingRef }: PlanHeaderProps) {
  const meta = planStatusMeta(plan.status);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* tabIndex={-1}: not a tab stop, only a programmatic focus target
          (T60 HIGH fix — see this file's PlanDetailsFormProps.headingRef). */}
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-2xl font-semibold tracking-tight">
        {plan.title}
      </h1>
      <StatusBadge tone={meta.tone} label={meta.label} />
    </div>
  );
}

/** Dates in Geist Mono (design system MUST: data and numbers). */
function ReadOnlyPlanDetails({ plan, headingRef }: PlanHeaderProps) {
  return (
    <section className="plan-stage flex flex-col gap-4" aria-label={plan.title}>
      <PlanHeader plan={plan} headingRef={headingRef} />
      <p className="plan-step-meta">
        <span>Start {plan.start_date ?? DATE_FALLBACK}</span>
        <span>Target {plan.target_date ?? DATE_FALLBACK}</span>
      </p>
    </section>
  );
}

export function PlanDetailsForm({ workspaceId, plan, isReadOnly = false, headingRef }: PlanDetailsFormProps) {
  async function action(_previous: FormState, formData: FormData): Promise<FormState> {
    const result = await updatePlanAction(workspaceId, plan.id, formData);
    if (!result.ok) return { error: describePlanError(result.code) };
    return { error: null };
  }

  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  // After every hook, never before: hook order must not change between renders.
  if (isReadOnly) return <ReadOnlyPlanDetails plan={plan} headingRef={headingRef} />;

  return (
    <form action={formAction} className="plan-stage flex flex-col gap-4">
      <PlanHeader plan={plan} headingRef={headingRef} />

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
