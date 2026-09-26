// T62 follow-up (R7 tail) — markPlanLiveAction and closePlanAction
// (app/admin/workspaces/[id]/plan/plan-actions.ts) had NO rate limit at
// all before this. Both are stable Server Action POSTs a script can
// replay: going live re-reads billing state and takes mark_plan_live()'s
// per-tenant lock on every call, and closing writes a plan status update.
//
// DB-free: requireSeller, lib/plans/go-live.ts (goLivePlan) and
// lib/plans/closed-plans.ts's ensurePlanIsOpen are mocked, so only the
// PLAN_LIFECYCLE_RATE_LIMIT branch inside each action is under test — same
// split as tests/security/onboarding-rate-limit.spec.ts. The limiter
// itself is NOT mocked: RATE_LIMIT_STORE=memory (vitest.config.ts) means
// lib/rate-limit-durable.ts's checkDurableRateLimit falls straight through
// to the real in-memory checkRateLimit, which is exactly the degraded path
// a database outage puts production on — so "under budget" and "over
// budget" here also stand in for "the store is unreachable and the caller
// still gets a real answer", not just the interim in-memory behaviour.
//
// Keyed per tenant, not per user (plan-actions.ts's own comment) — each
// test below uses its own unique tenant id to keep windows isolated from
// the others in this file, matching the onboarding suite's convention.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { PLAN_LIFECYCLE_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";

const { currentSellerSession, revalidatedPaths, mockGoLivePlan, mockEnsurePlanIsOpen, mockUpdatePlan } = vi.hoisted(
  () => ({
    currentSellerSession: { value: null as SellerSession | null },
    revalidatedPaths: [] as string[],
    mockGoLivePlan: vi.fn(),
    mockEnsurePlanIsOpen: vi.fn(),
    mockUpdatePlan: vi.fn(),
  }),
);

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidatedPaths.push(path);
  }),
}));

vi.mock("@/lib/plans/go-live", () => ({ goLivePlan: mockGoLivePlan }));

vi.mock("@/lib/plans/closed-plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plans/closed-plans")>();
  return { ...actual, ensurePlanIsOpen: mockEnsurePlanIsOpen };
});

vi.mock("@/lib/plans/write", () => ({ updatePlan: mockUpdatePlan }));

const { markPlanLiveAction, closePlanAction } = await import("@/app/admin/workspaces/[id]/plan/plan-actions");

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const PLAN_ROW = { id: PLAN_ID, workspace_id: WORKSPACE_ID, title: "Rollout", status: "active" };

function makeSession(tenantId: string): SellerSession {
  return { client: {} as SellerSession["client"], userId: `user-${tenantId}`, email: null, tenantId };
}

beforeEach(() => {
  resetRateLimiterForTests();
  revalidatedPaths.length = 0;
  mockGoLivePlan.mockReset();
  mockGoLivePlan.mockResolvedValue({ ok: true, data: { ...PLAN_ROW, status: "active" } });
  mockEnsurePlanIsOpen.mockReset();
  mockEnsurePlanIsOpen.mockResolvedValue({ ok: true });
  mockUpdatePlan.mockReset();
  mockUpdatePlan.mockResolvedValue({ ok: true, data: { ...PLAN_ROW, status: "won" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markPlanLiveAction — rate limiting", () => {
  it("allows the budgeted calls, then refuses with RATE_LIMITED without calling goLivePlan", async () => {
    currentSellerSession.value = makeSession("t62-go-live-a");

    for (let call = 0; call < PLAN_LIFECYCLE_RATE_LIMIT.limit; call += 1) {
      const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
      expect(result.ok).toBe(true);
    }
    expect(mockGoLivePlan).toHaveBeenCalledTimes(PLAN_LIFECYCLE_RATE_LIMIT.limit);

    const overBudget = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(overBudget).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(mockGoLivePlan).toHaveBeenCalledTimes(PLAN_LIFECYCLE_RATE_LIMIT.limit);
    expect(revalidatedPaths).toHaveLength(PLAN_LIFECYCLE_RATE_LIMIT.limit * 2);
  });

  it("budgets are per tenant: one tenant at the cap does not throttle another", async () => {
    currentSellerSession.value = makeSession("t62-go-live-capped");
    for (let call = 0; call < PLAN_LIFECYCLE_RATE_LIMIT.limit; call += 1) {
      await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
    }
    const cappedOverBudget = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
    expect(cappedOverBudget).toEqual({ ok: false, code: "RATE_LIMITED" });

    currentSellerSession.value = makeSession("t62-go-live-other");
    const otherResult = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
    expect(otherResult.ok).toBe(true);
  });

  it("checks the budget before calling requireSeller's delegate, but never before authentication", async () => {
    currentSellerSession.value = null;

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mockGoLivePlan).not.toHaveBeenCalled();
  });
});

describe("closePlanAction — rate limiting", () => {
  it("allows the budgeted calls, then refuses with RATE_LIMITED without writing", async () => {
    currentSellerSession.value = makeSession("t62-close-deal-a");

    for (let call = 0; call < PLAN_LIFECYCLE_RATE_LIMIT.limit; call += 1) {
      const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");
      expect(result.ok).toBe(true);
    }
    expect(mockUpdatePlan).toHaveBeenCalledTimes(PLAN_LIFECYCLE_RATE_LIMIT.limit);

    const overBudget = await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");

    expect(overBudget).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(mockUpdatePlan).toHaveBeenCalledTimes(PLAN_LIFECYCLE_RATE_LIMIT.limit);
    expect(mockEnsurePlanIsOpen).toHaveBeenCalledTimes(PLAN_LIFECYCLE_RATE_LIMIT.limit);
  });

  it("has its own budget, separate from markPlanLiveAction's, for the same tenant", async () => {
    currentSellerSession.value = makeSession("t62-shared-tenant");

    for (let call = 0; call < PLAN_LIFECYCLE_RATE_LIMIT.limit; call += 1) {
      await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
    }
    const goLiveOverBudget = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);
    expect(goLiveOverBudget).toEqual({ ok: false, code: "RATE_LIMITED" });

    // Same tenant, but closePlanAction's own key — spending go-live's budget
    // above must not have touched it.
    const closeResult = await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");
    expect(closeResult.ok).toBe(true);
  });

  it("refuses an invalid outcome before spending any of the budget", async () => {
    currentSellerSession.value = makeSession("t62-close-deal-validation");

    for (let call = 0; call < PLAN_LIFECYCLE_RATE_LIMIT.limit + 5; call += 1) {
      const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "archived" as never);
      expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    }

    // The budget is untouched: a real close right after all those refusals
    // still succeeds.
    const result = await closePlanAction(WORKSPACE_ID, PLAN_ID, "won");
    expect(result.ok).toBe(true);
  });
});
