// Sprint 12, Ticket 60. lib/plans/mark-live.ts — the thin wrapper over
// 0015's mark_plan_live() RPC, which is where the active-deal limit is
// ACTUALLY enforced (under a per-tenant row lock, so two tabs at the cap
// cannot both win). This file's whole job is to hand the cap down and turn
// the function's verdict into a closed union.
//
// DB-free (0015 is not on dev yet) and modelled on
// tests/billing/subscription-repository.spec.ts's upsertFromState coverage,
// including its most important assertion: an UNRECOGNISED verdict throws
// rather than being read as a refusal or a success. A stale version of the
// function still deployed somewhere must fail loudly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

const { rpcCalls, results } = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: unknown }[],
  results: { value: [] as RpcResult[] },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(results.value.shift() ?? { data: null, error: null });
    },
  }),
}));

const { markPlanLive } = await import("@/lib/plans/mark-live");

const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function givenVerdict(verdict: unknown): void {
  results.value = [{ data: verdict, error: null }];
}

beforeEach(() => {
  rpcCalls.length = 0;
  results.value = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markPlanLive — the call", () => {
  it("calls mark_plan_live with the plan, the tenant and the tier's cap", async () => {
    givenVerdict("live");

    await markPlanLive({ planId: PLAN_ID, tenantId: TENANT_ID, maxActiveDeals: 3 });

    expect(rpcCalls).toEqual([
      {
        name: "mark_plan_live",
        args: { p_plan_id: PLAN_ID, p_tenant_id: TENANT_ID, p_max_active_deals: 3 },
      },
    ]);
  });

  it("passes null for an unlimited tier, never a sentinel number", async () => {
    givenVerdict("live");

    await markPlanLive({ planId: PLAN_ID, tenantId: TENANT_ID, maxActiveDeals: null });

    expect(rpcCalls[0].args).toMatchObject({ p_max_active_deals: null });
  });
});

describe("markPlanLive — verdicts", () => {
  it.each(["live", "already_live", "limit_reached", "not_found"] as const)("returns '%s' verbatim", async (verdict) => {
    givenVerdict(verdict);

    await expect(markPlanLive({ planId: PLAN_ID, tenantId: TENANT_ID, maxActiveDeals: 1 })).resolves.toBe(verdict);
  });
});

describe("markPlanLive — failure", () => {
  it("throws with context when the RPC itself errors", async () => {
    results.value = [{ data: null, error: { message: "permission denied for function mark_plan_live" } }];

    await expect(markPlanLive({ planId: PLAN_ID, tenantId: TENANT_ID, maxActiveDeals: 1 })).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each([null, "", "LIVE", "ok", 1, { verdict: "live" }])(
    "throws on the unrecognised verdict %o rather than guessing what it meant",
    async (verdict) => {
      givenVerdict(verdict);

      await expect(markPlanLive({ planId: PLAN_ID, tenantId: TENANT_ID, maxActiveDeals: 1 })).rejects.toThrow(
        /mark_plan_live/,
      );
    },
  );
});
