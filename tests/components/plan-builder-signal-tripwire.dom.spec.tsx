// QA tripwire (Ticket 29, T29-9). Independent of FE's own
// plan-builder.dom.spec.tsx assertions — this file exists so a regression in
// "exactly one Signal element per page" is caught even if FE's own test is
// ever weakened or removed, and it covers the zero-live-step case FE's file
// does not.
//
// Signal marker keyed on: the `data-live="true"` attribute StepRow
// (app/admin/workspaces/[id]/plan/step-row.tsx) puts on its <article
// className="plan-step"> — the only per-render, greppable hook for "this is
// the live step" in the rendered DOM (data-live is always present, "true" or
// "false"; the inline --signal-wash/--signal gradient styles are the visual
// consequence of the SAME condition, isLive, but are not independently
// greppable without an inline style to parse).
//
// Runs under the "components" Vitest project (happy-dom) — see
// vitest.config.ts. No live server needed: this only asserts what's true of
// first-paint DOM output.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PlanStage, PlanStepRow } from "@/lib/plans/types";
import { PlanBuilder } from "@/app/admin/workspaces/[id]/plan/plan-builder";

afterEach(() => {
  cleanup();
});

function makeStep(overrides: Partial<PlanStepRow> & Pick<PlanStepRow, "id" | "label">): PlanStepRow {
  return {
    stage_id: "stage-1",
    owner_side: "seller",
    owner_name: null,
    owner_email: null,
    due_date: null,
    status: "open",
    display_order: 0,
    completed_at: null,
    completed_by_email: null,
    private_note: null,
    ...overrides,
  };
}

const PLAN = {
  id: "plan-1",
  workspace_id: "workspace-1",
  title: "Onboarding plan",
  start_date: null,
  target_date: null,
  status: "active" as const,
  created_at: "2026-01-01T00:00:00+00:00",
};

function stagesWithOpenStep(): PlanStage[] {
  return [
    {
      id: "stage-1",
      plan_id: "plan-1",
      title: "Kickoff",
      display_order: 0,
      status: "current",
      steps: [
        makeStep({ id: "step-1", label: "Send contract", status: "done" }),
        makeStep({ id: "step-2", label: "Schedule kickoff call", status: "open" }),
      ],
    },
    {
      id: "stage-2",
      plan_id: "plan-1",
      title: "Rollout",
      display_order: 1,
      status: "upcoming",
      steps: [makeStep({ id: "step-3", label: "Train the team", status: "open" })],
    },
  ];
}

function stagesWithNoOpenStep(): PlanStage[] {
  return [
    {
      id: "stage-1",
      plan_id: "plan-1",
      title: "Kickoff",
      display_order: 0,
      status: "done",
      steps: [
        makeStep({ id: "step-1", label: "Send contract", status: "done" }),
        makeStep({ id: "step-2", label: "Blocked forever", status: "blocked" }),
      ],
    },
  ];
}

/** Every element carrying the Signal marker: data-live="true". */
function signalMarkedElements(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-live="true"]'));
}

describe("Signal tripwire — at most one Signal-marked element per rendered page", () => {
  it("marks exactly one element data-live=true when the plan has an open step", () => {
    const { container } = render(
      <PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={stagesWithOpenStep()} />,
    );

    const marked = signalMarkedElements(container);
    expect(marked).toHaveLength(1);
  });

  it("marks zero elements data-live=true when no step is open (all done or blocked)", () => {
    const { container } = render(
      <PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={stagesWithNoOpenStep()} />,
    );

    const marked = signalMarkedElements(container);
    expect(marked).toHaveLength(0);
  });

  it("marks zero elements data-live=true when the plan has no stages at all", () => {
    const { container } = render(<PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={[]} />);

    const marked = signalMarkedElements(container);
    expect(marked).toHaveLength(0);
  });
});
