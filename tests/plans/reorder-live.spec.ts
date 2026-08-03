// T28-17 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Reorder tests
// against the real 0007 RPCs (reorder_plan_stages / reorder_plan_steps),
// through lib/plans/write.ts's reorderStages / reorderSteps wrappers.
//
// Covers, for BOTH RPCs where practical:
//   - happy path: reorders and returns rows in the new order
//   - a foreign/wrong-parent id mixed into the batch RAISES rather than being
//     silently dropped
//   - a short id set (missing a real member) RAISES
//   - a long id set (an extra, made-up id) RAISES
//   - display_order is UNCHANGED after any rejection
//
// reorder_plan_stages / reorder_plan_steps validate their entire input
// (duplicate check, then exact-set check) BEFORE the UPDATE statement runs at
// all (0007_plan_reorder.sql) — so "unchanged after rejection" is provable by
// a straight re-read, not by reasoning about a rolled-back partial write.

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reorderStages, reorderSteps, type PlanWriteClient } from "@/lib/plans/write";
import { requireTestEnv } from "../fixtures/env";
import {
  FOREIGN_STAGE_ID,
  TEST_BLOCKED_STEP_ID,
  TEST_BUYER_STEP_ID,
  TEST_DONE_STEP_ID,
  TEST_SELLER_STEP_ID,
  TEST_STAGE_ONE_ID,
  TEST_STAGE_TWO_ID,
  TEST_TIED_STEP_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

const env = requireTestEnv();
const NONEXISTENT_ID = "7e570000-0000-4000-8000-0000000000ff";

/** Mirrors tests/plans/queries.spec.ts's signInAsSeller. */
async function signInAsSeller(seeded: LeakyWorkspace): Promise<PlanWriteClient> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: seeded.ownerEmail,
    password: seeded.ownerPassword,
  });
  if (error) throw new Error(`seller sign-in failed: ${error.message}`);

  return client;
}

async function stageDisplayOrders(
  client: PlanWriteClient,
  ids: readonly string[],
): Promise<Record<string, number>> {
  const { data, error } = await client.from("plan_stages").select("id, display_order").in("id", ids);
  if (error) throw new Error(`stageDisplayOrders: ${error.message}`);
  return Object.fromEntries((data ?? []).map((row) => [row.id as string, row.display_order as number]));
}

async function stepDisplayOrders(
  client: PlanWriteClient,
  ids: readonly string[],
): Promise<Record<string, number>> {
  const { data, error } = await client.from("plan_steps").select("id, display_order").in("id", ids);
  if (error) throw new Error(`stepDisplayOrders: ${error.message}`);
  return Object.fromEntries((data ?? []).map((row) => [row.id as string, row.display_order as number]));
}

