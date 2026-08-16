// Sprint 8, Ticket 41 — guided first-run onboarding. Behavioural coverage for
// app/admin/onboarding/onboarding-actions.ts's two server actions. Mirrors
// tests/security/invite-actions.spec.ts's mocking strategy (that file's
// header comment is the canonical explanation, repeated in short form here):
//
// - next/navigation's redirect() is mocked to a recorder that throws a
//   sentinel, because redirect() throws NEXT_REDIRECT outside a real Next.js
//   request/render context — the sentinel lets `await expect(...).rejects
//   .toBe(redirectSentinel)` assert a redirect happened without depending on
//   Next's internal error shape.
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts, T39) — only the identity requireSeller()
//   resolves to is faked; every RLS/Postgres decision this suite asserts on
//   (tenant-scoped inserts, RLS-refused cross-tenant inserts) is the
//   database's real answer. next/headers/next/cache are NOT mocked here,
//   unlike invite-actions.spec.ts — onboarding-actions.ts imports neither.
//
// Own dedicated fixture (provisioned inline below, mirroring
// tests/plans/seed-sample-deal.spec.ts's provisionTestSeller local helper),
// not a shared one — this file's afterAll must never touch rows a concurrent
// session's suite may depend on. Every workspace/plan row this suite creates
// lives under this run's own freshly-provisioned tenant, so cleanup can
// simply scan-and-delete everything under that tenant_id rather than tracking
// each row one at a time.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import type { SellerSession } from "@/lib/plans/require-seller";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createAdminClient();

