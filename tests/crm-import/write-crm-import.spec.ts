// Sprint 10, Ticket 53 — behavioural coverage for
// lib/crm-import/write-crm-import.ts's writeCrmImport() and
// getAlreadyImportedExternalIds(). Live-Supabase spec (security project,
// serial), same reasoning as tests/import/import-deals.spec.ts (this
// module's own T45 precedent): the AC is about real inserts landing under
// RLS for the right tenant, a real partial-write rollback, and a real
// unique-index conflict on idx_workspaces_tenant_crm — no mock can stand in
// for any of the three.
//
// WRITTEN BUT NOT RUN in this session: the shared dev-Supabase test slot is
// busy with CI + a peer session (see MEMORY.md's ci_shared_dev_db_contention
// note). This file is complete and self-contained; run it in a coordinated
// slot with `npx vitest run tests/crm-import/write-crm-import.spec.ts`.
//
// Own dedicated fixture (provisioned inline below), mirroring
// tests/import/import-deals.spec.ts's local provisionTestSeller — this
// file's afterAll scans-and-deletes everything under its own
// freshly-provisioned tenant, never touching a concurrent session's rows.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import type { ValidatedCrmDeal } from "@/lib/crm-import/map-deal-to-workspace";
import {
  getAlreadyImportedExternalIds,
  writeCrmImport,
  type CrmDealPreWriteResult,
  type WriteCrmImportContext,
} from "@/lib/crm-import/write-crm-import";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-53-battery";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t53-hubspot-write-${runId}@example.com`;
  const companyName = `T53 hubspot import write ${runId}`;

  const result = await provisionSeller({ email, password: SELLER_PASSWORD, companyName });
  if (!result.ok) throw new Error(`provisionSeller failed: ${result.message}`);
  createdUserIds.push(result.userId);
  createdTenantIds.push(result.tenantId);
  return { tenantId: result.tenantId, userId: result.userId, email };
}

