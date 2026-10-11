// Mock-only: drives sweepStaleFixtures against an in-memory fake client. No
// database, no requireTestEnv().
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sweepStaleFixtures } from "./sweep-stale-fixtures";

const HOUR = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();

interface FakeData {
  users: { id: string; email: string; created_at: string; app_metadata?: Record<string, unknown> }[];
  tenants: { id: string; created_at: string }[];
  workspaces: { id: string; tenant_id: string; created_by: string }[];
}

function fakeDb(data: FakeData) {
  const deletes: { table: string; ids: readonly string[] }[] = [];
  const deletedUsers: string[] = [];

  const from = (table: string) => ({
    select: () => {
      const filters: ((row: Record<string, string>) => boolean)[] = [];
      const chain = {
        gte: () => chain,
        lte: () => chain,
        in: (column: string, values: string[]) => {
          filters.push((row) => values.includes(row[column]));
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          const rows = (data as unknown as Record<string, Record<string, string>[]>)[table] ?? [];
          resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null });
        },
      };
      return chain;
    },
    delete: () => ({
      in: async (_column: string, ids: string[]) => {
        deletes.push({ table, ids });
        return { error: null };
      },
    }),
  });

  const auth = {
    admin: {
      listUsers: async () => ({ data: { users: data.users }, error: null }),
      deleteUser: async (id: string) => {
        deletedUsers.push(id);
        return { error: null };
      },
    },
  };
  return { db: { from, auth } as unknown as SupabaseClient, deletes, deletedUsers };
}

describe("sweepStaleFixtures", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes stale run-scoped rows in FK order and leaves fresh and demo rows alone", async () => {
    const stale = "7e57aaaa-bbbb-4ccc-8000-000000000001";
    const fresh = "7e57dddd-eeee-4fff-8000-000000000001";
    const { db, deletes, deletedUsers } = fakeDb({
      users: [
        { id: "u-stale", email: "t23-harness+aaaabbbbccc@projectramp.invalid", created_at: iso(9), app_metadata: { tenant_id: stale } },
        { id: "u-fresh", email: "t23-harness+ddddeeeefff@projectramp.invalid", created_at: iso(1) },
        { id: "u-real", email: "someone@example.com", created_at: iso(99) },
      ],
      tenants: [
        { id: stale, created_at: iso(9) },
        { id: fresh, created_at: iso(1) },
      ],
      workspaces: [
        { id: "w-stale", tenant_id: stale, created_by: "u-stale" },
        { id: "w-demo-pulse", tenant_id: "de30-demo", created_by: "u-stale" },
        { id: "w-fresh", tenant_id: fresh, created_by: "u-fresh" },
      ],
    });

    const counts = await sweepStaleFixtures(db);

    expect(counts).toEqual({ users: 1, tenants: 1, workspaces: 2, failures: 0 });
    expect(deletes.map((d) => d.table)).toEqual(["links", "portal_access_tokens", "workspaces", "tenants"]);
    expect(deletes[2].ids).toEqual(["w-stale", "w-demo-pulse"]);
    expect(deletes[3].ids).toEqual([stale]);
    expect(deletedUsers).toEqual(["u-stale"]);
  });

  it("leaves legacy fixed-id tenants and fixed-email users alone, however old", async () => {
    // A branch that predates run-scoped ids still upserts these rows, so their
    // created_at is ancient even while such a run is using them.
    const { db, deletes, deletedUsers } = fakeDb({
      users: [{ id: "u-legacy", email: "t23-harness@projectramp.invalid", created_at: iso(999) }],
      tenants: [
        { id: "7e570000-0000-4000-8000-000000000001", created_at: iso(999) },
        { id: "7e5a0000-0000-4000-8000-000000000001", created_at: iso(999) },
      ],
      workspaces: [],
    });

    const counts = await sweepStaleFixtures(db);

    expect(counts).toEqual({ users: 0, tenants: 0, workspaces: 0, failures: 0 });
    expect(deletes).toEqual([]);
    expect(deletedUsers).toEqual([]);
  });

  it("leaves an old real tenant alone when its random id happens to start with 7e57", async () => {
    // gen_random_uuid() lands in the 7e57..7e5a range about 1 time in 16,384;
    // only the run-scoped shape (…-4xxx-8000-…) marks a fixture tenant.
    const { db, deletes } = fakeDb({
      users: [],
      tenants: [{ id: "7e57c3d1-9a2b-4f10-b7e4-2c9d81a0f5e6", created_at: iso(999) }],
      workspaces: [],
    });

    const counts = await sweepStaleFixtures(db);

    expect(counts.tenants).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("deletes nothing when everything is fresh", async () => {
    const { db, deletes, deletedUsers } = fakeDb({
      users: [{ id: "u", email: "x+aaaabbbbccc@projectramp.invalid", created_at: iso(2) }],
      tenants: [{ id: "7e57aaaa-bbbb-4ccc-8000-000000000001", created_at: iso(2) }],
      workspaces: [],
    });

    const counts = await sweepStaleFixtures(db);

    expect(counts).toEqual({ users: 0, tenants: 0, workspaces: 0, failures: 0 });
    expect(deletes).toEqual([]);
    expect(deletedUsers).toEqual([]);
  });
});
