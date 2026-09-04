// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Live-DB coverage for
// lib/plans/invite-status.ts's hasSentInviteForWorkspace. Mirrors
// tests/plans/reorder-live.spec.ts / constraints-live.spec.ts's naming
// convention for a "real database, not mocked" spec under tests/plans, and
// reuses tests/fixtures/seed-invite-workspace.ts (already shared across
// tickets — see tests/api/issue-access-token-invite.spec.ts) rather than
// standing up a third fixture for the same two workspaces.

import { createAdminClient } from "@/lib/supabase/admin";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { hasSentInviteForWorkspace, type InviteStatusReadClient } from "@/lib/plans/invite-status";
import {
  seedInviteWorkspace,
  teardownInviteWorkspace,
  type InviteWorkspace,
} from "../fixtures/seed-invite-workspace";

let seeded: InviteWorkspace;

beforeAll(async () => {
  await teardownInviteWorkspace();
  seeded = await seedInviteWorkspace();
});

afterAll(async () => {
  await teardownInviteWorkspace();
});

afterEach(async () => {
  const db = createAdminClient();
  await db.from("portal_access_tokens").delete().eq("workspace_id", seeded.workspaceId);
});

describe("hasSentInviteForWorkspace (T58)", () => {
  it("returns false for a workspace with no portal_access_tokens rows", async () => {
    expect(await hasSentInviteForWorkspace(seeded.workspaceId)).toBe(false);
  });

  it("returns true once a token row exists for the workspace, sent or not", async () => {
    const db = createAdminClient();
    const { error } = await db.from("portal_access_tokens").insert({
      workspace_id: seeded.workspaceId,
      email: "invited@invite-status-test.invalid",
      token_hash: "test-hash-does-not-need-to-verify",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (error) throw new Error(`seed token insert failed: ${error.message}`);

    expect(await hasSentInviteForWorkspace(seeded.workspaceId)).toBe(true);
  });

  it("returns true even for an already-consumed/expired token — this is an existence check, not a validity check", async () => {
    const db = createAdminClient();
    const { error } = await db.from("portal_access_tokens").insert({
      workspace_id: seeded.workspaceId,
      email: "consumed@invite-status-test.invalid",
      token_hash: "test-hash-does-not-need-to-verify",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      consumed_at: new Date().toISOString(),
    });
    if (error) throw new Error(`seed token insert failed: ${error.message}`);

    expect(await hasSentInviteForWorkspace(seeded.workspaceId)).toBe(true);
  });

  it("is scoped by workspace_id — another workspace's tokens don't leak a true here", async () => {
    const db = createAdminClient();
    const { error } = await db.from("portal_access_tokens").insert({
      workspace_id: seeded.foreignWorkspaceId,
      email: "other-workspace@invite-status-test.invalid",
      token_hash: "test-hash-does-not-need-to-verify",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (error) throw new Error(`seed token insert failed: ${error.message}`);

    expect(await hasSentInviteForWorkspace(seeded.workspaceId)).toBe(false);

    await db.from("portal_access_tokens").delete().eq("workspace_id", seeded.foreignWorkspaceId);
  });

  it("throws (never silently returns false) when the query itself errors", async () => {
    // A synthetic client, injected the same way the live cases above inject a
    // real signed-in one — proves the error branch without needing to
    // provoke a genuine Postgrest failure against the real database.
    const failingClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: null, error: { message: "synthetic failure" } }),
          }),
        }),
      }),
    } as unknown as InviteStatusReadClient;

    await expect(hasSentInviteForWorkspace(seeded.workspaceId, failingClient)).rejects.toThrow(
      /Failed to check invite status.*synthetic failure/,
    );
  });
});
