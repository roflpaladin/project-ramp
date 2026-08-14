// T34-1 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7).
//
// Proves lib/portal/load-buyer-payload.ts: the single loader both buyer
// surfaces call after their own gate has granted access. Runs against the
// real Ticket 23 fixture on real Supabase — same convention as
// tests/plans/queries.spec.ts and tests/plans/portal-payload.spec.ts, which
// this file composes.

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBuyerPayload } from "@/lib/portal/load-buyer-payload";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanReadClient } from "@/lib/plans/queries";
import { requireTestEnv } from "../fixtures/env";
import {
  PRIVATE_LINK_URLS,
  SELLER_STEP_LABEL,
  TEST_SELLER_STEP_ID,
  forbiddenValuesFor,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

const env = requireTestEnv();

// Fixed, never seeded, so a lookup for it can only ever return "does not
// exist" — mirrors tests/security/buyer-boundary.spec.ts's convention.
const NONEXISTENT_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000ed";

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

describe("loadBuyerPayload", () => {
  let seeded: LeakyWorkspace;

  beforeAll(async () => {
    await teardownLeakyWorkspace();
    seeded = await seedLeakyWorkspace();
  });

  afterAll(async () => {
    await teardownLeakyWorkspace();
  });

  it("loads the boundary-stripped workspace, its live plan tree, and shared resources", async () => {
    const payload = await loadBuyerPayload(seeded.workspaceId);

    expect(payload).not.toBeNull();
    expect(payload?.workspace.id).toBe(seeded.workspaceId);
    expect(payload?.resources).toHaveLength(3);

    // The plan tree is real, not the hard-coded `null` both prior loaders
    // shipped with — this is the actual behaviour change T34-1 exists for.
    expect(payload?.plan?.id).toBe(seeded.planId);
    const sellerStep = payload?.plan?.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.id === TEST_SELLER_STEP_ID);
    expect(sellerStep?.label).toBe(SELLER_STEP_LABEL);

    for (const privateUrl of PRIVATE_LINK_URLS) {
      expect(JSON.stringify(payload)).not.toContain(privateUrl);
    }
    for (const forbidden of forbiddenValuesFor(seeded)) {
      expect(JSON.stringify(payload)).not.toContain(forbidden);
    }
  });

  it("returns null for a workspace that does not exist", async () => {
    await expect(loadBuyerPayload(NONEXISTENT_WORKSPACE_ID)).resolves.toBeNull();
  });

  it("returns null for a workspace with no live plan, rather than throwing", async () => {
    const payload = await loadBuyerPayload(seeded.emptyWorkspaceId);

    expect(payload).not.toBeNull();
    expect(payload?.plan).toBeNull();
  });

  describe("requireTenantId — /view's demo-tenant scope, expressed without a branch", () => {
    it("returns the payload when the workspace belongs to the required tenant", async () => {
      const payload = await loadBuyerPayload(seeded.workspaceId, { requireTenantId: seeded.tenantId });
      expect(payload).not.toBeNull();
    });

    it("returns null when the workspace belongs to a DIFFERENT tenant", async () => {
      const payload = await loadBuyerPayload(seeded.foreignWorkspaceId, { requireTenantId: seeded.tenantId });
      expect(payload).toBeNull();
    });

    it("returns the identical null for 'not found' and 'wrong tenant' — no oracle", async () => {
      const notFound = await loadBuyerPayload(NONEXISTENT_WORKSPACE_ID, { requireTenantId: seeded.tenantId });
      const wrongTenant = await loadBuyerPayload(seeded.foreignWorkspaceId, { requireTenantId: seeded.tenantId });

      expect(notFound).toBeNull();
      expect(wrongTenant).toBeNull();
      expect(notFound).toBe(wrongTenant);
    });
  });

  describe("the injectable client", () => {
    it("is actually used, not merely accepted — an RLS-scoped client sees only its own tenant", async () => {
      const sellerClient = await signInAsSeller(seeded);

      // The seller's own workspace, read through their RLS-scoped client.
      const own = await loadBuyerPayload(seeded.workspaceId, { client: sellerClient });
      expect(own).not.toBeNull();
      expect(own?.plan?.id).toBe(seeded.planId);

      // A foreign tenant's workspace: RLS makes it invisible to this client,
      // so the initial workspace lookup itself returns no row — proving the
      // `client` option is threaded through, not silently ignored in favour
      // of the default service-role client (which would see it and return a
      // payload here).
      const foreign = await loadBuyerPayload(seeded.foreignWorkspaceId, { client: sellerClient });
      expect(foreign).toBeNull();
    });
  });

  describe("analytics", () => {
    it("never writes a workspace_analytics row", async () => {
      const db = createAdminClient();
      const before = await db
        .from("workspace_analytics")
        .select("id")
        .eq("workspace_id", seeded.workspaceId);

      await loadBuyerPayload(seeded.workspaceId);

      const after = await db
        .from("workspace_analytics")
        .select("id")
        .eq("workspace_id", seeded.workspaceId);

      expect(after.data?.length ?? 0).toBe(before.data?.length ?? 0);
    });
  });
});
