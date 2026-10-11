// Sprint 12, Ticket 63 — weekly prod backup (.github/workflows/prod-backup.yml).
// The workflow restores every backup into a throwaway Postgres and compares
// per-table row counts with prod's. This pins that comparison: which
// differences fail the restore test and which are tolerated.

import { describe, expect, it } from "vitest";

import { compareCounts, parseCounts } from "../../scripts/backup/compare-counts.mjs";

describe("parseCounts", () => {
  it("reads tab-separated `schema.table<TAB>count` lines, ignoring blanks", () => {
    expect(parseCounts("public.tenants\t12\n\nauth.users\t30\n")).toEqual(
      new Map([
        ["public.tenants", 12],
        ["auth.users", 30],
      ]),
    );
  });

  it("rejects a malformed line instead of guessing", () => {
    expect(() => parseCounts("public.tenants twelve")).toThrow(/line 1/);
  });
});

describe("compareCounts", () => {
  const prod = new Map([
    ["public.tenants", 12],
    ["public.workspaces", 40],
    ["public.waitlist_signups", 900],
    ["auth.users", 30],
  ]);

  it("passes when every table matches exactly", () => {
    expect(compareCounts(prod, new Map(prod))).toEqual({ ok: true, problems: [] });
  });

  it("tolerates a small drift from writes between the count and the dump", () => {
    const restored = new Map(prod).set("public.waitlist_signups", 903).set("public.workspaces", 38);

    expect(compareCounts(prod, restored).ok).toBe(true);
  });

  it("fails when a table is missing from the restore", () => {
    const restored = new Map(prod);
    restored.delete("auth.users");

    expect(compareCounts(prod, restored)).toEqual({ ok: false, problems: ["auth.users: missing from the restore"] });
  });

  it("fails when a table restored empty but prod has rows", () => {
    const restored = new Map(prod).set("public.tenants", 0);

    expect(compareCounts(prod, restored)).toEqual({
      ok: false,
      problems: ["public.tenants: restored 0 rows, prod has 12"],
    });
  });

  it("fails when the difference is beyond the tolerance", () => {
    const restored = new Map(prod).set("public.waitlist_signups", 850);

    expect(compareCounts(prod, restored)).toEqual({
      ok: false,
      problems: ["public.waitlist_signups: restored 850 rows, prod has 900"],
    });
  });

  it("passes an empty table that is also empty in prod", () => {
    const empty = new Map([["public.billing_checkout_refs", 0]]);

    expect(compareCounts(empty, new Map(empty)).ok).toBe(true);
  });

  it("fails when prod lists no tables at all, so a broken count query cannot pass", () => {
    expect(compareCounts(new Map(), new Map())).toEqual({ ok: false, problems: ["prod count list is empty"] });
  });
});
