// T28-16 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Provokes each
// of the three named constraints in lib/plans/constraints.ts FOR REAL against
// Supabase — a raw insert/update through a signed-in seller client, bypassing
// lib/plans/validate.ts's TypeScript pre-validator entirely — then feeds the
// real PostgrestError straight through mapPostgrestError (lib/plans/errors.ts)
// and asserts the resulting { code, status }, never the raw Postgres text.
//
// This is deliberately NOT tests/plans/errors.spec.ts (BE's 18 pure unit
// tests against synthetic PostgrestError-shaped objects — do not overwrite
// that file). The point here is different: if a future migration renames one
// of these constraints, errors.spec.ts's synthetic fixtures would still pass
// (they hardcode the OLD name), while this file's real DB round trip would
// start seeing UNKNOWN_ERROR / 500 for a genuine user-facing case like an
// out-of-order date range — catching in CI exactly the "degrades to a 500
// during the pilot" failure mode T28-16 exists to prevent.

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mapPostgrestError, type PostgrestErrorLike } from "@/lib/plans/errors";
import type { PlanWriteClient } from "@/lib/plans/write";
import { requireTestEnv } from "../fixtures/env";
import {
  TEST_STAGE_TWO_ID,
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

describe("real constraint provocation against Supabase (T28-16)", () => {
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

  it("idx_success_plans_one_live_per_workspace -> PLAN_ALREADY_LIVE / 409", async () => {
    // seedLeakyWorkspace() already left an 'active' plan on seeded.workspaceId
    // (TEST_PLAN_ID) — inserting a second draft/active plan for the SAME
    // workspace, through the raw client with no pre-validation, is exactly
    // what the partial unique index exists to reject.
    const { error } = await sellerClient
      .from("success_plans")
      .insert({ workspace_id: seeded.workspaceId, title: "a second live plan", status: "draft" });

    expect(error).not.toBeNull();
    const mapped = mapPostgrestError(error as PostgrestErrorLike);
    expect(mapped).toEqual({ code: "PLAN_ALREADY_LIVE", status: 409 });
  });

  it("success_plans_date_order (target_date < start_date) -> INVALID_DATE_RANGE / 400", async () => {
    // seeded.emptyWorkspaceId carries no plan at all (seed-leaky-workspace.ts
    // keeps it bare on purpose), so this can't collide with the uniqueness
    // constraint above — isolates the date-order CHECK as the only
    // constraint in play.
    const { error } = await sellerClient.from("success_plans").insert({
      workspace_id: seeded.emptyWorkspaceId,
      title: "backwards date range",
      start_date: "2026-06-01",
      target_date: "2026-01-01",
    });

    expect(error).not.toBeNull();
    const mapped = mapPostgrestError(error as PostgrestErrorLike);
    expect(mapped).toEqual({ code: "INVALID_DATE_RANGE", status: 400 });
  });

  it("plan_steps_completion_coherent (status='done' without completed_at) -> INCOHERENT_COMPLETION / 500", async () => {
    const { error } = await sellerClient.from("plan_steps").insert({
      stage_id: TEST_STAGE_TWO_ID,
      label: "done but never actually completed",
      owner_side: "seller",
      status: "done",
      // completed_at omitted entirely — (status = 'done') = (completed_at is
      // not null) fails on the right-hand side.
    });

    expect(error).not.toBeNull();
    const mapped = mapPostgrestError(error as PostgrestErrorLike);
    expect(mapped).toEqual({ code: "INCOHERENT_COMPLETION", status: 500 });
  });
});
