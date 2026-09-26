// Sprint 12, Ticket 60. lib/plans/closed-plans.ts — the vocabulary of a
// CLOSED deal (won/lost) plus the server-side guard that makes a closed
// plan read-only.
//
// Founder ruling (2026-09-21): won and lost behave identically — closing
// frees a seat, deletes nothing, and the seller keeps seeing the plan with
// its outcome. Read-only therefore has to be enforced HERE, on the server,
// not by hiding buttons: every plan/stage/step mutation resolves its owning
// plan through this guard first.
//
// DB-free by injecting a fake Supabase client (the same seam
// lib/plans/queries.ts and lib/plans/write.ts already expose for tests) —
// no mocking of modules needed at all.

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { CLOSED_PLAN_STATUSES, ensurePlanIsOpen, isClosedPlanStatus } from "@/lib/plans/closed-plans";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

interface RecordedCall {
  readonly table: string;
  readonly operation: string;
  readonly args: readonly unknown[];
}

const calls: RecordedCall[] = [];
let queued: QueryResult[] = [];

/** Chainable + terminal-on-maybeSingle stand-in for the PostgREST builder. */
function fakeClient(): SupabaseClient {
  const build = (table: string): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const record = (operation: string) => (...args: unknown[]) => {
      calls.push({ table, operation, args });
      return builder;
    };
    for (const operation of ["select", "eq", "in", "limit", "order"]) {
      builder[operation] = record(operation);
    }
    builder.maybeSingle = () => Promise.resolve(queued.shift() ?? { data: null, error: null });
    return builder;
  };

  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const STAGE_ID = "33333333-3333-3333-3333-333333333333";
const STEP_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  calls.length = 0;
  queued = [];
});

describe("closed-plan vocabulary", () => {
  it("treats exactly won and lost as closed", () => {
    expect([...CLOSED_PLAN_STATUSES]).toEqual(["won", "lost"]);
  });

  it.each(["won", "lost"])("accepts '%s' as a close outcome", (status) => {
    expect(isClosedPlanStatus(status)).toBe(true);
  });

  it.each(["draft", "active", "closed", "WON", "", null, undefined, 1])(
    "refuses %o as a close outcome",
    (value) => {
      expect(isClosedPlanStatus(value)).toBe(false);
    },
  );
});

describe("ensurePlanIsOpen — by plan id", () => {
  it.each(["draft", "active"])("lets a %s plan through", async (status) => {
    queued = [{ data: { status }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(result.ok).toBe(true);
  });

  it.each(["won", "lost"])("refuses a %s plan with PLAN_CLOSED", async (status) => {
    queued = [{ data: { status }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
  });

  it("reads success_plans.status filtered on the plan id it was given", async () => {
    queued = [{ data: { status: "draft" }, error: null }];

    await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(calls[0].table).toBe("success_plans");
    expect(calls.find((call) => call.operation === "eq")?.args).toEqual(["id", PLAN_ID]);
  });

  it("returns NOT_FOUND when no row is visible — RLS hiding a foreign tenant looks identical", async () => {
    queued = [{ data: null, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("maps a refused read (42501) through the shared mapper, never a leaked 403", async () => {
    queued = [{ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }];

    const result = await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns UNKNOWN_ERROR for an unrecognised read failure rather than letting the mutation proceed", async () => {
    queued = [{ data: null, error: { code: "08006", message: "connection failure" } }];

    const result = await ensurePlanIsOpen(fakeClient(), { planId: PLAN_ID });

    expect(result).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
  });
});

describe("ensurePlanIsOpen — by stage id", () => {
  it("resolves the owning plan through the embedded success_plans row", async () => {
    queued = [{ data: { success_plans: { status: "won" } }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stageId: STAGE_ID });

    expect(calls[0].table).toBe("plan_stages");
    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
  });

  it("accepts an array-shaped embed too — PostgREST has shipped both", async () => {
    queued = [{ data: { success_plans: [{ status: "lost" }] }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stageId: STAGE_ID });

    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
  });

  it("lets a stage on a draft plan through", async () => {
    queued = [{ data: { success_plans: { status: "draft" } }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stageId: STAGE_ID });

    expect(result.ok).toBe(true);
  });
});

describe("ensurePlanIsOpen — by step id", () => {
  it("resolves the owning plan two levels up", async () => {
    queued = [{ data: { plan_stages: { success_plans: { status: "won" } } }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stepId: STEP_ID });

    expect(calls[0].table).toBe("plan_steps");
    expect(result).toEqual({ ok: false, code: "PLAN_CLOSED" });
  });

  it("lets a step on an active plan through", async () => {
    queued = [{ data: { plan_stages: { success_plans: { status: "active" } } }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stepId: STEP_ID });

    expect(result.ok).toBe(true);
  });

  it("returns NOT_FOUND when the embed comes back empty rather than assuming the plan is open", async () => {
    queued = [{ data: { plan_stages: null }, error: null }];

    const result = await ensurePlanIsOpen(fakeClient(), { stepId: STEP_ID });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
