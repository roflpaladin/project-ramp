// Minimal, self-contained seed fixture for the T34-9 Playwright spec
// (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7 — QA).
//
// Same reason as e2e/support/seed-plan-builder-workspace.ts's header
// comment for reimplementing rather than importing the real modules:
// lib/supabase/admin.ts's `import "server-only"` throws the instant it is
// evaluated outside Next's own bundler, and Playwright Test has no
// resolve-alias equivalent to vitest.config.ts's stub — so the service-role
// client below reconstructs createAdminClient()'s body verbatim, and
// hashToken() below reconstructs lib/portal-access-token.ts's hashToken()
// verbatim (sha256 of "<token>.<workspaceId>.<email>"), rather than
// importing either guarded module. Both are pure/two-line functions; the
// duplication is the same trade seed-plan-builder-workspace.ts already made,
// not a new one.
//
// Own dedicated "7e59…" sentinel prefix — distinct from seed-leaky-
// workspace.ts's "7e57…", seed-plan-builder-workspace.ts's "7e58…" and
// lib/demo.ts's "de30…" — so this fixture can never collide with, or be
// torn down by, any other suite's cleanup.
//
// This fixture seeds a KNOWN 4-digit code directly into portal_access_tokens
// (bypassing requestAccess/issueAccessToken's real email-send step, which
// T34-10's tests/api/send-token.spec.ts already covers and which would
// otherwise burn nodemailer's ~2-minute connection timeout against this
// repo's placeholder .env.local SMTP_HOST). What T34-9 actually needs proof
// of — that visiting /portal/[id] through the REAL gate writes exactly one
// portal_view row — lives entirely in verifyAccess (app/portal/[id]/
// gate-actions.ts), which this fixture lets the Playwright spec drive for
// real: the code-entry form, a real click, a real redirect, a real cookie
// the browser then carries into the granted render and any reload.

import { createHash } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const TENANT_ID = "7e590000-0000-4000-8000-000000000001";
export const WORKSPACE_ID = "7e590000-0000-4000-8000-000000000002";

export const OWNER_EMAIL = "t34-9-portal-view-e2e@projectramp.invalid";
export const BUYER_EMAIL = "buyer.t34-9-portal-view-e2e@portal-view-check.invalid";
export const KNOWN_CODE = "4269";

export interface SeededPortalViewWorkspace {
  readonly workspaceId: string;
  readonly buyerEmail: string;
  readonly code: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-portal-view-workspace: missing required env var ${name}`);
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
  if (error) throw new Error(`seedPortalViewWorkspace — ${label}: ${error.message}`);
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
  if (!data?.user) throw new Error("seedPortalViewWorkspace — createUser returned no user");
  return { id: data.user.id, password };
}

export async function seedPortalViewWorkspace(): Promise<SeededPortalViewWorkspace> {
  const db = adminClient();
  const owner = await ensureOwner(db);

  failOn(
    "tenants",
    (await db.from("tenants").upsert({ id: TENANT_ID, company_name: "TEST — T34-9 portal_view e2e" })).error,
  );

  failOn(
    "workspaces",
    (
      await db.from("workspaces").upsert({
        id: WORKSPACE_ID,
        tenant_id: TENANT_ID,
        target_company_name: "T34-9 E2E Co",
        target_domain: "t34-9-e2e.invalid",
        created_by: owner.id,
      })
    ).error,
  );

  // Reset to a clean slate on every run: no leftover analytics rows from a
  // previous (possibly failed) run, and no leftover unconsumed tokens for
  // this buyer that could let the verify form match an OLDER, differently
  // coded row.
  failOn(
    "clear workspace_analytics",
    (await db.from("workspace_analytics").delete().eq("workspace_id", WORKSPACE_ID)).error,
  );
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

  return { workspaceId: WORKSPACE_ID, buyerEmail: BUYER_EMAIL, code: KNOWN_CODE };
}

export async function teardownPortalViewWorkspace(): Promise<void> {
  const db = adminClient();
  await db.from("workspace_analytics").delete().eq("workspace_id", WORKSPACE_ID);
  await db.from("portal_access_tokens").delete().eq("workspace_id", WORKSPACE_ID);
  // links/success_plans cascade off workspaces (same FK shape every other
  // fixture in this repo documents); this fixture creates neither.
  await db.from("workspaces").delete().eq("id", WORKSPACE_ID);
  await db.from("tenants").delete().eq("id", TENANT_ID);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}

/** Counts `portal_view` analytics rows for WORKSPACE_ID — the value T34-9's
 *  assertions are actually about. */
export async function countPortalViewRows(): Promise<number> {
  const db = adminClient();
  const { data, error } = await db
    .from("workspace_analytics")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("action_type", "portal_view");
  failOn("countPortalViewRows", error);
  return data?.length ?? 0;
}
