// Sprint 10, Ticket 53 code review (HIGH, security) — regression guard for
// lib/crm-import/import-limits.ts's MAX_HUBSPOT_IMPORT_DEALS itself, mirroring
// tests/import/csv-limits.spec.ts's own reasoning: asserting the literal
// value directly here means a silent drift is caught with a message that
// says exactly what changed, rather than failing indirectly inside an
// action-level test for a confusing reason.

import { describe, expect, it } from "vitest";

import { MAX_HUBSPOT_IMPORT_DEALS } from "@/lib/crm-import/import-limits";

describe("import-limits", () => {
  it("caps a single HubSpot import batch at 200 deals", () => {
    expect(MAX_HUBSPOT_IMPORT_DEALS).toBe(200);
  });
});
