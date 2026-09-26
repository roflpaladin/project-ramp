// Sprint 12, Ticket 60 (close a deal). The server-action half of "a closed
// deal is read-only": closePlanAction itself, and the guard every other
// plan/stage/step mutation now runs before it writes.
//
// Founder ruling (2026-09-21): read-only is enforced on the SERVER, not by
// hiding controls — so the assertions below are all of the same shape,
// "returns PLAN_CLOSED and the write layer was never called".
//
// DB-free: requireSeller, next/cache and lib/plans/write.ts are mocked, and
// the guard runs for real against an injected fake client. That last part is
// deliberate — mocking the guard too would leave nothing proving each action
// actually wired it up with the right id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import type { PlanStatus } from "@/lib/plans/types";

const { currentSellerSession, revalidatedPaths, writeMocks } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
  revalidatedPaths: [] as string[],
  writeMocks: {
    createStage: vi.fn(),
    createStep: vi.fn(),
    deletePlan: vi.fn(),
    deleteStage: vi.fn(),
    deleteStep: vi.fn(),
    reorderStages: vi.fn(),
    reorderSteps: vi.fn(),
    updatePlan: vi.fn(),
    updateStage: vi.fn(),
    updateStep: vi.fn(),
    createPlan: vi.fn(),
  },
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidatedPaths.push(path);
  }),
}));

vi.mock("@/lib/plans/write", () => writeMocks);

const {
  closePlanAction,
  createStageAction,
  createStepAction,
  deletePlanAction,
  deleteStageAction,
  deleteStepAction,
  reorderStagesAction,
  reorderStepsAction,
  updatePlanAction,
  updateStageAction,
  updateStepAction,
} = await import("@/app/admin/workspaces/[id]/plan/plan-actions");

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const STAGE_ID = "33333333-3333-3333-3333-333333333333";
const STEP_ID = "44444444-4444-4444-4444-444444444444";

const PLAN_ROW = { id: PLAN_ID, workspace_id: WORKSPACE_ID, title: "Rollout", status: "won" };

/** The status every guard lookup in a test will resolve to. */
let planStatus: PlanStatus = "active";

function fakeSellerClient(): SupabaseClient {
  const build = (table: string): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const operation of ["select", "eq", "in", "order", "limit"]) {
      builder[operation] = () => builder;
    }
    // One shape per table, matching what ensurePlanIsOpen selects.
    builder.maybeSingle = () => {
      if (table === "success_plans") return Promise.resolve({ data: { status: planStatus }, error: null });
      if (table === "plan_stages") {
        return Promise.resolve({ data: { success_plans: { status: planStatus } }, error: null });
      }
      return Promise.resolve({ data: { plan_stages: { success_plans: { status: planStatus } } }, error: null });
    };
    return builder;
  };

  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