async function signInAsSeller(seller: SeededSeller): Promise<SupabaseClient> {
  const scoped = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
  const { error } = await scoped.auth.signInWithPassword({ email: seller.email, password: SELLER_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${seller.email}: ${error.message}`);
  return scoped;
}

/** Same FK-safe teardown order as tests/import/import-deals.spec.ts's teardownWorkspace. */
async function teardownWorkspace(workspaceId: string): Promise<void> {
  const { data: plans } = await admin.from("success_plans").select("id").eq("workspace_id", workspaceId);
  const planIds = (plans ?? []).map((row) => row.id as string);

  if (planIds.length > 0) {
    const { data: stages } = await admin.from("plan_stages").select("id").in("plan_id", planIds);
    const stageIds = (stages ?? []).map((row) => row.id as string);
    if (stageIds.length > 0) {
      await admin.from("plan_steps").delete().in("stage_id", stageIds);
    }
    await admin.from("plan_stages").delete().in("plan_id", planIds);
    await admin.from("success_plans").delete().in("id", planIds);
  }

  await admin.from("links").delete().eq("workspace_id", workspaceId);
  await admin.from("workspaces").delete().eq("id", workspaceId);
}

let sellerA: SeededSeller;
let sellerClient: SupabaseClient;
let context: WriteCrmImportContext;

beforeAll(async () => {
  sellerA = await provisionTestSeller();
  sellerClient = await signInAsSeller(sellerA);
  context = { tenantId: sellerA.tenantId, userId: sellerA.userId };
}, 60_000);

afterAll(async () => {
  try {
    const { data: workspaces } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
    for (const workspace of workspaces ?? []) {
      try {
        await teardownWorkspace(workspace.id as string);
      } catch (error: unknown) {
        // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
        console.error(`write-crm-import cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("write-crm-import cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("write-crm-import cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`write-crm-import cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

async function workspaceCountForTenant(): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
  return data?.length ?? 0;
}

async function workspaceByDomain(domain: string) {
  const { data } = await admin
    .from("workspaces")
    .select("id, target_company_name, target_domain, crm_source, crm_object_id, crm_stage, crm_amount, crm_close_date, approved_emails")
    .eq("tenant_id", sellerA.tenantId)
    .eq("target_domain", domain)
    .maybeSingle();
  return data;
}

function okDeal(
  externalId: string,
  overrides: Partial<ValidatedCrmDeal> = {},
): Extract<CrmDealPreWriteResult, { ok: true }> {
  return {
    externalId,
    ok: true,
    value: {
      externalId,
      companyName: `T53 ${externalId} — ${runId}`,
      companyDomain: `t53-${externalId}-${runId}.example.com`,
      contactEmail: `buyer-${externalId}-${runId}@example.com`,
      planTitle: `Rollout plan ${externalId}`,
      targetDate: "2099-01-01",
      stage: "appointmentscheduled",
      amount: 1500,
      ...overrides,
    },
  };
}

describe("writeCrmImport — happy path", () => {
  it("writes one workspace + success_plan per deal, with crm_* fields populated", async () => {
    const before = await workspaceCountForTenant();
    const deal = okDeal(`happy-${runId}`);

    const results = await writeCrmImport([deal], context, sellerClient);

    expect(results).toEqual([{ externalId: deal.externalId, ok: true }]);
    expect(await workspaceCountForTenant()).toBe(before + 1);

    const workspace = await workspaceByDomain(deal.value.companyDomain);
    expect(workspace?.target_company_name).toBe(deal.value.companyName);
    expect(workspace?.crm_source).toBe("hubspot");
    expect(workspace?.crm_object_id).toBe(deal.externalId);
    expect(workspace?.crm_stage).toBe("appointmentscheduled");
    expect(Number(workspace?.crm_amount)).toBe(1500);
    expect(workspace?.crm_close_date).toBe("2099-01-01");
    expect(workspace?.approved_emails).toEqual([deal.value.contactEmail]);

    const { data: plan } = await admin
      .from("success_plans")
      .select("title, target_date")
      .eq("workspace_id", workspace!.id)
      .maybeSingle();
    expect(plan?.title).toBe(deal.value.planTitle);
    expect(plan?.target_date).toBe("2099-01-01");
  });
});

describe("writeCrmImport — already-failed deals pass through unchanged", () => {
  it("never attempts a DB write for a deal that failed upstream (adapter fetch or content mapping)", async () => {
    const before = await workspaceCountForTenant();
    const failedDeal: CrmDealPreWriteResult = {
      externalId: "pre-failed",
      ok: false,
      reason: "invalid_data",
      message: "This deal's company has no domain in HubSpot and cannot be imported.",
    };

    const [result] = await writeCrmImport([failedDeal], context, sellerClient);

    expect(result).toBe(failedDeal);
    expect(await workspaceCountForTenant()).toBe(before);
  });
});

describe("writeCrmImport — one deal's failure never aborts another", () => {
  it("mixed batch: one already-failed deal + one good deal -> the good deal is still written", async () => {
    const before = await workspaceCountForTenant();
    const goodDeal = okDeal(`mixed-${runId}`);
    const failedDeal: CrmDealPreWriteResult = {
      externalId: "mixed-pre-failed",
      ok: false,
      reason: "invalid_data",
      message: "bad",
    };

    const results = await writeCrmImport([failedDeal, goodDeal], context, sellerClient);

    expect(results[0]).toBe(failedDeal);
    expect(results[1]).toEqual({ externalId: goodDeal.externalId, ok: true });
    expect(await workspaceCountForTenant()).toBe(before + 1);
  });
});

describe("writeCrmImport — idx_workspaces_tenant_crm 23505 backstop (SETTLED decision)", () => {
  it("re-importing the same externalId a second time fails as 'already imported', not a generic error", async () => {
    const deal = okDeal(`dup-${runId}`);

    const [first] = await writeCrmImport([deal], context, sellerClient);
    expect(first).toEqual({ externalId: deal.externalId, ok: true });

    const before = await workspaceCountForTenant();
    const [second] = await writeCrmImport([deal], context, sellerClient);

    expect(second).toEqual({
      externalId: deal.externalId,
      ok: false,
      reason: "invalid_data",
      message: "This deal has already been imported.",
    });
    // No orphan workspace from the failed second attempt.
    expect(await workspaceCountForTenant()).toBe(before);
  });
});

describe("getAlreadyImportedExternalIds", () => {
  it("returns the set of crm_object_id already imported under this tenant, and nothing else", async () => {
    const deal = okDeal(`already-imported-${runId}`);
    await writeCrmImport([deal], context, sellerClient);

    const result = await getAlreadyImportedExternalIds(sellerA.tenantId, sellerClient);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ids.has(deal.externalId)).toBe(true);
    expect(result.ids.has("never-imported-id")).toBe(false);
  });

  // Code review (HIGH, code): this used to throw on any non-23505 query
  // error; both hubspot-import-actions.ts call sites awaited it unguarded,
  // so an uncaught exception here would have crashed the whole server
  // action. Now returns a typed ok:false result instead — asserted here
  // with a real Postgres error (an invalid uuid literal for the uuid-typed
  // tenant_id column, sqlstate 22P02), not a mock.
  it("returns ok:false with a message, never throws, when the underlying query errors", async () => {
    const result = await getAlreadyImportedExternalIds("not-a-uuid", sellerClient);

    expect(result).toEqual({
      ok: false,
      message: "Could not check which deals were already imported. Please try again.",
    });
  });
});
