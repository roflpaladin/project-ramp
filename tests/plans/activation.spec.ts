// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Unit tests for
// lib/plans/activation.ts's computeActivationState — a pure function, zero
// I/O, mirroring tests/security/engagement.spec.ts's approach to
// lib/plans/engagement.ts (same "inject everything, assert every branch"
// discipline, just no clock involved here).

import { describe, expect, it } from "vitest";

import { computeActivationState } from "@/lib/plans/activation";
import type { PlanStage, PlanStepRow, PlanTree } from "@/lib/plans/types";

function makeStep(overrides: Partial<PlanStepRow> & Pick<PlanStepRow, "id">): PlanStepRow {
  return {
    stage_id: "stage-1",
    label: "Step",
    owner_side: "buyer",
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
    title: "Stage",
    display_order: 0,
    status: "upcoming",
    steps: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanTree> & Pick<PlanTree, "status">): PlanTree {
  return {
    id: "plan-1",
    workspace_id: "workspace-1",
    title: "Plan",
    start_date: null,
    target_date: null,
    created_at: "2026-08-01T00:00:00+00:00",
    stages: [],
    ...overrides,
  };
}

describe("computeActivationState — populated step", () => {
  it("is not populated when there is no plan at all", () => {
    const state = computeActivationState({ plan: null, hasSentInvite: false });
    expect(state.steps.populated).toBe(false);
  });

  it("is not populated when the plan has zero stages", () => {
    const plan = makePlan({ status: "draft", stages: [] });
    const state = computeActivationState({ plan, hasSentInvite: false });
    expect(state.steps.populated).toBe(false);
  });

  it("is not populated when every stage has zero steps", () => {
    const plan = makePlan({
      status: "draft",
      stages: [makeStage({ id: "stage-1", steps: [] }), makeStage({ id: "stage-2", steps: [] })],
    });
    const state = computeActivationState({ plan, hasSentInvite: false });
    expect(state.steps.populated).toBe(false);
  });

  it("is populated when at least one stage has at least one step", () => {
    const plan = makePlan({
      status: "draft",
      stages: [
        makeStage({ id: "stage-1", steps: [] }),
        makeStage({ id: "stage-2", steps: [makeStep({ id: "step-1" })] }),
      ],
    });
    const state = computeActivationState({ plan, hasSentInvite: false });
    expect(state.steps.populated).toBe(true);
  });
});

describe("computeActivationState — invited step", () => {
  it("is not invited when hasSentInvite is false", () => {
    const state = computeActivationState({ plan: null, hasSentInvite: false });
    expect(state.steps.invited).toBe(false);
  });

  it("is invited when hasSentInvite is true, independent of plan state", () => {
    const state = computeActivationState({ plan: null, hasSentInvite: true });
    expect(state.steps.invited).toBe(true);
  });
});

describe("computeActivationState — live step", () => {
  it("is not live when there is no plan", () => {
    const state = computeActivationState({ plan: null, hasSentInvite: false });
    expect(state.steps.live).toBe(false);
  });

  it("is not live when the plan status is 'draft'", () => {
    const plan = makePlan({ status: "draft" });
    const state = computeActivationState({ plan, hasSentInvite: false });
    expect(state.steps.live).toBe(false);
  });

  it("is not live when the plan status is 'won' or 'lost'", () => {
    expect(computeActivationState({ plan: makePlan({ status: "won" }), hasSentInvite: false }).steps.live).toBe(
      false,
    );
    expect(computeActivationState({ plan: makePlan({ status: "lost" }), hasSentInvite: false }).steps.live).toBe(
      false,
    );
  });

  it("is live when the plan status is 'active'", () => {
    const plan = makePlan({ status: "active" });
    const state = computeActivationState({ plan, hasSentInvite: false });
    expect(state.steps.live).toBe(true);
  });
});

describe("computeActivationState — isComplete", () => {
  const populatedPlan = makePlan({
    status: "active",
    stages: [makeStage({ id: "stage-1", steps: [makeStep({ id: "step-1" })] })],
  });

  it("is false when no steps are satisfied", () => {
    const state = computeActivationState({ plan: null, hasSentInvite: false });
    expect(state.isComplete).toBe(false);
  });

  it("is false when only two of the three steps are satisfied (populated + invited, not live)", () => {
    const draftPopulatedPlan = makePlan({
      status: "draft",
      stages: [makeStage({ id: "stage-1", steps: [makeStep({ id: "step-1" })] })],
    });
    const state = computeActivationState({ plan: draftPopulatedPlan, hasSentInvite: true });
    expect(state.steps).toEqual({ populated: true, invited: true, live: false });
    expect(state.isComplete).toBe(false);
  });

  it("is false when only live + invited are satisfied but the plan is not populated", () => {
    const emptyActivePlan = makePlan({ status: "active", stages: [] });
    const state = computeActivationState({ plan: emptyActivePlan, hasSentInvite: true });
    expect(state.steps).toEqual({ populated: false, invited: true, live: true });
    expect(state.isComplete).toBe(false);
  });

  it("is true only when populated, invited, and live are all true", () => {
    const state = computeActivationState({ plan: populatedPlan, hasSentInvite: true });
    expect(state.steps).toEqual({ populated: true, invited: true, live: true });
    expect(state.isComplete).toBe(true);
  });
});
