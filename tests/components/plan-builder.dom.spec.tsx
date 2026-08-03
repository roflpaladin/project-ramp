// Component-level DOM assertions for the plan builder (Ticket 29, T29-7).
// Runs under the "components" Vitest project (happy-dom env) — see
// vitest.config.ts. Playwright interaction specs (actually clicking
// move-up/down and watching a real reorder happen) are QA's T29-8; this
// file only asserts what's true of the rendered DOM on first paint, so it
// never invokes a real server action (those need next/headers' request
// scope and a live Supabase session, neither of which exist here).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type { PlanStage, PlanStepRow } from "@/lib/plans/types";
import { PlanBuilder } from "@/app/admin/workspaces/[id]/plan/plan-builder";
import { StepRow } from "@/app/admin/workspaces/[id]/plan/step-row";

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

const STAGES: PlanStage[] = [
  {
    id: "stage-1",
    plan_id: "plan-1",
    title: "Kickoff",
    display_order: 0,
    status: "current",
    steps: [
      makeStep({ id: "step-1", label: "Send contract", status: "done" }),
      makeStep({ id: "step-2", label: "Schedule kickoff call", status: "open" }),
      makeStep({ id: "step-3", label: "Share onboarding kit", status: "open", owner_side: "buyer" }),
    ],
  },
  {
    id: "stage-2",
    plan_id: "plan-1",
    title: "Rollout",
    display_order: 1,
    status: "upcoming",
    steps: [makeStep({ id: "step-4", label: "Train the team", status: "open" })],
  },
];

/** Every element in `container` whose inline style references the Signal family of tokens. */
function elementsReferencingSignal(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll<HTMLElement>("*")).filter((element) =>
    /--signal/i.test(element.getAttribute("style") ?? ""),
  );
}

describe("PlanBuilder — live step is the page's only Signal element", () => {
  it("marks exactly one step as live, and only that step's subtree references --signal", () => {
    const { container } = render(<PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={STAGES} />);

    const liveSteps = container.querySelectorAll('[data-live="true"]');
    expect(liveSteps).toHaveLength(1);
    // "Schedule kickoff call" is the first 'open' step in plan order —
    // "Send contract" is done, so it's skipped.
    expect(within(liveSteps[0] as HTMLElement).getByText("Schedule kickoff call")).toBeTruthy();

    const signalElements = elementsReferencingSignal(container);
    // Every element that touches --signal must be inside (or be) the one
    // live step's subtree — never a button, badge, or any other row.
    for (const element of signalElements) {
      expect(liveSteps[0].contains(element) || liveSteps[0] === element).toBe(true);
    }
    expect(signalElements.length).toBeGreaterThan(0);
  });

  it("renders no primary/amber button anywhere on the page", () => {
    const { container } = render(<PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={STAGES} />);

    for (const button of Array.from(container.querySelectorAll("button"))) {
      expect(/--signal/i.test(button.getAttribute("style") ?? "")).toBe(false);
    }
  });
});

describe("StepRow — status is a dot plus a text label, never colour alone", () => {
  it("renders a coloured dot immediately followed by a non-empty text label", () => {
    const step = makeStep({ id: "step-1", label: "Share onboarding kit", status: "blocked" });

    render(
      <StepRow
        workspaceId="workspace-1"
        step={step}
        isFirst
        isLast
        isPending={false}
        isLive={false}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
      />,
    );

    const badge = document.querySelector(".plan-status-badge") as HTMLElement;
    expect(badge).toBeTruthy();

    const dot = badge.querySelector(".plan-status-dot") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.getAttribute("style")).toContain("background-color");

    const label = badge.textContent?.replace(/\s+/g, " ").trim();
    expect(label).toBe("Blocked");
  });
});

describe("StepRow — move buttons respect list boundaries", () => {
  it("disables move up on the first step and move down on the last step", () => {
    const first = makeStep({ id: "step-1", label: "First step" });
    const last = makeStep({ id: "step-2", label: "Last step" });

    const { rerender } = render(
      <StepRow
        workspaceId="workspace-1"
        step={first}
        isFirst
        isLast={false}
        isPending={false}
        isLive={false}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
      />,
    );

    expect(document.querySelector('button[aria-label="Move \'First step\' up"]')).toBeDisabled();
    expect(document.querySelector('button[aria-label="Move \'First step\' down"]')).not.toBeDisabled();

    rerender(
      <StepRow
        workspaceId="workspace-1"
        step={last}
        isFirst={false}
        isLast
        isPending={false}
        isLive={false}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
      />,
    );

    expect(document.querySelector('button[aria-label="Move \'Last step\' up"]')).not.toBeDisabled();
    expect(document.querySelector('button[aria-label="Move \'Last step\' down"]')).toBeDisabled();
  });
});

describe("PlanBuilder — stage move buttons respect list boundaries", () => {
  it("disables the first stage's move-up and the last stage's move-down", () => {
    const { container } = render(<PlanBuilder workspaceId="workspace-1" plan={PLAN} initialStages={STAGES} />);

    const firstStageUp = container.querySelector('button[aria-label="Move \'Kickoff\' up"]');
    const lastStageDown = container.querySelector('button[aria-label="Move \'Rollout\' down"]');

    expect(firstStageUp).toBeDisabled();
    expect(lastStageDown).toBeDisabled();
  });
});
