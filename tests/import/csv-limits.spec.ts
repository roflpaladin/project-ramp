// Ticket 45 (Sprint 9) — CSV deal-import caps. Regression guard for the
// named constants themselves: every other module in lib/import/ imports
// these rather than repeating a magic number, so a silent drift here would
// otherwise only be caught indirectly (a boundary test in parse-csv.spec.ts
// failing for a confusing reason). Asserting the literal values directly
// here means that failure mode says exactly what changed.

import { describe, expect, it } from "vitest";

import { MAX_CSV_BYTES, MAX_CSV_ROWS, REQUIRED_COLUMNS } from "@/lib/import/csv-limits";

describe("csv-limits", () => {
  it("caps CSV uploads at 512KB, under Next's 1MB server-action body default", () => {
    expect(MAX_CSV_BYTES).toBe(512 * 1024);
  });

  it("caps CSV uploads at 200 data rows, excluding the header row", () => {
    expect(MAX_CSV_ROWS).toBe(200);
  });

  it("defines the exact five-column deal-import schema, in a stable order", () => {
    expect(REQUIRED_COLUMNS).toEqual(["company_name", "company_domain", "contact_email", "plan_title", "target_date"]);
  });
});
