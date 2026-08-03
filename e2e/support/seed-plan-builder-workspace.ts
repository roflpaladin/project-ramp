// Minimal, self-contained seed fixture for the Playwright plan-builder specs
// (Ticket 29, T29-8 — QA).
//
// This is deliberately NOT tests/fixtures/seed-leaky-workspace.ts reused
// as-is. That fixture (and lib/plans/write.ts's own test suite) imports
// lib/supabase/admin.ts, whose first line is `import "server-only"` —
// node_modules/server-only/index.js unconditionally throws
// ("This module cannot be imported from a Client Component module...")
// the instant it is evaluated outside Next's own bundler, which strips that
// import for server bundles and only leaves the throw active for client
// bundles. Vitest's "security"/"components" projects survive this only
// because vitest.config.ts's `sharedAlias` maps the bare specifier
// "server-only" to an empty stub — Playwright Test has no equivalent
// resolve-alias mechanism, and this suite is explicitly local-run/no-CI
// (decision 10), so adding one was judged not worth it for two specs.
// Confirmed empirically: `npx tsx -e "import('./tests/fixtures/seed-leaky-workspace.ts')"`
// throws exactly that error.
//
// So: the service-role client below reconstructs lib/supabase/admin.ts's
// createAdminClient() body verbatim (same two env vars, same
// persistSession:false) without importing the guarded module, and this file
// seeds its OWN dedicated tenant/workspace/plan under a "7e58…" sentinel
// prefix (deliberately distinct from seed-leaky-workspace.ts's "7e57…" and
// lib/demo.ts's "de30…") so it can never collide with, or be torn down by,
// the vitest security suite's shared fixture. The seller SIGN-IN mechanism
// itself is NOT reinvented — e2e/support/browser-auth.ts reuses
// tests/security/support/seller-http-session.ts's buildSellerCookieHeader
// byte-for-byte, because that module has no server-only dependency and is
// safe to import here directly.

import { createClient as createServiceClient } from "@supabase/supabase-js";

export const TENANT_ID = "7e580000-0000-4000-8000-000000000001";
export const WORKSPACE_ID = "7e580000-0000-4000-8000-000000000002";
export const PLAN_ID = "7e580000-0000-4000-8000-000000000003";

export const STAGE_ONE_ID = "7e580000-0000-4000-8000-000000000010";
export const STAGE_TWO_ID = "7e580000-0000-4000-8000-000000000011";

export const STEP_A_ID = "7e580000-0000-4000-8000-000000000020"; // display_order 0, "Send proposal E2E"
export const STEP_B_ID = "7e580000-0000-4000-8000-000000000021"; // display_order 1, "Schedule demo E2E"
export const STEP_C_ID = "7e580000-0000-4000-8000-000000000022"; // display_order 2, "Confirm signature E2E"

export const STEP_A_LABEL = "Send proposal E2E";
export const STEP_B_LABEL = "Schedule demo E2E";
export const STEP_C_LABEL = "Confirm signature E2E";

export const OWNER_EMAIL = "t29-plan-builder-e2e@projectramp.invalid";

export interface SeededPlanBuilderWorkspace {
  readonly workspaceId: string;
  readonly planId: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-plan-builder-workspace: missing required env var ${name}`);
  }
  return value;
}

/** See this file's header comment for why this is not `createAdminClient()` from lib/supabase/admin.ts. */
function adminClient() {
  return createServiceClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedPlanBuilderWorkspace — ${label}: ${error.message}`);
}

async function ensureOwner(db: ReturnType<typeof adminClient>): Promise<{ id: string; password: string }> {
  const password = crypto.randomUUID();
  const app_metadata = { tenant_id: TENANT_ID };

  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  failOn("listUsers", error);

  const existing = list?.users.find((user) => user.email === OWNER_EMAIL);
  if (existing) {
    const { error: updateError } = await db.auth.admin.updateUserById(existing.id, { password, app_metadata });
    failOn("updateUser", updateError);
    return { id: existing.id, password };
  }

  const { data, error: createError } = await db.auth.admin.createUser({
    email: OWNER_EMAIL,
    email_confirm: true,
    password,
    app_metadata,
  });
  failOn("createUser", createError);
  if (!data?.user) throw new Error("seedPlanBuilderWorkspace — createUser returned no user");
  return { id: data.user.id, password };
}

export async function seedPlanBuilderWorkspace(): Promise<SeededPlanBuilderWorkspace> {
  const db = adminClient();
  const owner = await ensureOwner(db);

  failOn("tenants", (await db.from("tenants").upsert({ id: TENANT_ID, company_name: "TEST — T29-8 plan builder e2e" })).error);

  failOn(
    "workspaces",
    (
      await db.from("workspaces").upsert({
        id: WORKSPACE_ID,
        tenant_id: TENANT_ID,
        target_company_name: "T29-8 E2E Co",
        target_domain: "t29-e2e.invalid",
        created_by: owner.id,
      })
    ).error,
  );

  failOn(
    "success_plans",
    (
      await db.from("success_plans").upsert({
        id: PLAN_ID,
        workspace_id: WORKSPACE_ID,
        title: "T29-8 e2e plan",
        status: "active",
      })
    ).error,
  );

  failOn(
    "plan_stages",
    (
      await db.from("plan_stages").upsert([
        { id: STAGE_ONE_ID, plan_id: PLAN_ID, title: "Kickoff", display_order: 0, status: "done" },
        { id: STAGE_TWO_ID, plan_id: PLAN_ID, title: "Delivery", display_order: 1, status: "current" },
      ])
    ).error,
  );

  failOn(
    "plan_steps",
    (
      await db.from("plan_steps").upsert([
        {
          id: STEP_A_ID,
          stage_id: STAGE_TWO_ID,
          label: STEP_A_LABEL,
          owner_side: "seller",
          status: "open",
          display_order: 0,
        },
        {
          id: STEP_B_ID,
          stage_id: STAGE_TWO_ID,
          label: STEP_B_LABEL,
          owner_side: "seller",
          status: "open",
          display_order: 1,
        },
        {
          id: STEP_C_ID,
          stage_id: STAGE_TWO_ID,
          label: STEP_C_LABEL,
          owner_side: "seller",
          status: "open",
          display_order: 2,
        },
      ])
    ).error,
  );

  return { workspaceId: WORKSPACE_ID, planId: PLAN_ID, ownerEmail: OWNER_EMAIL, ownerPassword: owner.password };
}

export async function teardownPlanBuilderWorkspace(): Promise<void> {
  const db = adminClient();
  // success_plans -> plan_stages -> plan_steps cascade off workspaces (same
  // FK shape tests/fixtures/seed-leaky-workspace.ts documents); this fixture
  // creates no links/portal_access_tokens rows, so no pre-delete is needed
  // for those before the workspace delete.
  await db.from("workspaces").delete().eq("id", WORKSPACE_ID);
  await db.from("tenants").delete().eq("id", TENANT_ID);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}

/**
 * Deletes one plan_steps row directly, bypassing the UI entirely — used by
 * the "optimistic revert on forced rejection" spec to make the browser's
 * already-rendered (stale) step id set diverge from the DB's real set, which
 * is exactly what 0007_plan_reorder.sql's exact-set check rejects with
 * REORDER_SET_MISMATCH.
 */
export async function deleteStepDirectly(stepId: string): Promise<void> {
  const db = adminClient();
  const { error } = await db.from("plan_steps").delete().eq("id", stepId);
  failOn("deleteStepDirectly", error);
}
