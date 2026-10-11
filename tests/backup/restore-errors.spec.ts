// Sprint 12, Ticket 63 — weekly prod backup (.github/workflows/prod-backup.yml).
// pg_restore's stderr can quote row data, so the restore test used to print
// only its error COUNT. This pins the redaction that lets the error lines
// themselves reach the Actions log: identifiers stay readable, anything else
// in quotes is blanked, and the context lines that carry row data are dropped.

import { describe, expect, it } from "vitest";

import { redactRestoreErrors } from "../../scripts/backup/redact-restore-errors.mjs";

describe("redactRestoreErrors", () => {
  it("keeps an error line whose quoted parts are plain identifiers", () => {
    const log = 'pg_restore: error: could not execute query: ERROR:  schema "graphql" does not exist\n';
    expect(redactRestoreErrors(log)).toEqual([
      'pg_restore: error: could not execute query: ERROR:  schema "graphql" does not exist',
    ]);
  });

  it("blanks a quoted value that is not an identifier (row data)", () => {
    const log =
      'pg_restore: error: could not execute query: ERROR:  invalid input syntax for type uuid: "buyer@acme.com"\n';
    expect(redactRestoreErrors(log)).toEqual([
      'pg_restore: error: could not execute query: ERROR:  invalid input syntax for type uuid: "[redacted]"',
    ]);
  });

  it("drops the Command/CONTEXT/DETAIL lines, which can quote whole rows", () => {
    const log = [
      "pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint \"tenants_pkey\"",
      "DETAIL:  Key (id)=(7e570000-0000-4000-8000-000000000001) already exists.",
      "CONTEXT:  COPY tenants, line 1",
      "Command was: COPY public.tenants (id, company_name) FROM stdin;",
      "",
    ].join("\n");
    expect(redactRestoreErrors(log)).toEqual([
      'pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint "tenants_pkey"',
    ]);
  });

  it("truncates a very long error line", () => {
    const line = `pg_restore: error: ${"x".repeat(500)}`;
    const [out] = redactRestoreErrors(line);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns nothing for an empty log", () => {
    expect(redactRestoreErrors("")).toEqual([]);
  });
});
