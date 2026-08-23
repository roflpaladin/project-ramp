// Ticket 45 (Sprint 9) — the explicit partial-failure report the AC
// demands: a CSV import must never silently drop failed rows, so the
// summary always lists every failure by row number, never just a count.

import { describe, expect, it } from "vitest";

import type { RowValidationResult } from "@/lib/import/validate-rows";
import { summarizeImport } from "@/lib/import/summarize-import";

function ok(rowNumber: number): RowValidationResult {
  return {
    rowNumber,
    ok: true,
    value: {
      company_name: `Acme ${rowNumber}`,
      company_domain: `acme-${rowNumber}.example.com`,
      contact_email: null,
      plan_title: `Plan ${rowNumber}`,
      target_date: null,
    },
  };
}

function fail(rowNumber: number, errors: string[]): RowValidationResult {
  return { rowNumber, ok: false, errors };
}

describe("summarizeImport", () => {
  it("returns all-zero totals for an empty result set", () => {
    expect(summarizeImport([])).toEqual({ total: 0, succeeded: 0, failed: 0, failures: [] });
  });

  it("summarizes an all-success batch with no failures listed", () => {
    const summary = summarizeImport([ok(1), ok(2), ok(3)]);
    expect(summary).toEqual({ total: 3, succeeded: 3, failed: 0, failures: [] });
  });

  it("summarizes an all-failure batch, listing every row", () => {
    const results = [fail(1, ["company_name: is required."]), fail(2, ["plan_title: is required."])];
    const summary = summarizeImport(results);
    expect(summary).toEqual({
      total: 2,
      succeeded: 0,
      failed: 2,
      failures: [
        { rowNumber: 1, errors: ["company_name: is required."] },
        { rowNumber: 2, errors: ["plan_title: is required."] },
      ],
    });
  });

  it("summarizes a mixed batch, reporting the exact failing rows without dropping any", () => {
    const results = [ok(1), fail(2, ["company_name: is required."]), ok(3), fail(4, ["plan_title: is required.", "target_date: must not be in the past."])];
    const summary = summarizeImport(results);
    expect(summary).toEqual({
      total: 4,
      succeeded: 2,
      failed: 2,
      failures: [
        { rowNumber: 2, errors: ["company_name: is required."] },
        { rowNumber: 4, errors: ["plan_title: is required.", "target_date: must not be in the past."] },
      ],
    });
  });
});
