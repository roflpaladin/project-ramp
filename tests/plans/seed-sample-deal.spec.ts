// Sprint 8, Ticket 42 — sample-deal seed engine. Live-Supabase spec (security
// project, serial): the AC is "a fresh self-serve seller gets a complete
// skeleton deal in <10s", which is a claim about real inserts against real
// constraints (migration 0005's stage/step CHECKs) landing under RLS for the
// right tenant only — no mock can stand in for any of that.
//
// Two provisioned sellers (via lib/auth/provision-seller.ts, Ticket 39) are
// the fixture: sellerA is the one seedSampleDeal runs for, sellerB exists
// solely as the foreign-tenant RLS control. All rows are tracked as created
// and cleaned up in afterAll, resiliently — this suite shares the dev
// Supabase project with concurrent Sprint 8 work.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { seedSampleDeal, type SeedSampleDealResult } from "@/lib/seed/sample-deal";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false },
});

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-42-battery";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

let sellerA: SeededSeller;
let sellerB: SeededSeller;

// Set once the first seedSampleDeal call for sellerA completes — several
// `it`s below assert different facets of that ONE seeded deal rather than
// re-seeding per assertion, mirroring tests/security/tenant-isolation-matrix
// .spec.ts's beforeAll-fixture-then-many-its shape.
let dealA1: SeedSampleDealResult;
let elapsedMs = 0;

// Every deal seeded during this run (workspaceId + planId), so afterAll can
// tear each one down individually regardless of which `it` created it.
const createdDeals: Array<{ workspaceId: string; planId: string }> = [];
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(label: "a" | "b"): Promise<SeededSeller> {
  const email = `t42-seller-${label}-${runId}@example.com`;
  const companyName = `T42 seed-deal ${label} ${runId}`;

  const result = await provisionSeller({ email, password: SELLER_PASSWORD, companyName });
  if (!result.ok) {
    throw new Error(`provisionSeller failed for seller ${label}: ${result.message}`);
  }
  createdUserIds.push(result.userId);
  createdTenantIds.push(result.tenantId);
  return { tenantId: result.tenantId, userId: result.userId, email };
}

async function signInAsSeller(seller: SeededSeller): Promise<SupabaseClient> {
  const scoped = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false },
  });
  const { error } = await scoped.auth.signInWithPassword({
    email: seller.email,
    password: SELLER_PASSWORD,
  });
  if (error) throw new Error(`sign-in failed for ${seller.email}: ${error.message}`);
  return scoped;
}

beforeAll(async () => {
  sellerA = await provisionTestSeller("a");
  sellerB = await provisionTestSeller("b");

  const startedAt = Date.now();
  dealA1 = await seedSampleDeal({ tenantId: sellerA.tenantId, userId: sellerA.userId });
  elapsedMs = Date.now() - startedAt;

  if (dealA1.ok) {
    createdDeals.push({ workspaceId: dealA1.workspaceId, planId: dealA1.planId });
  }
}, 60_000);