const { redirectSentinel, redirectCalls, currentSellerSession } = vi.hoisted(() => ({
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectCalls: [] as string[],
  currentSellerSession: { value: null as SellerSession | null },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

const { startWithSampleDeal, createFirstWorkspace } = await import("@/app/admin/onboarding/onboarding-actions");
const { INITIAL_ONBOARDING_STATE } = await import("@/app/admin/onboarding/onboarding-state");

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-41-battery";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t41-onboarding-${runId}@example.com`;
  const companyName = `T41 onboarding ${runId}`;

  const result = await provisionSeller({ email, password: SELLER_PASSWORD, companyName });
  if (!result.ok) {
    throw new Error(`provisionSeller failed: ${result.message}`);
  }
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

/** FK-safe teardown for a single workspace, mirroring seed-sample-deal.spec.ts's cleanup order: plan_steps -> plan_stages -> success_plans -> links -> workspaces. A manually-created workspace has no plan, so those steps are simply no-ops for it. */
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

beforeAll(async () => {
  sellerA = await provisionTestSeller();
  sellerClient = await signInAsSeller(sellerA);
}, 60_000);

afterAll(async () => {
  try {
    const { data: workspaces } = await admin
      .from("workspaces")
      .select("id")
      .in("tenant_id", createdTenantIds.length > 0 ? createdTenantIds : [""]);
    for (const workspace of workspaces ?? []) {
      try {
        await teardownWorkspace(workspace.id as string);
      } catch (error: unknown) {
        // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
        console.error(`onboarding-actions cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("onboarding-actions cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("onboarding-actions cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`onboarding-actions cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

beforeEach(() => {
  redirectCalls.length = 0;
  currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: sellerA.tenantId };
});

function formDataFor(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

function workspaceIdFromRedirect(path: string): string {
  const match = path.match(/^\/admin\/workspaces\/(.+)$/);
  if (!match) throw new Error(`unexpected redirect path: ${path}`);
  return match[1];
}

async function workspaceCountForTenant(tenantId: string): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", tenantId);
  return data?.length ?? 0;
}

async function workspaceRow(workspaceId: string) {
  const { data } = await admin
    .from("workspaces")
    .select("id, tenant_id, created_by, target_company_name, target_domain")
    .eq("id", workspaceId)
    .single();
  return data;
}

describe("onboarding-actions — unauthenticated (T41)", () => {
  it("startWithSampleDeal redirects to /admin/login and writes nothing", async () => {
    currentSellerSession.value = null;

    await expect(startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(await workspaceCountForTenant(sellerA.tenantId)).toBe(0);
  });

  it("createFirstWorkspace redirects to /admin/login and writes nothing", async () => {
    currentSellerSession.value = null;
    const formData = formDataFor({ target_company_name: "Acme Inc", target_domain: "acme.com" });

    await expect(createFirstWorkspace(INITIAL_ONBOARDING_STATE, formData)).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(await workspaceCountForTenant(sellerA.tenantId)).toBe(0);
  });
});

describe("startWithSampleDeal (T41)", () => {
  it("happy path: redirects to /admin/workspaces/{id}, and the workspace exists under the fixture tenant", async () => {
    await expect(startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toHaveLength(1);
    const workspaceId = workspaceIdFromRedirect(redirectCalls[0]);
    const row = await workspaceRow(workspaceId);
    expect(row?.tenant_id).toBe(sellerA.tenantId);
  });

  it("session tenantId mismatched against the user's real claim: seedSampleDeal's own refusal surfaces as an error state — no redirect, no workspace written", async () => {
    const wrongTenantId = randomUUID();
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: wrongTenantId };

    const result = await startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData());

    expect(result.error).toBeTruthy();
    expect(redirectCalls).toEqual([]);
    expect(await workspaceCountForTenant(wrongTenantId)).toBe(0);
  });

  it("null tenantId: returns an error state without ever calling seedSampleDeal", async () => {
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: null };

    const result = await startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData());

    expect(result).toEqual({
      error: "Your account is missing its workspace home. Sign out and back in, then try again.",
    });
    expect(redirectCalls).toEqual([]);
  });
});

describe("createFirstWorkspace (T41)", () => {
  it("empty company name: returns an error state with fixed copy and writes no row", async () => {
    const before = await workspaceCountForTenant(sellerA.tenantId);

    const result = await createFirstWorkspace(
      INITIAL_ONBOARDING_STATE,
      formDataFor({ target_company_name: "   ", target_domain: "acme.com" }),
    );

    expect(result).toEqual({ error: "Company name is required." });
    expect(redirectCalls).toEqual([]);
    expect(await workspaceCountForTenant(sellerA.tenantId)).toBe(before);
  });

  it("invalid domain: returns an error state with fixed copy and writes no row", async () => {
    const before = await workspaceCountForTenant(sellerA.tenantId);

    const result = await createFirstWorkspace(
      INITIAL_ONBOARDING_STATE,
      formDataFor({ target_company_name: "Acme Inc", target_domain: "not a domain" }),
    );

    expect(result).toEqual({ error: "Enter a valid domain, e.g. acme.com." });
    expect(redirectCalls).toEqual([]);
    expect(await workspaceCountForTenant(sellerA.tenantId)).toBe(before);
  });

  it("null tenantId: returns an error state without touching the database", async () => {
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: null };

    const result = await createFirstWorkspace(
      INITIAL_ONBOARDING_STATE,
      formDataFor({ target_company_name: "Acme Inc", target_domain: "acme.com" }),
    );

    expect(result).toEqual({
      error: "Your account is missing its workspace home. Sign out and back in, then try again.",
    });
    expect(redirectCalls).toEqual([]);
  });

  it("insert failure (forced via an RLS-refused cross-tenant insert): returns the fixed failure copy, never raw Postgres text", async () => {
    const wrongTenantId = randomUUID();
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: wrongTenantId };

    const result = await createFirstWorkspace(
      INITIAL_ONBOARDING_STATE,
      formDataFor({ target_company_name: "Acme Inc", target_domain: "acme.com" }),
    );

    expect(result).toEqual({ error: "Couldn't create the workspace. Try again in a moment." });
    expect(result.error).not.toMatch(/duplicate key|constraint|violates|row-level security|postgres/i);
    expect(redirectCalls).toEqual([]);
    expect(await workspaceCountForTenant(wrongTenantId)).toBe(0);
  });

  it("happy path: inserts the row under the fixture tenant/user and redirects to /admin/workspaces/{id}", async () => {
    const formData = formDataFor({ target_company_name: "Acme Manual Co", target_domain: "acme-manual.example.com" });

    await expect(createFirstWorkspace(INITIAL_ONBOARDING_STATE, formData)).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toHaveLength(1);
    const workspaceId = workspaceIdFromRedirect(redirectCalls[0]);
    const row = await workspaceRow(workspaceId);
    expect(row?.tenant_id).toBe(sellerA.tenantId);
    expect(row?.created_by).toBe(sellerA.userId);
    expect(row?.target_company_name).toBe("Acme Manual Co");
    expect(row?.target_domain).toBe("acme-manual.example.com");
  });
});