describe("reorder RPCs — real DB (T28-17)", () => {
  let seeded: LeakyWorkspace;
  let sellerClient: PlanWriteClient;

  beforeAll(async () => {
    await teardownLeakyWorkspace();
    seeded = await seedLeakyWorkspace();
    sellerClient = await signInAsSeller(seeded);
  });

  afterAll(async () => {
    await teardownLeakyWorkspace();
  });

  describe("reorder_plan_stages", () => {
    const realStageIds = [TEST_STAGE_ONE_ID, TEST_STAGE_TWO_ID];

    it("happy path: reorders and returns rows in the submitted order", async () => {
      const flipped = [TEST_STAGE_TWO_ID, TEST_STAGE_ONE_ID];
      const result = await reorderStages(seeded.planId, flipped, sellerClient);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => row.id)).toEqual(flipped);
      // array_position is 1-indexed but strictly increasing in submission
      // order — the specific base doesn't matter, the ordering does.
      expect(result.data[0].display_order).toBeLessThan(result.data[1].display_order);
    });

    it("a foreign plan's stage id mixed into the batch RAISES, not silently dropped", async () => {
      const before = await stageDisplayOrders(sellerClient, realStageIds);

      const result = await reorderStages(
        seeded.planId,
        [...realStageIds, FOREIGN_STAGE_ID],
        sellerClient,
      );

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stageDisplayOrders(sellerClient, realStageIds);
      expect(after).toEqual(before);
    });

    it("a short id set (missing a real member) RAISES", async () => {
      const before = await stageDisplayOrders(sellerClient, realStageIds);

      const result = await reorderStages(seeded.planId, [TEST_STAGE_ONE_ID], sellerClient);

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stageDisplayOrders(sellerClient, realStageIds);
      expect(after).toEqual(before);
    });

    it("a long id set (an extra, made-up id) RAISES", async () => {
      const before = await stageDisplayOrders(sellerClient, realStageIds);

      const result = await reorderStages(
        seeded.planId,
        [...realStageIds, NONEXISTENT_ID],
        sellerClient,
      );

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stageDisplayOrders(sellerClient, realStageIds);
      expect(after).toEqual(before);
    });

    it("display_order is unchanged immediately after a rejected call", async () => {
      const before = await stageDisplayOrders(sellerClient, realStageIds);

      const rejected = await reorderStages(seeded.planId, [TEST_STAGE_ONE_ID], sellerClient);
      expect(rejected.ok).toBe(false);

      const after = await stageDisplayOrders(sellerClient, realStageIds);
      expect(after).toEqual(before);
    });
  });

  describe("reorder_plan_steps", () => {
    // stage two's real step set per seed-leaky-workspace.ts.
    const realStepIds = [TEST_SELLER_STEP_ID, TEST_BUYER_STEP_ID, TEST_TIED_STEP_ID, TEST_BLOCKED_STEP_ID];

    it("happy path: reorders and returns rows in the submitted order", async () => {
      const reversed = [...realStepIds].reverse();
      const result = await reorderSteps(TEST_STAGE_TWO_ID, reversed, sellerClient);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => row.id)).toEqual(reversed);
    });

    it("a step belonging to a DIFFERENT stage mixed into the batch RAISES, not silently dropped", async () => {
      const before = await stepDisplayOrders(sellerClient, realStepIds);

      // TEST_DONE_STEP_ID is real, but belongs to TEST_STAGE_ONE_ID, not
      // TEST_STAGE_TWO_ID — the same "parent-scoped exact-set" check that
      // protects against a foreign TENANT's id also protects against a
      // same-tenant id from the wrong PARENT; there is no separate
      // cross-stage step under a foreign tenant in the fixture (the foreign
      // stage deliberately has zero steps), so this proves the identical
      // mechanism using a same-tenant wrong-parent id instead.
      const result = await reorderSteps(
        TEST_STAGE_TWO_ID,
        [...realStepIds, TEST_DONE_STEP_ID],
        sellerClient,
      );

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stepDisplayOrders(sellerClient, realStepIds);
      expect(after).toEqual(before);
    });

    it("a short id set (missing a real member) RAISES", async () => {
      const before = await stepDisplayOrders(sellerClient, realStepIds);

      const result = await reorderSteps(TEST_STAGE_TWO_ID, [TEST_SELLER_STEP_ID], sellerClient);

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stepDisplayOrders(sellerClient, realStepIds);
      expect(after).toEqual(before);
    });

    it("a long id set (an extra, made-up id) RAISES", async () => {
      const before = await stepDisplayOrders(sellerClient, realStepIds);

      const result = await reorderSteps(
        TEST_STAGE_TWO_ID,
        [...realStepIds, NONEXISTENT_ID],
        sellerClient,
      );

      expect(result).toEqual({ ok: false, code: "REORDER_SET_MISMATCH" });
      const after = await stepDisplayOrders(sellerClient, realStepIds);
      expect(after).toEqual(before);
    });

    it("display_order is unchanged immediately after a rejected call", async () => {
      const before = await stepDisplayOrders(sellerClient, realStepIds);

      const rejected = await reorderSteps(TEST_STAGE_TWO_ID, [TEST_SELLER_STEP_ID], sellerClient);
      expect(rejected.ok).toBe(false);

      const after = await stepDisplayOrders(sellerClient, realStepIds);
      expect(after).toEqual(before);
    });
  });
});
