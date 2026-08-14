// T36-3 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Proves
// resolveStepLabels — the label lookup /api/demo/pulse's step_complete feed
// entries use — never carries plan_steps' seller-private fields
// (private_note, owner_email), because its select is narrow ("id, label")
// rather than "*". Runs against real Supabase (no mocking, per this
// project's own testing convention: a mock cannot prove a select is
// actually narrow at the wire level).
//
// Reuses the existing buyer-boundary fixture (tests/fixtures/seed-leaky-
// workspace.ts) rather than seeding a dedicated demo-tenant workspace:
// resolveStepLabels queries plan_steps by id only and is tenant-agnostic by
// construction (the route it serves already gates on the demo tenant before
// ever calling it), so any seeded step with private_note populated proves
// the point.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveStepLabels, STEP_LABEL_SELECT } from "@/lib/pulse/resolve-step-labels";
import {
  BUYER_STEP_LABEL,
  BUYER_STEP_PRIVATE_NOTE,
  SELLER_STEP_LABEL,
  TEST_APPROVED_EMAIL,
  TEST_BUYER_STEP_ID,
  TEST_SELLER_STEP_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

beforeAll(async () => {
  await seedLeakyWorkspace();
}, 60_000);

afterAll(async () => {
  await teardownLeakyWorkspace();
}, 30_000);

describe("resolveStepLabels", () => {
  it("resolves labels for known step ids and silently omits unknown ones", async () => {
    const client = createAdminClient();
    const labels = await resolveStepLabels(
      [TEST_BUYER_STEP_ID, TEST_SELLER_STEP_ID, "00000000-0000-4000-8000-000000000000"],
      client,
    );

    expect(labels.get(TEST_BUYER_STEP_ID)).toBe(BUYER_STEP_LABEL);
    expect(labels.get(TEST_SELLER_STEP_ID)).toBe(SELLER_STEP_LABEL);
    expect(labels.size).toBe(2);
  });

  it("returns an empty map for an empty input without querying", async () => {
    const client = createAdminClient();
    const labels = await resolveStepLabels([], client);

    expect(labels.size).toBe(0);
  });

  it("STEP_LABEL_SELECT is narrow at the wire level — never carries private_note or owner_email", async () => {
    // TEST_BUYER_STEP_ID carries both BUYER_STEP_PRIVATE_NOTE (private_note)
    // and TEST_APPROVED_EMAIL (owner_email) in the fixture — exactly the two
    // fields T36-3's own AC names as the risk of a select("*") here.
    const client = createAdminClient();
    const { data, error } = await client
      .from("plan_steps")
      .select(STEP_LABEL_SELECT)
      .eq("id", TEST_BUYER_STEP_ID)
      .single();

    expect(error).toBeNull();
    // Exactly the two columns the pulse feed needs — nothing else came back
    // over the wire, which is the guarantee a "select('*')" could not make.
    expect(Object.keys(data as object).sort()).toEqual(["id", "label"]);

    const raw = JSON.stringify(data);
    expect(raw).not.toContain(BUYER_STEP_PRIVATE_NOTE);
    expect(raw).not.toContain(TEST_APPROVED_EMAIL);
  });
});
