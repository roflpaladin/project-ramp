// Sprint 12, Ticket 60. The sample deal must not spend one of the seller's
// paid active-deal slots: a brand-new Free tenant is seeded with an ACTIVE
// sample plan (lib/seed/sample-deal-data.ts), and a cap of 1 would otherwise
// mean their first real deal can never go live.
//
// Before T60 the sample workspace was recognisable only by its fictional
// target_domain — a string match the limit would have had to trust. 0015
// adds `workspaces.is_sample`, and this file pins that the seed actually
// sets it.
//
// Pure: buildSampleDealData does no I/O at all (that is why it was split
// from lib/seed/sample-deal.ts), so this spec touches no database.

import { describe, expect, it } from "vitest";

import { buildSampleDealData } from "@/lib/seed/sample-deal-data";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "99999999-9999-9999-9999-999999999999";
const RUN_AT = new Date("2026-09-21T12:00:00.000Z");

function buildDeal() {
  return buildSampleDealData({
    tenantId: TENANT_ID,
    userId: USER_ID,
    seller: { email: "seller@example.com", name: "Sam Seller" },
    runAt: RUN_AT,
  });
}

describe("buildSampleDealData — the sample marker", () => {
  it("flags the seeded workspace as a sample so the active-deal limit skips it", () => {
    const deal = buildDeal();

    expect(deal.workspace.is_sample).toBe(true);
  });

  it("still seeds the plan as active — the marker is on the workspace, not the plan", () => {
    // The sample deal has to LOOK like a live deal (that is its whole job);
    // exclusion happens on workspaces.is_sample, which is why the plan's own
    // status is left exactly as it was.
    const deal = buildDeal();

    expect(deal.plan.status).toBe("active");
    expect(deal.plan.workspace_id).toBe(deal.workspace.id);
  });

  it("keeps the seeded workspace in the caller's own tenant", () => {
    const deal = buildDeal();

    expect(deal.workspace.tenant_id).toBe(TENANT_ID);
  });
});