afterAll(async () => {
  // FK-safe order per deal: plan_steps -> plan_stages -> success_plans ->
  // links -> workspaces. Each step independently try/caught so one failure
  // cannot strand the rest (links has no ON DELETE CASCADE from workspaces —
  // migration 0001 — so it must be cleared before the workspace delete, not
  // relied on to cascade).
  for (const { workspaceId, planId } of createdDeals) {
    const { data: stages } = await admin.from("plan_stages").select("id").eq("plan_id", planId);
    const stageIds = (stages ?? []).map((row) => row.id as string);

    const steps: Array<[string, () => PromiseLike<unknown>]> = [
      ["plan_steps", () => admin.from("plan_steps").delete().in("stage_id", stageIds.length ? stageIds : [""])],
      ["plan_stages", () => admin.from("plan_stages").delete().eq("plan_id", planId)],
      ["success_plans", () => admin.from("success_plans").delete().eq("id", planId)],
      ["links", () => admin.from("links").delete().eq("workspace_id", workspaceId)],
      ["workspaces", () => admin.from("workspaces").delete().eq("id", workspaceId)],
    ];

    for (const [label, run] of steps) {
      try {
        await run();
      } catch (error: unknown) {
        // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
        console.error(`seed-sample-deal cleanup — ${label} (${workspaceId}) failed:`, error);
      }
    }
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("seed-sample-deal cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`seed-sample-deal cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

describe("seedSampleDeal", () => {
  it("seeds a complete skeleton deal: workspace, plan, 5 stages, 8 steps, 3 links", async () => {
    expect(dealA1.ok).toBe(true);
    if (!dealA1.ok) return;

    const { data: workspace } = await admin
      .from("workspaces")
      .select("id, tenant_id, target_company_name, target_domain, created_by, approved_emails")
      .eq("id", dealA1.workspaceId)
      .single();
    expect(workspace?.tenant_id).toBe(sellerA.tenantId);
    expect(workspace?.created_by).toBe(sellerA.userId);
    expect(workspace?.approved_emails).toEqual([]);

    const { data: plan } = await admin
      .from("success_plans")
      .select("id, workspace_id, status")
      .eq("id", dealA1.planId)
      .single();
    expect(plan?.workspace_id).toBe(dealA1.workspaceId);
    expect(plan?.status).toBe("active");

    const { data: stages } = await admin
      .from("plan_stages")
      .select("id, status")
      .eq("plan_id", dealA1.planId);
    expect(stages).toHaveLength(5);
    expect(stages?.filter((s) => s.status === "current")).toHaveLength(1);

    const stageIds = (stages ?? []).map((s) => s.id);
    const { data: steps } = await admin
      .from("plan_steps")
      .select("status, completed_at")
      .in("stage_id", stageIds);
    expect(steps).toHaveLength(8);
    for (const step of steps ?? []) {
      if (step.status === "done") {
        expect(step.completed_at).not.toBeNull();
      } else {
        expect(step.completed_at).toBeNull();
      }
    }

    const { data: links } = await admin
      .from("links")
      .select("id, visibility")
      .eq("workspace_id", dealA1.workspaceId);
    expect(links).toHaveLength(3);
    expect(links?.every((l) => l.visibility === "shared")).toBe(true);
  });

  it("completes in under 10 seconds", () => {
    expect(dealA1.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it("the owning seller's RLS-scoped client can read the seeded workspace and plan; a foreign tenant's cannot", async () => {
    expect(dealA1.ok).toBe(true);
    if (!dealA1.ok) return;

    const scopedA = await signInAsSeller(sellerA);
    const { data: wsA } = await scopedA.from("workspaces").select("id").eq("id", dealA1.workspaceId);
    expect(wsA).toHaveLength(1);
    const { data: planA } = await scopedA.from("success_plans").select("id").eq("id", dealA1.planId);
    expect(planA).toHaveLength(1);
    await scopedA.auth.signOut();

    const scopedB = await signInAsSeller(sellerB);
    const { data: wsB } = await scopedB.from("workspaces").select("id").eq("id", dealA1.workspaceId);
    expect(wsB).toHaveLength(0);
    const { data: planB } = await scopedB.from("success_plans").select("id").eq("id", dealA1.planId);
    expect(planB).toHaveLength(0);
    await scopedB.auth.signOut();
  });

  it("two calls for the same tenant yield two distinct workspaceIds, both present", async () => {
    const dealA2 = await seedSampleDeal({ tenantId: sellerA.tenantId, userId: sellerA.userId });
    expect(dealA2.ok).toBe(true);
    if (!dealA2.ok) return;
    createdDeals.push({ workspaceId: dealA2.workspaceId, planId: dealA2.planId });

    expect(dealA1.ok).toBe(true);
    if (!dealA1.ok) return;
    expect(dealA2.workspaceId).not.toBe(dealA1.workspaceId);

    const { data: workspaces } = await admin
      .from("workspaces")
      .select("id")
      .in("id", [dealA1.workspaceId, dealA2.workspaceId]);
    expect(workspaces).toHaveLength(2);
  });

  it("seller-side steps carry the seller's real email; buyer-side steps never do", async () => {
    expect(dealA1.ok).toBe(true);
    if (!dealA1.ok) return;

    const { data: stages } = await admin.from("plan_stages").select("id").eq("plan_id", dealA1.planId);
    const stageIds = (stages ?? []).map((s) => s.id);
    const { data: steps } = await admin
      .from("plan_steps")
      .select("owner_side, owner_email")
      .in("stage_id", stageIds);

    const sellerSteps = (steps ?? []).filter((s) => s.owner_side === "seller");
    const buyerSteps = (steps ?? []).filter((s) => s.owner_side === "buyer");
    expect(sellerSteps).toHaveLength(4);
    expect(buyerSteps).toHaveLength(4);

    for (const step of sellerSteps) {
      expect(step.owner_email).toBe(sellerA.email);
    }
    for (const step of buyerSteps) {
      expect(step.owner_email).not.toBe(sellerA.email);
      expect(step.owner_email).toContain("meridian-retail.example.com");
    }
  });

  it("refuses a (tenantId, userId) pair that doesn't match the user's own claim", async () => {
    // Service-role write primitive: a mismatched pair would seed a workspace
    // into someone ELSE's tenant. The user's app_metadata claim is the
    // authority; the engine must refuse rather than trust the caller.
    const result = await seedSampleDeal({ tenantId: sellerB.tenantId, userId: sellerA.userId });
    expect(result.ok).toBe(false);

    const { data: intruded } = await admin
      .from("workspaces")
      .select("id")
      .eq("tenant_id", sellerB.tenantId)
      .eq("created_by", sellerA.userId);
    expect(intruded).toHaveLength(0);
  });
});
