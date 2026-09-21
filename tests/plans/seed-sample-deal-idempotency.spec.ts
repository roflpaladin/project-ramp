// Sprint 12, Ticket 60 review fix (B1, pair of the migration's
// one-sample-per-tenant unique index). seedSampleDeal was non-idempotent BY
// DESIGN (T42): two calls produced two sample workspaces. With 0015 that is
// no longer merely untidy — a second sample is a second uncounted active
// deal, and the new unique index makes the insert fail outright.
//
// So the seed now returns the tenant's EXISTING sample instead of creating
// another, and treats the unique violation (two clicks racing each other)
// as the same "already seeded" outcome. Onboarding redirects to whatever
// workspace id comes back, so the happy path looks identical.
//
// DB-free: the service-role client is mocked, the same minimal chainable
// stand-in tests/billing/subscription-repository.spec.ts uses. 0015 is not
// on the dev database yet.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message: string } | null;
}

interface RecordedCall {
  readonly table: string;
  readonly operation: string;
  readonly args: readonly unknown[];
}

const { calls, results, userLookup } = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  results: { workspaceLookup: null as QueryResult | null, writes: [] as QueryResult[] },
  userLookup: {
    value: {
      data: { user: { email: "seller@example.com", app_metadata: { tenant_id: "" } } },
      error: null as unknown,
    },
  },
}));

const OK: QueryResult = { data: null, error: null };

function makeQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record = (operation: string) => (...args: unknown[]) => {
    calls.push({ table, operation, args });
    return builder;
  };

  for (const operation of ["select", "insert", "update", "delete", "eq", "in", "order"]) {
    builder[operation] = record(operation);
  }
  // The only chain that ends in .limit() is the existing-sample lookup.
  builder.limit = (...args: unknown[]) => {
    calls.push({ table, operation: "limit", args });
    return Promise.resolve(results.workspaceLookup ?? { data: [], error: null });
  };
  builder.then = (resolve: (value: QueryResult) => void) => resolve(results.writes.shift() ?? OK);

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    auth: { admin: { getUserById: () => Promise.resolve(userLookup.value) } },
  }),
}));

const { seedSampleDeal } = await import("@/lib/seed/sample-deal");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "99999999-9999-9999-9999-999999999999";
const EXISTING_WORKSPACE_ID = "77777777-7777-7777-7777-777777777777";
const EXISTING_PLAN_ID = "88888888-8888-8888-8888-888888888888";

const UNIQUE_VIOLATION = { code: "23505", message: 'duplicate key value violates unique constraint "idx_workspaces_one_sample_per_tenant"' };

function existingSample(planIds: string[] = [EXISTING_PLAN_ID]): QueryResult {
  return {
    data: [{ id: EXISTING_WORKSPACE_ID, success_plans: planIds.map((id) => ({ id })) }],
    error: null,
  };
}

function insertedTables(): string[] {
  return calls.filter((call) => call.operation === "insert").map((call) => call.table);
}

beforeEach(() => {
  calls.length = 0;
  results.workspaceLookup = null;
  results.writes = [];
  userLookup.value = {
    data: { user: { email: "seller@example.com", app_metadata: { tenant_id: TENANT_ID } } },
    error: null,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedSampleDeal — a tenant already has a sample", () => {
  it("returns the existing sample workspace instead of creating a second one", async () => {
    results.workspaceLookup = existingSample();

    const result = await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true, workspaceId: EXISTING_WORKSPACE_ID, planId: EXISTING_PLAN_ID });
  });

  it("writes nothing at all on that path", async () => {
    results.workspaceLookup = existingSample();

    await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(insertedTables()).toEqual([]);
  });

  it("looks the sample up by tenant and the is_sample flag, not by the fictional domain", async () => {
    results.workspaceLookup = existingSample();

    await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    const filters = calls.filter((call) => call.operation === "eq").map((call) => [call.args[0], call.args[1]]);
    expect(filters).toEqual(
      expect.arrayContaining([
        ["tenant_id", TENANT_ID],
        ["is_sample", true],
      ]),
    );
  });

  it("refuses rather than guessing when the existing sample has no plan left", async () => {
    // Only reachable if a previous run died between the workspace insert and
    // its compensating delete. Recovery is to remove that stray workspace —
    // inventing a plan id here would be a lie.
    results.workspaceLookup = existingSample([]);

    const result = await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.ok).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("seedSampleDeal — two clicks racing each other", () => {
  it("treats the unique-index violation as 'already seeded' and returns the winner's workspace", async () => {
    results.workspaceLookup = { data: [], error: null };
    results.writes = [{ data: null, error: UNIQUE_VIOLATION }];

    const seeding = seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });
    // The re-read after the collision finds the row the winning call wrote.
    results.workspaceLookup = existingSample();

    await expect(seeding).resolves.toEqual({
      ok: true,
      workspaceId: EXISTING_WORKSPACE_ID,
      planId: EXISTING_PLAN_ID,
    });
  });

  it("still fails cleanly for an ordinary insert error, with no raw Postgres text", async () => {
    results.workspaceLookup = { data: [], error: null };
    results.writes = [{ data: null, error: { code: "08006", message: "connection failure" } }];

    const result = await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/connection failure/);
  });
});

describe("seedSampleDeal — first sample for a tenant", () => {
  it("still seeds the whole deal when there is nothing to return", async () => {
    results.workspaceLookup = { data: [], error: null };

    const result = await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.ok).toBe(true);
    expect(insertedTables()).toEqual(["workspaces", "success_plans", "plan_stages", "plan_steps", "links"]);
  });

  it("refuses a tenant id that does not match the user's own claim, before looking anything up", async () => {
    userLookup.value = {
      data: { user: { email: "seller@example.com", app_metadata: { tenant_id: "another-tenant" } } },
      error: null,
    };

    const result = await seedSampleDeal({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.ok).toBe(false);
    expect(insertedTables()).toEqual([]);
  });
});
