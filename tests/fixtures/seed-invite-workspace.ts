// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip").
//
// A SEPARATE, dedicated fixture from tests/fixtures/seed-leaky-workspace.ts,
// not a reuse of it. That fixture's seed/teardown pair truncates and
// re-provisions rows scoped to a fixed sentinel tenant on every beforeAll —
// safe when it owns the only writer, but this ticket's brief is explicit
// that another session may be running the same shared "security" project
// (real dev Supabase, tests/**/*.spec.ts) concurrently. Calling
// teardownLeakyWorkspace()/seedLeakyWorkspace() here would race that
// session's in-flight assertions against this file's teardown. So: distinct
// sentinel IDs (the "7e57...4301+" range — grepped clear of every id already
// in seed-leaky-workspace.ts before being chosen), and teardown here only
// ever deletes rows scoped to THESE ids/tenants, never the shared ones.
//
// Mirrors seed-leaky-workspace.ts's shape (ensureTestUser's
// app_metadata.tenant_id claim, the same admin-client upsert idiom, a
// same-tenant workspace plus a foreign-tenant workspace for the RLS
// negative case) without pulling in any of its buyer-boundary-specific
// fields (links, plans, CRM columns) that this ticket's tests don't need.

import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "./env";

export const INVITE_TENANT_ID = "7e570000-0000-4000-8000-000000004301";
export const INVITE_WORKSPACE_ID = "7e570000-0000-4000-8000-000000004302";
export const INVITE_FOREIGN_TENANT_ID = "7e570000-0000-4000-8000-000000004303";
export const INVITE_FOREIGN_WORKSPACE_ID = "7e570000-0000-4000-8000-000000004304";

export const INVITE_OWNER_EMAIL = "t43-invite-harness@projectramp.invalid";
export const INVITE_TARGET_DOMAIN = "invite-test.invalid";

export interface InviteWorkspace {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdBy: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly foreignTenantId: string;
  readonly foreignWorkspaceId: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

function testDb(): AdminClient {
  requireTestEnv();
  return createAdminClient();
}

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedInviteWorkspace — ${label}: ${error.message}`);
}

/** Mirrors seed-leaky-workspace.ts's ensureTestUser, scoped to this fixture's own owner/tenant. */
async function ensureInviteOwner(db: AdminClient): Promise<{ id: string; password: string }> {
  const password = crypto.randomUUID();
  const app_metadata = { tenant_id: INVITE_TENANT_ID };

  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  failOn("listUsers", error);

  const existing = list?.users.find((user) => user.email === INVITE_OWNER_EMAIL);
  if (existing) {
    const { error: updateError } = await db.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata,
    });
    failOn("updateUser", updateError);
    return { id: existing.id, password };
  }

  const { data, error: createError } = await db.auth.admin.createUser({
    email: INVITE_OWNER_EMAIL,
    email_confirm: true,
    password,
    app_metadata,
  });
  failOn("createUser", createError);
  if (!data?.user) throw new Error("seedInviteWorkspace — createUser returned no user");

  return { id: data.user.id, password };
}

export async function seedInviteWorkspace(): Promise<InviteWorkspace> {
  const db = testDb();
  const owner = await ensureInviteOwner(db);
  const createdBy = owner.id;

  failOn(
    "tenants",
    (
      await db.from("tenants").upsert([
        { id: INVITE_TENANT_ID, company_name: "TEST — T43 invite harness" },
        { id: INVITE_FOREIGN_TENANT_ID, company_name: "TEST — T43 foreign tenant" },
      ])
    ).error,
  );

  failOn(
    "workspaces (own)",
    (
      await db.from("workspaces").upsert({
        id: INVITE_WORKSPACE_ID,
        tenant_id: INVITE_TENANT_ID,
        target_company_name: "T43 Invite Test Co",
        target_domain: INVITE_TARGET_DOMAIN,
        created_by: createdBy,
        approved_emails: [],
      })
    ).error,
  );

  failOn(
    "workspaces (foreign)",
    (
      await db.from("workspaces").upsert({
        id: INVITE_FOREIGN_WORKSPACE_ID,
        tenant_id: INVITE_FOREIGN_TENANT_ID,
        target_company_name: "T43 Foreign Tenant Co",
        target_domain: "foreign-invite-test.invalid",
        created_by: createdBy,
        approved_emails: [],
      })
    ).error,
  );

  return {
    tenantId: INVITE_TENANT_ID,
    workspaceId: INVITE_WORKSPACE_ID,
    createdBy,
    ownerEmail: INVITE_OWNER_EMAIL,
    ownerPassword: owner.password,
    foreignTenantId: INVITE_FOREIGN_TENANT_ID,
    foreignWorkspaceId: INVITE_FOREIGN_WORKSPACE_ID,
  };
}

/** Resets approved_emails to empty and clears any pending tokens/analytics — run between tests within this file rather than a full re-seed, so the fixture's ids/user stay stable across a describe block. */
export async function resetInviteWorkspace(): Promise<void> {
  const db = testDb();
  await db.from("workspaces").update({ approved_emails: [] }).eq("id", INVITE_WORKSPACE_ID);
  await db.from("portal_access_tokens").delete().eq("workspace_id", INVITE_WORKSPACE_ID);
  await db.from("workspace_analytics").delete().eq("workspace_id", INVITE_WORKSPACE_ID);
}

export async function teardownInviteWorkspace(): Promise<void> {
  const db = testDb();

  const workspaceIds = [INVITE_WORKSPACE_ID, INVITE_FOREIGN_WORKSPACE_ID];
  await db.from("workspace_analytics").delete().in("workspace_id", workspaceIds);
  await db.from("portal_access_tokens").delete().in("workspace_id", workspaceIds);
  await db.from("workspaces").delete().in("id", workspaceIds);
  await db.from("tenants").delete().in("id", [INVITE_TENANT_ID, INVITE_FOREIGN_TENANT_ID]);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === INVITE_OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}
