// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Behavioural coverage
// for app/admin/workspaces/[id]/plan/plan-actions.ts's markPlanLiveAction —
// the minimal "flip status to active" wrapper the checklist's "make it live"
// button binds to. Mirrors tests/security/invite-actions.spec.ts's mocking
// strategy and tests/plans/write.spec.ts's signInAsSeller helper, reusing
// tests/fixtures/seed-invite-workspace.ts (a workspace with no plan yet) so
// each test seeds its own fresh plan row rather than sharing one with the
// buyer-boundary suite's fixture.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";
import {
  seedInviteWorkspace,
  teardownInviteWorkspace,
  type InviteWorkspace,
} from "../fixtures/seed-invite-workspace";

const env = requireTestEnv();

const { currentSellerSession } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

const revalidatePathCalls: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidatePathCalls.push(path);
  }),
}));

const { markPlanLiveAction } = await import("@/app/admin/workspaces/[id]/plan/plan-actions");

async function signInAsSeller(seeded: InviteWorkspace): Promise<SupabaseClient> {
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

async function createDraftPlan(workspaceId: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("success_plans")
    .insert({ workspace_id: workspaceId, title: "T58 mark-live test plan", status: "draft" })
    .select("id")
    .single();
  if (error) throw new Error(`createDraftPlan: ${error.message}`);
  return data.id as string;
}

async function statusOf(planId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from("success_plans").select("status").eq("id", planId).maybeSingle();
  return data?.status ?? null;
}

let seeded: InviteWorkspace;
let sellerClient: SupabaseClient;

beforeAll(async () => {
  await teardownInviteWorkspace();
  seeded = await seedInviteWorkspace();
  sellerClient = await signInAsSeller(seeded);
});

afterAll(async () => {
  await teardownInviteWorkspace();
});

beforeEach(() => {
  revalidatePathCalls.length = 0;
  currentSellerSession.value = {
    client: sellerClient,
    userId: "unused-in-tests",
    email: seeded?.ownerEmail ?? null,
    tenantId: seeded?.tenantId ?? null,
  };
});

afterEach(async () => {
  const db = createAdminClient();
  await db.from("success_plans").delete().eq("workspace_id", seeded.workspaceId);
  await db.from("success_plans").delete().eq("workspace_id", seeded.foreignWorkspaceId);
});

describe("markPlanLiveAction (T58)", () => {
  it("unauthenticated seller: returns UNAUTHENTICATED and writes nothing", async () => {
    const planId = await createDraftPlan(seeded.workspaceId);
    currentSellerSession.value = null;

    const result = await markPlanLiveAction(seeded.workspaceId, planId);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await statusOf(planId)).toBe("draft");
  });

  it("happy path: flips a draft plan's status to 'active' and revalidates the plan page", async () => {
    const planId = await createDraftPlan(seeded.workspaceId);

    const result = await markPlanLiveAction(seeded.workspaceId, planId);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("active");
    expect(await statusOf(planId)).toBe("active");
    expect(revalidatePathCalls).toEqual([`/admin/workspaces/${seeded.workspaceId}/plan`]);
  });

  it("cross-tenant plan id: RLS makes it a no-op, returns NOT_FOUND", async () => {
    const foreignPlanId = await createDraftPlan(seeded.foreignWorkspaceId);

    const result = await markPlanLiveAction(seeded.foreignWorkspaceId, foreignPlanId);

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await statusOf(foreignPlanId)).toBe("draft");
  });
});
