// Sprint 12, Ticket 60. lib/plans/active-deal-count.ts — the ADVISORY count
// behind "N of M active deals". Advisory because the authoritative decision
// is made inside 0015's mark_plan_live(), which re-counts under a per-tenant
// lock; this read exists so the seller can SEE where they stand without
// pressing anything.
//
// DB-free, mocking the service-role client the way
// tests/billing/subscription-repository.spec.ts does: 0015 is not on the dev
// database yet (manual SQL Editor workflow), and the rules worth pinning
// here — sample workspaces are excluded, a failed read never resolves to
// zero — are ours, not PostgREST's.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  readonly data: unknown;
  readonly count: number | null;
  readonly error: { readonly message: string } | null;
}

interface RecordedCall {
  readonly table: string;
  readonly operation: string;
  readonly args: readonly unknown[];
}

const { calls, results } = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  results: { value: [] as QueryResult[] },
}));

function nextResult(): QueryResult {
  return results.value.shift() ?? { data: [], count: 0, error: null };
}

/**
 * Chainable, thenable stand-in for the PostgREST query builder: every method
 * records its arguments and returns the same object, so any chain shape
 * resolves to the next configured result.
 */
function makeQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record = (operation: string) => (...args: unknown[]) => {
    calls.push({ table, operation, args });
    return builder;
  };

  for (const operation of ["select", "eq", "is", "in", "limit", "order"]) {
    builder[operation] = record(operation);
  }
  builder.then = (resolve: (value: QueryResult) => void) => resolve(nextResult());

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => makeQueryBuilder(table) }),
}));

const { countActiveDealsForTenant } = await import("@/lib/plans/active-deal-count");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Every (column, value) pair the chain filtered on, flattened. */
function eqFilters(): [unknown, unknown][] {
  return calls.filter((call) => call.operation === "eq").map((call) => [call.args[0], call.args[1]]);
}

beforeEach(() => {
  calls.length = 0;
  results.value = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("countActiveDealsForTenant", () => {
  it("returns the exact count the database reported", async () => {
    results.value = [{ data: [{ id: "a" }, { id: "b" }], count: 2, error: null }];

    await expect(countActiveDealsForTenant(TENANT_ID)).resolves.toBe(2);
  });

  it("returns zero for a tenant with nothing live", async () => {
    results.value = [{ data: [], count: 0, error: null }];

    await expect(countActiveDealsForTenant(TENANT_ID)).resolves.toBe(0);
  });

  it("counts success_plans, scoped to this tenant's own non-sample workspaces, status 'active' only", async () => {
    results.value = [{ data: [], count: 0, error: null }];

    await countActiveDealsForTenant(TENANT_ID);

    expect(calls[0].table).toBe("success_plans");
    expect(eqFilters()).toEqual(
      expect.arrayContaining([
        ["status", "active"],
        ["workspaces.tenant_id", TENANT_ID],
        ["workspaces.is_sample", false],
      ]),
    );
  });

  it("selects a real column rather than a HEAD-only count (the 204 quirk)", async () => {
    results.value = [{ data: [], count: 0, error: null }];

    await countActiveDealsForTenant(TENANT_ID);

    const select = calls.find((call) => call.operation === "select");
    expect(String(select?.args[0])).toMatch(/\bid\b/);
    expect(select?.args[1]).toEqual(expect.objectContaining({ count: "exact", head: false }));
  });

  it("throws on a query error instead of reporting zero active deals", async () => {
    results.value = [{ data: null, count: null, error: { message: "connection reset" } }];

    await expect(countActiveDealsForTenant(TENANT_ID)).rejects.toThrow(/connection reset/);
  });

  it("throws when the driver returns no count at all, rather than silently under-reporting", async () => {
    results.value = [{ data: [], count: null, error: null }];

    await expect(countActiveDealsForTenant(TENANT_ID)).rejects.toThrow(/count/i);
  });
});
