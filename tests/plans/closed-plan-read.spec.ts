// Sprint 12, Ticket 60. The seller-side reads added to lib/plans/queries.ts
// for a CLOSED deal.
//
// Founder ruling (2026-09-21): closing a deal deletes nothing and the SELLER
// still sees the plan, read-only, with its Won/Lost status. The existing
// getPlanForSeller only ever matches draft+active (0005's partial unique
// index is what makes its .maybeSingle() safe), so a closed plan needs its
// own read — and that read can NEVER use .maybeSingle(), because several
// closed plans can legitimately coexist in one workspace. Explicit
// order + limit 1 is the whole point of this file.
//
// getPlanForBuyer and the buyer portal path are deliberately untouched by
// T60 and have no coverage here for the same reason.
//
// DB-free: queries.ts takes an injectable client (its own documented test
// seam), so no module mocking is needed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { getClosedPlanForSeller, getPlanRowForSeller } from "@/lib/plans/queries";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface RecordedCall {
  readonly table: string;
  readonly operation: string;
  readonly args: readonly unknown[];
}

const calls: RecordedCall[] = [];
let listResult: QueryResult = { data: [], error: null };
let singleResult: QueryResult = { data: null, error: null };

function fakeClient(): SupabaseClient {
  const build = (table: string): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const record = (operation: string) => (...args: unknown[]) => {
      calls.push({ table, operation, args });
      return builder;
    };
    for (const operation of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
      builder[operation] = record(operation);
    }
    // maybeSingle is terminal AND recorded: this suite asserts the closed-plan
    // read never reaches for it.
    builder.maybeSingle = (...args: unknown[]) => {
      calls.push({ table, operation: "maybeSingle", args });
      return Promise.resolve(singleResult);
    };
    builder.then = (resolve: (value: QueryResult) => void) => resolve(listResult);
    return builder;
  };

  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";

function closedPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    workspace_id: WORKSPACE_ID,
    title: "Rollout success plan",
    start_date: "2026-08-01",
    target_date: "2026-09-30",
    status: "won",
    created_at: "2026-09-01T00:00:00.000Z",
    plan_stages: [
      {
        id: "stage-b",
        plan_id: PLAN_ID,
        title: "Second",
        display_order: 2,
        status: "done",
        plan_steps: [],
      },
      {
        id: "stage-a",
        plan_id: PLAN_ID,
        title: "First",
        display_order: 1,
        status: "done",
        plan_steps: [
          { id: "step-b", stage_id: "stage-a", label: "B", display_order: 2 },
          { id: "step-a", stage_id: "stage-a", label: "A", display_order: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

function argsOf(operation: string): readonly (readonly unknown[])[] {
  return calls.filter((call) => call.operation === operation).map((call) => call.args);
}

beforeEach(() => {
  calls.length = 0;
  listResult = { data: [], error: null };
  singleResult = { data: null, error: null };
});

describe("getClosedPlanForSeller", () => {
  it("returns the most recent closed plan as an assembled, ordered tree", async () => {
    listResult = { data: [closedPlanRow()], error: null };

    const plan = await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(plan?.id).toBe(PLAN_ID);
    expect(plan?.status).toBe("won");
    expect(plan?.stages.map((stage) => stage.id)).toEqual(["stage-a", "stage-b"]);
    expect(plan?.stages[0].steps.map((step) => step.id)).toEqual(["step-a", "step-b"]);
  });

  it("keeps the status on the row so the caller can tell the deal is closed", async () => {
    listResult = { data: [closedPlanRow({ status: "lost" })], error: null };

    const plan = await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(plan?.status).toBe("lost");
  });

  it("returns null for a workspace whose plan was never closed", async () => {
    listResult = { data: [], error: null };

    await expect(getClosedPlanForSeller(WORKSPACE_ID, fakeClient())).resolves.toBeNull();
  });

  it("matches won and lost only, for the workspace it was asked about", async () => {
    await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(argsOf("eq")).toContainEqual(["workspace_id", WORKSPACE_ID]);
    const [[column, statuses]] = argsOf("in");
    expect(column).toBe("status");
    expect([...(statuses as string[])]).toEqual(["won", "lost"]);
  });

  it("orders newest first and takes exactly one row — several closed plans can coexist", async () => {
    await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(argsOf("order")[0]).toEqual(["created_at", { ascending: false }]);
    expect(argsOf("limit")).toEqual([[1]]);
  });

  it("breaks a created_at tie deterministically instead of leaving the winner to PostgREST", async () => {
    await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(argsOf("order")).toHaveLength(2);
    expect(argsOf("order")[1][0]).toBe("id");
  });

  it("never calls maybeSingle — a widened filter can match several rows", async () => {
    await getClosedPlanForSeller(WORKSPACE_ID, fakeClient());

    expect(argsOf("maybeSingle")).toHaveLength(0);
  });

  it("throws with the workspace id when the read fails, rather than reporting 'no closed plan'", async () => {
    listResult = { data: null, error: { message: "connection reset" } };

    await expect(getClosedPlanForSeller(WORKSPACE_ID, fakeClient())).rejects.toThrow(
      new RegExp(`${WORKSPACE_ID}.*connection reset`),
    );
  });
});

describe("getPlanRowForSeller", () => {
  it("returns the plan row for an id the caller's own RLS scope can see", async () => {
    singleResult = { data: { id: PLAN_ID, workspace_id: WORKSPACE_ID, status: "active" }, error: null };

    const row = await getPlanRowForSeller(PLAN_ID, fakeClient());

    expect(row?.id).toBe(PLAN_ID);
    expect(row?.status).toBe("active");
  });

  it("returns null when RLS hides the row or the plan is gone", async () => {
    singleResult = { data: null, error: null };

    await expect(getPlanRowForSeller(PLAN_ID, fakeClient())).resolves.toBeNull();
  });

  it("throws with the plan id when the read itself fails", async () => {
    singleResult = { data: null, error: { message: "statement timeout" } };

    await expect(getPlanRowForSeller(PLAN_ID, fakeClient())).rejects.toThrow(
      new RegExp(`${PLAN_ID}.*statement timeout`),
    );
  });
});
