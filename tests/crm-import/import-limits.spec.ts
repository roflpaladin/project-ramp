// Sprint 10, Ticket 53 code review (HIGH, security) — regression guard for
// lib/crm-import/import-limits.ts's MAX_CRM_IMPORT_DEALS itself, mirroring
// tests/import/csv-limits.spec.ts's own reasoning: asserting the literal
// value directly here means a silent drift is caught with a message that
// says exactly what changed, rather than failing indirectly inside an
// action-level test for a confusing reason.
//
// Renamed from MAX_HUBSPOT_IMPORT_DEALS (Sprint 11, Ticket 56) — see
// lib/crm-import/import-limits.ts's own header for the rename's rationale.

import { describe, expect, it } from "vitest";

import { MAX_CRM_IMPORT_DEALS } from "@/lib/crm-import/import-limits";

describe("import-limits", () => {
  it("caps a single CRM import batch at 200 deals", () => {
    expect(MAX_CRM_IMPORT_DEALS).toBe(200);
  });
});
