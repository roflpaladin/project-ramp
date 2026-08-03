// Pure-logic coverage for the plan builder's reorder/live-step helpers
// (Ticket 29, T29-7). No DOM is actually needed for these assertions — the
// .tsx extension (rather than .spec.ts) is deliberate anyway, so this file
// can never be swept up by the "security" project's tests/**/*.spec.ts
// glob even by accident.

import { describe, expect, it } from "vitest";
import type { PlanStage, PlanStageRow, PlanStepRow } from "@/lib/plans/types";
import { findLiveStepId, mergeStageOrder, mergeStepOrder, moveIndex } from "@/app/admin/workspaces/[id]/plan/plan-tree-utils";

function makeStep(overrides: Partial<PlanStepRow> & Pick<PlanStepRow, "id">): PlanStepRow {
  return {
    stage_id: "stage-1",
    label: "A step",
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

function makeStage(overrides: Partial<PlanStage> & Pick<PlanStage, "id">): PlanStage {
  return {
    plan_id: "plan-1",
    title: "A stage",
    display_order: 0,
    status: "upcoming",
    steps: [],
    ...overrides,
  };
}

describe("moveIndex", () => {
  it("swaps an item with its previous neighbour when moving up", () => {
    const items = ["a", "b", "c"];

    const result = moveIndex(items, 1, "up");

    expect(result).toEqual(["b", "a", "c"]);
  });

  it("swaps an item with its next neighbour when moving down", () => {
    const items = ["a", "b", "c"];

    const result = moveIndex(items, 1, "down");

    expect(result).toEqual(["a", "c", "b"]);
  });

  it("returns the same array reference when moving the first item up", () => {
    const items = ["a", "b", "c"];

    const result = moveIndex(items, 0, "up");

    expect(result).toBe(items);
  });

  it("returns the same array reference when moving the last item down", () => {
    const items = ["a", "b", "c"];

    const result = moveIndex(items, 2, "down");

    expect(result).toBe(items);
  });

  it("does not mutate the input array", () => {
    const items = ["a", "b", "c"];

    moveIndex(items, 1, "up");

    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("mergeStageOrder", () => {
  it("reorders stages to the authoritative order while keeping each stage's own steps", () => {
    const stepsForOne: PlanStepRow[] = [makeStep({ id: "step-1" })];
    const stepsForTwo: PlanStepRow[] = [makeStep({ id: "step-2" })];
    const current: PlanStage[] = [
      makeStage({ id: "stage-1", title: "First", steps: stepsForOne }),
      makeStage({ id: "stage-2", title: "Second", steps: stepsForTwo }),
    ];
    const authoritative: PlanStageRow[] = [
      { id: "stage-2", plan_id: "plan-1", title: "Second", display_order: 0, status: "upcoming" },
      { id: "stage-1", plan_id: "plan-1", title: "First", display_order: 1, status: "upcoming" },
    ];

    const result = mergeStageOrder(current, authoritative);

    expect(result.map((stage) => stage.id)).toEqual(["stage-2", "stage-1"]);
    expect(result[0].steps).toBe(stepsForTwo);
    expect(result[1].steps).toBe(stepsForOne);
  });
});

describe("mergeStepOrder", () => {
  it("replaces only the targeted stage's steps with the authoritative order", () => {
    const current: PlanStage[] = [
      makeStage({ id: "stage-1", steps: [makeStep({ id: "step-1" }), makeStep({ id: "step-2" })] }),
      makeStage({ id: "stage-2", steps: [makeStep({ id: "step-3" })] }),
    ];
    const authoritative: PlanStepRow[] = [makeStep({ id: "step-2" }), makeStep({ id: "step-1" })];

    const result = mergeStepOrder(current, "stage-1", authoritative);

    expect(result[0].steps.map((step) => step.id)).toEqual(["step-2", "step-1"]);
    expect(result[1].steps.map((step) => step.id)).toEqual(["step-3"]);
  });
});

describe("findLiveStepId", () => {
  it("returns the first open step in plan order", () => {
    const stages: PlanStage[] = [
      makeStage({
        id: "stage-1",
        steps: [makeStep({ id: "step-1", status: "done" }), makeStep({ id: "step-2", status: "open" })],
      }),
      makeStage({ id: "stage-2", steps: [makeStep({ id: "step-3", status: "open" })] }),
    ];

    expect(findLiveStepId(stages)).toBe("step-2");
  });

  it("skips blocked steps in favour of a later open step", () => {
    const stages: PlanStage[] = [
      makeStage({
        id: "stage-1",
        steps: [makeStep({ id: "step-1", status: "blocked" }), makeStep({ id: "step-2", status: "open" })],
      }),
    ];

    expect(findLiveStepId(stages)).toBe("step-2");
  });

  it("returns null when every step is done or blocked", () => {
    const stages: PlanStage[] = [
      makeStage({
        id: "stage-1",
        steps: [makeStep({ id: "step-1", status: "done" }), makeStep({ id: "step-2", status: "blocked" })],
      }),
    ];

    expect(findLiveStepId(stages)).toBeNull();
  });

  it("returns null when there are no stages at all", () => {
    expect(findLiveStepId([])).toBeNull();
  });
});
