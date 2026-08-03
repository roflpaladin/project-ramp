// T28-14 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Layer B —
// module-level behavioural tests against lib/plans/write.ts's injectable-
// client pattern (mirrors tests/plans/queries.spec.ts's signInAsSeller
// helper, and reuses tests/fixtures/seed-leaky-workspace.ts's already-
// provisioned foreign tenant rather than standing up a second one).
//
// A note on "no client → UNAUTHENTICATED": write.ts's own header comment
// states the default constructor (createSellerClient(), i.e.
// lib/supabase/server.ts's createClient()) "throws outside a request
// context" — confirmed directly below. errors.ts's own header comment is
// explicit that UNAUTHENTICATED "never comes out of this module —
// require-seller.ts produces it before a Postgres call is even made." So a
// PlanActionResult of { ok:false, code:"UNAUTHENTICATED" } is structurally
// unreachable from write.ts itself; that code is produced one layer up, by
// plan-actions.ts's `requireSeller()` check, never by write.ts. This
// suite's "no client" case therefore asserts the actual failure-closed
// behaviour (a thrown error, never a silent success) rather than a
// PlanActionResult shape write.ts cannot produce — see that test's comment
// for the concrete reasoning, and this file's own QA report for the
// discrepancy against the ticket's literal wording.

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { updatePlan, updateStage, updateStep, createStep, type PlanWriteClient } from "@/lib/plans/write";
import { requireTestEnv } from "../fixtures/env";
import {
  FOREIGN_PLAN_ID,
  FOREIGN_STAGE_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

const env = requireTestEnv();

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

/** A genuinely anonymous client — no session at all, just the anon key. */
function anonClient(): PlanWriteClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("lib/plans/write.ts — Layer B behavioural tests (T28-14)", () => {
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

  describe("no client", () => {
    it("throws rather than silently succeeding or returning a PlanActionResult", async () => {
      // write.ts's resolveClient() falls back to createSellerClient() (=
      // lib/supabase/server.ts's createClient()), which calls next/headers's
      // cookies() — unavailable outside a real Next.js request context, so
      // this throws a Next.js invariant rather than resolving to any client
      // at all. This is the CORRECT failure-closed behaviour for a call
      // pattern no production caller uses (plan-actions.ts always passes
      // session.client from requireSeller()) — but it means the call never
      // reaches Postgres, so it cannot produce { ok:false,
      // code:"UNAUTHENTICATED" }, a PlanActionResult write.ts's own error
      // mapper (errors.ts) documents as never originating in this module.
      await expect(
        updateStage(seeded.stageIds[0], { title: "should never apply" }),
      ).rejects.toThrow(/request scope|cookies/i);
    });
  });

  describe("anon client (unauthenticated, no session)", () => {
    it("updateStage against the seller's own stage returns NOT_FOUND — zero rows affected by RLS", async () => {
      const result = await updateStage(
        seeded.stageIds[0],
        { title: "anon should never apply this" },
        anonClient(),
      );
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("updatePlan against the seller's own plan returns NOT_FOUND — zero rows affected by RLS", async () => {
      const result = await updatePlan(seeded.planId, { title: "anon should never apply this" }, anonClient());
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("updateStep against the seller's own step returns NOT_FOUND — zero rows affected by RLS", async () => {
      const result = await updateStep(seeded.sellerStepId, { label: "anon should never apply this" }, anonClient());
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("createStep under the seller's own stage returns NOT_FOUND, never FORBIDDEN — RLS with-check rejects the insert", async () => {
      const result = await createStep(
        { stage_id: seeded.stageIds[0], label: "anon should never be created", owner_side: "seller" },
        anonClient(),
      );
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
      // Structural guarantee that the mapping never leaks a 403-shaped code
      // (errors.ts's 42501 branch: "Never 403 ... the same enumeration leak
      // the buyer-boundary work exists to prevent").
      if (!result.ok) expect(result.code).not.toBe("FORBIDDEN" as never);
    });
  });

  describe("a client signed in as the fixture's AE, targeting the FOREIGN tenant's resources", () => {
    // T28-14's spec names "a client signed in as the foreign tenant's AE".
    // seed-leaky-workspace.ts provisions only ONE real signed-in credential
    // (seeded.ownerEmail / seeded.ownerPassword, for TEST_TENANT_ID) — the
    // foreign tenant's workspace/plan/stage are seeded WITHOUT a distinct AE
    // on purpose, per the fixture's own comment: "created_by reuses the same
    // auth user because created_by grants nothing — every policy keys off
    // workspaces.tenant_id, so this workspace stays invisible to the AE
    // above." That is exactly this scenario in reverse: the fixture's only
    // real seller identity, aimed at the OTHER tenant's rows. RLS keys
    // exclusively on tenant_id, never created_by, so which side initiates
    // the cross-tenant write is immaterial to what's being proven here — see
    // this file's QA report for the wording note.
    it("updateStage against a foreign-plan stage returns NOT_FOUND, never FORBIDDEN", async () => {
      const result = await updateStage(FOREIGN_STAGE_ID, { title: "should never apply" }, sellerClient);
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("updatePlan against the foreign plan returns NOT_FOUND, never FORBIDDEN", async () => {
      const result = await updatePlan(FOREIGN_PLAN_ID, { title: "should never apply" }, sellerClient);
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });

    it("createStep under a foreign-plan stage returns NOT_FOUND, never FORBIDDEN", async () => {
      const result = await createStep(
        { stage_id: FOREIGN_STAGE_ID, label: "should never be created", owner_side: "seller" },
        sellerClient,
      );
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    });
  });
});
