// Ticket 24 — the two plan read paths.
//
// The point of this suite is the asymmetry between them:
//   getPlanForSeller  -> RLS-scoped. Another tenant's workspace is invisible.
//   getPlanForBuyer   -> service-role. Every workspace is visible, private_note
//                        included, BY DESIGN.
//
// The second is asserted explicitly rather than left implicit. It looks like a
// leak and is not: buyers hold no Supabase session, so no RLS policy could scope
// this read. The boundary is lib/portal-payload.ts (Ticket 25). Documenting the
// behaviour here means the next person meets it as a decision rather than
// discovering it while debugging.

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPlanForBuyer, getPlanForSeller, type PlanReadClient } from "@/lib/plans/queries";
import { requireTestEnv } from "../fixtures/env";
import {
  TEST_BLOCKED_STEP_ID,
  TEST_BUYER_STEP_ID,
  TEST_SELLER_STEP_ID,
  TEST_STAGE_ONE_ID,
  TEST_STAGE_TWO_ID,
  TEST_TIED_STEP_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

const env = requireTestEnv();

/**
 * A client that RLS actually applies to.
 *
 * The service-role client cannot demonstrate RLS working — it bypasses it. This
 * signs in as the fixture's AE, whose app_metadata.tenant_id claim is what every
 * policy in 0001-0005 reads.
 */
async function signInAsSeller(seeded: LeakyWorkspace): Promise<PlanReadClient> {
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

describe("plan read paths", () => {
  let seeded: LeakyWorkspace;
  let sellerClient: PlanReadClient;

  beforeAll(async () => {
    await teardownLeakyWorkspace();
    seeded = await seedLeakyWorkspace();
    sellerClient = await signInAsSeller(seeded);
  });

  afterAll(async () => {
    await teardownLeakyWorkspace();
  });

  describe("getPlanForSeller", () => {
    // Guards every RLS assertion below. If the tenant_id claim were missing or
    // wrong, the seller would see nothing at all and "returns null for a foreign
    // workspace" would pass while proving nothing.
    it("returns the plan for a workspace in the seller's own tenant", async () => {
      const plan = await getPlanForSeller(seeded.workspaceId, sellerClient);

      expect(plan).not.toBeNull();
      expect(plan?.id).toBe(seeded.planId);
      expect(plan?.workspace_id).toBe(seeded.workspaceId);
    });

    it("returns null for a workspace in another tenant — RLS holds", async () => {
      const plan = await getPlanForSeller(seeded.foreignWorkspaceId, sellerClient);
      expect(plan).toBeNull();
    });

    it("returns private_note — stripping is Ticket 25's job, not this layer's", async () => {
      const plan = await getPlanForSeller(seeded.workspaceId, sellerClient);
      const sellerStep = plan?.stages
        .flatMap((stage) => stage.steps)
        .find((step) => step.id === TEST_SELLER_STEP_ID);

      expect(sellerStep?.private_note).toBeTruthy();
    });
  });

  describe("getPlanForBuyer", () => {
    it("returns the plan for the buyer's own workspace", async () => {
      const plan = await getPlanForBuyer(seeded.workspaceId);

      expect(plan).not.toBeNull();
      expect(plan?.id).toBe(seeded.planId);
    });

    it("returns a plan for ANY workspace id — RLS bypassed by design", async () => {
      // The same id getPlanForSeller correctly refused above. Not a leak:
      // service-role has no session to scope, and the portal routes call this
      // only after validating the per-workspace portal session cookie.
      const plan = await getPlanForBuyer(seeded.foreignWorkspaceId);

      expect(plan).not.toBeNull();
      expect(plan?.id).toBe(seeded.foreignPlanId);
    });

    it("returns raw, unfiltered rows including private_note", async () => {
      const plan = await getPlanForBuyer(seeded.workspaceId);
      const sellerStep = plan?.stages
        .flatMap((stage) => stage.steps)
        .find((step) => step.id === TEST_SELLER_STEP_ID);

      expect(sellerStep?.private_note).toBeTruthy();
    });
  });

  describe("tree assembly", () => {
    it("orders stages by display_order", async () => {
      const plan = await getPlanForBuyer(seeded.workspaceId);

      expect(plan?.stages.map((stage) => stage.id)).toEqual([
        TEST_STAGE_ONE_ID,
        TEST_STAGE_TWO_ID,
      ]);
    });

    it("orders steps by display_order, breaking ties on id", async () => {
      const plan = await getPlanForBuyer(seeded.workspaceId);
      const stageTwo = plan?.stages.find((stage) => stage.id === TEST_STAGE_TWO_ID);

      // TEST_BUYER_STEP_ID (…0007) and TEST_TIED_STEP_ID (…000a) both sit at
      // display_order 1. Without the id tiebreak their relative order would be
      // whatever PostgREST happened to return, and could differ between loads.
      expect(stageTwo?.steps.map((step) => step.id)).toEqual([
        TEST_SELLER_STEP_ID,
        TEST_BUYER_STEP_ID,
        TEST_TIED_STEP_ID,
        TEST_BLOCKED_STEP_ID,
      ]);
    });

    it("assembles a plan whose stage has no steps, without error", async () => {
      const plan = await getPlanForBuyer(seeded.foreignWorkspaceId);

      expect(plan?.stages).toHaveLength(1);
      expect(plan?.stages[0].steps).toEqual([]);
    });

    it("produces an identical tree on both paths — one shared assembly helper", async () => {
      const asSeller = await getPlanForSeller(seeded.workspaceId, sellerClient);
      const asBuyer = await getPlanForBuyer(seeded.workspaceId);

      expect(asSeller).toEqual(asBuyer);
    });
  });

  describe("a workspace with no plan", () => {
    // Read from a workspace that genuinely exists but has no plan, not from a
    // nonexistent id — otherwise null would come back for the wrong reason.
    it("returns null rather than throwing, on the seller path", async () => {
      await expect(getPlanForSeller(seeded.emptyWorkspaceId, sellerClient)).resolves.toBeNull();
    });

    it("returns null rather than throwing, on the buyer path", async () => {
      await expect(getPlanForBuyer(seeded.emptyWorkspaceId)).resolves.toBeNull();
    });
  });
});
