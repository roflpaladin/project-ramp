// Minimal, self-contained seed fixture for the T35-9 Playwright spec
// (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7 — QA).
//
// Same reason as e2e/support/seed-plan-builder-workspace.ts's and
// e2e/support/seed-portal-view-workspace.ts's header comments for
// reimplementing rather than importing the real modules: lib/supabase/
// admin.ts's `import "server-only"` throws the instant it is evaluated
// outside Next's own bundler, and Playwright Test has no resolve-alias
// equivalent to vitest.config.ts's stub — so the service-role client below
// reconstructs createAdminClient()'s body verbatim, and hashToken() below
// reconstructs lib/portal-access-token.ts's hashToken() verbatim (sha256 of
// "<token>.<workspaceId>.<email>"), rather than importing either guarded
// module.
//
// Own dedicated "7e5a…" sentinel prefix — distinct from seed-leaky-
// workspace.ts's "7e57…", seed-plan-builder-workspace.ts's "7e58…" and
// seed-portal-view-workspace.ts's "7e59…" — so this fixture can never
// collide with, or be torn down by, any other suite's cleanup.
//
// Seeds a workspace with a real plan, one stage, and one BUYER-OWNED OPEN
// step — the row the spec completes through a real authenticated session
// obtained by driving the actual verify-code gate, exactly like
// seed-portal-view-workspace.ts seeds a known code directly rather than
// exercising requestAccess's email-send step (already covered elsewhere).

import { createHash } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const TENANT_ID = "7e5a0000-0000-4000-8000-000000000001";
export const WORKSPACE_ID = "7e5a0000-0000-4000-8000-000000000002";
export const PLAN_ID = "7e5a0000-0000-4000-8000-000000000003";
export const STAGE_ID = "7e5a0000-0000-4000-8000-000000000004";
export const BUYER_STEP_ID = "7e5a0000-0000-4000-8000-000000000005";

export const OWNER_EMAIL = "t35-9-step-completion-e2e@projectramp.invalid";
export const BUYER_EMAIL = "buyer.t35-9-step-completion-e2e@step-completion-check.invalid";
export const KNOWN_CODE = "8140";
export const BUYER_STEP_LABEL = "Confirm rollout readiness (E2E)";

export interface SeededStepCompletionWorkspace {
  readonly workspaceId: string;
  readonly buyerEmail: string;
  readonly code: string;
  readonly stepId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-step-completion-workspace: missing required env var ${name}`);
  }
  return value;
}

/** See this file's header comment for why this is not `createAdminClient()` from lib/supabase/admin.ts. */
function adminClient() {
  return createServiceClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/** See this file's header comment — verbatim reimplementation of lib/portal-access-token.ts's hashToken(). */
function hashToken(token: string, workspaceId: string, email: string): string {
  return createHash("sha256").update(`${token}.${workspaceId}.${email}`).digest("hex");
}

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedStepCompletionWorkspace — ${label}: ${error.message}`);
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
  if (!data?.user) throw new Error("seedStepCompletionWorkspace — createUser returned no user");
  return { id: data.user.id, password };
}

export async function seedStepCompletionWorkspace(): Promise<SeededStepCompletionWorkspace> {
  const db = adminClient();
  const owner = await ensureOwner(db);

  failOn(
    "tenants",
    (await db.from("tenants").upsert({ id: TENANT_ID, company_name: "TEST — T35-9 step completion e2e" })).error,
  );

  failOn(
    "workspaces",
    (
      await db.from("workspaces").upsert({
        id: WORKSPACE_ID,
        tenant_id: TENANT_ID,
        target_company_name: "T35-9 E2E Co",
        target_domain: "t35-9-e2e.invalid",
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
        title: "T35-9 E2E plan",
        status: "active",
      })
    ).error,
  );

  failOn(
    "plan_stages",
    (
      await db.from("plan_stages").upsert({
        id: STAGE_ID,
        plan_id: PLAN_ID,
        title: "Rollout",
        display_order: 0,
        status: "current",
      })
    ).error,
  );

  // Reset to a clean slate on every run: an already-"done" row from a
  // previous (possibly failed) run would leave the "still open before this
  // spec runs" assumption below false without a fresh upsert of every
  // completion-relevant column.
  failOn(
    "plan_steps",
    (
      await db.from("plan_steps").upsert({
        id: BUYER_STEP_ID,
        stage_id: STAGE_ID,
        label: BUYER_STEP_LABEL,
        owner_side: "buyer",
        owner_name: "E2E buyer",
        owner_email: BUYER_EMAIL,
        status: "open",
        display_order: 0,
        completed_at: null,
        completed_by_email: null,
      })
    ).error,
  );

  // Reset to a clean slate on every run: no leftover unconsumed tokens for
  // this buyer that could let the verify form match an OLDER, differently
  // coded row.
  failOn(
    "clear portal_access_tokens",
    (await db.from("portal_access_tokens").delete().eq("workspace_id", WORKSPACE_ID)).error,
  );

  failOn(
    "portal_access_tokens",
    (
      await db.from("portal_access_tokens").insert({
        workspace_id: WORKSPACE_ID,
        email: BUYER_EMAIL,
        token_hash: hashToken(KNOWN_CODE, WORKSPACE_ID, BUYER_EMAIL),
        attempts: 0,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
    ).error,
  );

  return { workspaceId: WORKSPACE_ID, buyerEmail: BUYER_EMAIL, code: KNOWN_CODE, stepId: BUYER_STEP_ID };
}

export async function teardownStepCompletionWorkspace(): Promise<void> {
  const db = adminClient();
  await db.from("workspace_analytics").delete().eq("workspace_id", WORKSPACE_ID);
  await db.from("portal_access_tokens").delete().eq("workspace_id", WORKSPACE_ID);
  // plan_steps -> plan_stages -> success_plans cascade off workspaces (same
  // FK shape every other fixture in this repo documents).
  await db.from("workspaces").delete().eq("id", WORKSPACE_ID);
  await db.from("tenants").delete().eq("id", TENANT_ID);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}

/** Reads the step's current status/completed_by_email directly, bypassing any API. */
export async function readStepRow(
  stepId: string,
): Promise<{ status: string; completed_by_email: string | null; completed_at: string | null } | null> {
  const db = adminClient();
  const { data, error } = await db
    .from("plan_steps")
    .select("status, completed_by_email, completed_at")
    .eq("id", stepId)
    .maybeSingle();
  failOn("readStepRow", error);
  return data;
}
