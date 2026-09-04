// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Behavioural coverage
// for app/admin/workspaces/[id]/checklist-actions.ts's dismissActivationChecklist.
// Mirrors tests/security/invite-actions.spec.ts's mocking strategy (requireSeller
// and next/cache mocked; everything else runs for real against the dev Supabase
// project) and reuses its dedicated fixture (tests/fixtures/seed-invite-workspace.ts)
// rather than the shared seed-leaky-workspace.ts one — already reused by a second
// spec (tests/api/issue-access-token-invite.spec.ts), so this is not this fixture's
// first cross-ticket use.
//
// DEPENDS ON migration 0012 (workspaces.activation_checklist_dismissed_at) being
// applied to the dev Supabase project this suite's env points at. Written but not
// verified passing in this session for that reason — see the ticket handoff notes
// for the exact migration file/number the founder needs to run in the SQL Editor
// first. Once applied, `npx vitest run tests/security/checklist-actions.spec.ts`
// should be run in a coordinated slot (shared dev DB — see docs/environments.md).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";
import {
  resetInviteWorkspace,
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

const { dismissActivationChecklist } = await import("@/app/admin/workspaces/[id]/checklist-actions");

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

async function dismissedAtOf(workspaceId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("workspaces")
    .select("activation_checklist_dismissed_at")
    .eq("id", workspaceId)
    .single();
  if (error) throw new Error(`dismissedAtOf: ${error.message}`);
  return data?.activation_checklist_dismissed_at ?? null;
}

async function clearDismissedAt(workspaceId: string): Promise<void> {
  const db = createAdminClient();
  await db.from("workspaces").update({ activation_checklist_dismissed_at: null }).eq("id", workspaceId);
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
  await resetInviteWorkspace();
  await clearDismissedAt(seeded.workspaceId);
  await clearDismissedAt(seeded.foreignWorkspaceId);
});

describe("dismissActivationChecklist (T58)", () => {
  it("unauthenticated seller: returns UNAUTHENTICATED and writes nothing", async () => {
    currentSellerSession.value = null;

    const result = await dismissActivationChecklist(seeded.workspaceId);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await dismissedAtOf(seeded.workspaceId)).toBeNull();
    expect(revalidatePathCalls).toEqual([]);
  });

  it("happy path: sets activation_checklist_dismissed_at to a real timestamp and revalidates the workspace page", async () => {
    const before = Date.now();

    const result = await dismissActivationChecklist(seeded.workspaceId);

    expect(result).toEqual({ ok: true });
    const dismissedAt = await dismissedAtOf(seeded.workspaceId);
    expect(dismissedAt).not.toBeNull();
    expect(new Date(dismissedAt as string).getTime()).toBeGreaterThanOrEqual(before);
    expect(revalidatePathCalls).toEqual([`/admin/workspaces/${seeded.workspaceId}`]);
  });

  it("cross-tenant workspace id: RLS makes it a no-op, returns NOT_FOUND, writes nothing", async () => {
    const result = await dismissActivationChecklist(seeded.foreignWorkspaceId);

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await dismissedAtOf(seeded.foreignWorkspaceId)).toBeNull();
    expect(revalidatePathCalls).toEqual([]);
  });

  it("nonexistent workspace id: returns NOT_FOUND rather than throwing", async () => {
    const result = await dismissActivationChecklist("00000000-0000-4000-8000-000000000000");

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(revalidatePathCalls).toEqual([]);
  });
});