function formData(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function noWritesHappened(): boolean {
  return Object.values(writeMocks).every((mock) => mock.mock.calls.length === 0);
}

beforeEach(() => {
  revalidatedPaths.length = 0;
  planStatus = "active";
  currentSellerSession.value = {
    client: fakeSellerClient(),
    userId: "user-1",
    email: "seller@example.com",
    tenantId: "11111111-1111-1111-1111-111111111111",
  };
  for (const mock of Object.values(writeMocks)) {
    mock.mockReset();
    mock.mockResolvedValue({ ok: true, data: PLAN_ROW });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("closePlanAction", () => {
  it.each(["won", "lost"] as const)("writes status '%s' and nothing else", async (outcome) => {
    const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, outcome);

    expect(result.ok).toBe(true);
    expect(writeMocks.updatePlan).toHaveBeenCalledWith(PLAN_ID, { status: outcome }, expect.anything());
  });

  it("deletes nothing — closing frees a seat, it does not remove the deal", async () => {
    await closePlanAction(WORKSPACE_ID, PLAN_ID, "lost");

    expect(writeMocks.deletePlan).not.toHaveBeenCalled();
    expect(writeMocks.deleteStage).not.toHaveBeenCalled();
    expect(writeMocks.deleteStep).not.toHaveBeenCalled();
  });

  it("refreshes both the plan page and the workspace page", async () => {
    await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");

    expect(revalidatedPaths).toEqual([
      `/admin/workspaces/${WORKSPACE_ID}/plan`,
      `/admin/workspaces/${WORKSPACE_ID}`,
    ]);
  });

  it("refuses an outcome that is not won or lost", async () => {
    const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "archived" as never);

    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(noWritesHappened()).toBe(true);
  });

  it("refuses to close a deal that is already closed", async () => {
    planStatus = "won";

    const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "lost");

    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
    expect(noWritesHappened()).toBe(true);
  });

  it("returns UNAUTHENTICATED without touching the database when there is no session", async () => {
    currentSellerSession.value = null;

    const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(noWritesHappened()).toBe(true);
  });
});

describe("updatePlanAction — status is not a field this form can set", () => {
  it.each(["active", "won", "lost", "draft"])("refuses a crafted status=%s in the form data", async (status) => {
    // The bypass this closes: updatePlanAction accepted any legal PlanStatus
    // from FormData, so a crafted field could make a plan live without ever
    // passing the active-deal limit. Going live and closing each have their
    // own action now.
    const result = await updatePlanAction(WORKSPACE_ID, PLAN_ID, formData({ title: "Rollout", status }));

    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(writeMocks.updatePlan).not.toHaveBeenCalled();
  });

  it("still saves an ordinary title/date edit", async () => {
    const result = await updatePlanAction(
      WORKSPACE_ID,
      PLAN_ID,
      formData({ title: "Rollout", start_date: "2026-09-01", target_date: "2026-10-01" }),
    );

    expect(result.ok).toBe(true);
    expect(writeMocks.updatePlan).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ title: "Rollout" }),
      expect.anything(),
    );
  });
});

describe("every mutation on a CLOSED plan is refused server-side", () => {
  beforeEach(() => {
    planStatus = "won";
  });

  const cases: [string, () => Promise<{ ok: boolean }>][] = [
    ["updatePlanAction", () => updatePlanAction(WORKSPACE_ID, PLAN_ID, formData({ title: "New title" }))],
    ["deletePlanAction", () => deletePlanAction(WORKSPACE_ID, PLAN_ID)],
    ["createStageAction", () => createStageAction(WORKSPACE_ID, PLAN_ID, formData({ title: "Stage" }))],
    ["updateStageAction", () => updateStageAction(WORKSPACE_ID, STAGE_ID, formData({ title: "Stage" }))],
    ["deleteStageAction", () => deleteStageAction(WORKSPACE_ID, STAGE_ID)],
    [
      "createStepAction",
      () => createStepAction(WORKSPACE_ID, STAGE_ID, formData({ label: "Step", owner_side: "seller" })),
    ],
    ["updateStepAction", () => updateStepAction(WORKSPACE_ID, STEP_ID, formData({ label: "Step" }))],
    ["deleteStepAction", () => deleteStepAction(WORKSPACE_ID, STEP_ID)],
    ["reorderStagesAction", () => reorderStagesAction(PLAN_ID, [STAGE_ID])],
    ["reorderStepsAction", () => reorderStepsAction(STAGE_ID, [STEP_ID])],
  ];

  it.each(cases)("%s returns PLAN_CLOSED and writes nothing", async (_name, run) => {
    const result = await run();

    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
    expect(noWritesHappened()).toBe(true);
  });
});

describe("the same mutations still work on an OPEN plan", () => {
  it("lets a stage be created on a draft plan", async () => {
    planStatus = "draft";

    const result = await createStageAction(WORKSPACE_ID, PLAN_ID, formData({ title: "Stage" }));

    expect(result.ok).toBe(true);
    expect(writeMocks.createStage).toHaveBeenCalled();
  });

  it("lets a step be edited on an active plan", async () => {
    planStatus = "active";

    const result = await updateStepAction(WORKSPACE_ID, STEP_ID, formData({ label: "Step" }));

    expect(result.ok).toBe(true);
    expect(writeMocks.updateStep).toHaveBeenCalled();
  });

  it("lets stages be reordered on an active plan", async () => {
    writeMocks.reorderStages.mockResolvedValue({ ok: true, data: [] });

    const result = await reorderStagesAction(PLAN_ID, [STAGE_ID]);

    expect(result.ok).toBe(true);
    expect(writeMocks.reorderStages).toHaveBeenCalled();
  });
});
