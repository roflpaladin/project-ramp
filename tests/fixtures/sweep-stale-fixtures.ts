// Clears fixture rows a crashed or killed run left behind in the shared dev
// database. Every fixture id/email is run-scoped (run-id.ts), so a leftover is
// never reused by a later run — it just sits there. This is the janitor.
//
// Called once per run from tests/fixtures/global-setup.ts (vitest) and
// e2e/support/global-setup.ts (Playwright). It only needs a service-role
// client, so it takes one as an argument instead of importing
// lib/supabase/admin.ts (which imports "server-only" and cannot load under
// Playwright's Node process — same reason the e2e seeds build their own).
//
// What counts as stale:
//   - auth users with a run-scoped harness email (local+<run id>@…) older than
//     STALE_FIXTURE_HOURS, so a run that is still going (CI or the other local
//     session) is never touched;
//   - run-scoped tenants in the fixtures' uuid range (7e57..7e5a) older than that.
// LEGACY fixed-id rows (run token 0000-0000-4000, emails without +<run id>) are
// never swept: a branch that predates run-scoped ids still upserts them, so
// their created_at is ancient even while such a run is using them. They get a
// one-off cleanup once every open branch carries run-scoped ids.
// Assumes no run lives longer than STALE_FIXTURE_HOURS: there is no liveness
// check, so a hung run past that age can lose its rows to another run's sweep.
// Rows under the real demo tenant (de30...) are never touched, except the
// workspaces a stale harness user created there (the pulse fixture's).
//
// Best effort: a failed delete is logged with the table name and the sweep
// moves on. A hiccup in cleanup must not block the suite, and the next run
// tries again.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const STALE_FIXTURE_HOURS = 6;

const MS_PER_HOUR = 60 * 60 * 1000;
const USERS_PER_PAGE = 1000;
const DEMO_TENANT_PREFIX = "de30";
const TENANT_RANGE_START = "7e570000-0000-0000-0000-000000000000";
const TENANT_RANGE_END = "7e5affff-ffff-ffff-ffff-ffffffffffff";
const LEGACY_TENANT_ID = /^7e5[789a]0000-0000-4000-/;
// The exact shape runScopedId() emits. The range query alone is not enough:
// a real tenant's gen_random_uuid() id falls in 7e57..7e5a about 1 in 16,384.
const RUN_SCOPED_TENANT_ID = /^7e5[789a][0-9a-f]{4}-[0-9a-f]{4}-4[0-9a-f]{3}-8000-[0-9a-f]{12}$/;
const HARNESS_EMAIL =
  /^[a-z0-9.-]+\+[0-9a-f]{11}@(projectramp|portal-view-check|step-completion-check)\.invalid$/;

export interface SweepCounts {
  readonly users: number;
  readonly tenants: number;
  readonly workspaces: number;
  readonly failures: number;
}

interface StaleSet {
  readonly userIds: readonly string[];
  readonly tenantIds: readonly string[];
}

function isOlderThan(createdAt: string | undefined, cutoffMs: number): boolean {
  if (!createdAt) return false;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && time < cutoffMs;
}

async function findStaleUsers(
  db: SupabaseClient,
  cutoffMs: number,
): Promise<{ readonly ids: readonly string[]; readonly tenantIds: readonly string[] }> {
  const ids: string[] = [];
  const tenantIds: string[] = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`sweepStaleFixtures — listUsers: ${error.message}`);

    for (const user of data.users) {
      if (!user.email || !HARNESS_EMAIL.test(user.email)) continue;
      if (!isOlderThan(user.created_at, cutoffMs)) continue;
      ids.push(user.id);
      const tenantId: unknown = user.app_metadata?.tenant_id;
      if (
        typeof tenantId === "string" &&
        !tenantId.startsWith(DEMO_TENANT_PREFIX) &&
        !LEGACY_TENANT_ID.test(tenantId)
      ) {
        tenantIds.push(tenantId);
      }
    }
    if (data.users.length < USERS_PER_PAGE) return { ids, tenantIds };
  }
}

async function findStaleTenants(db: SupabaseClient, cutoffMs: number): Promise<readonly string[]> {
  const { data, error } = await db
    .from("tenants")
    .select("id, created_at")
    .gte("id", TENANT_RANGE_START)
    .lte("id", TENANT_RANGE_END);
  if (error) throw new Error(`sweepStaleFixtures — tenants: ${error.message}`);

  return (data ?? [])
    .filter(
      (row) =>
        RUN_SCOPED_TENANT_ID.test(row.id) &&
        !LEGACY_TENANT_ID.test(row.id) &&
        isOlderThan(row.created_at, cutoffMs),
    )
    .map((row) => row.id as string);
}

async function findWorkspaceIds(db: SupabaseClient, stale: StaleSet): Promise<readonly string[]> {
  const byTenant =
    stale.tenantIds.length > 0
      ? await db.from("workspaces").select("id").in("tenant_id", [...stale.tenantIds])
      : { data: [], error: null };
  const byCreator =
    stale.userIds.length > 0
      ? await db.from("workspaces").select("id").in("created_by", [...stale.userIds])
      : { data: [], error: null };

  const error = byTenant.error ?? byCreator.error;
  if (error) throw new Error(`sweepStaleFixtures — workspaces: ${error.message}`);

  const rows = [...(byTenant.data ?? []), ...(byCreator.data ?? [])] as { id: string }[];
  return [...new Set(rows.map((row) => row.id))];
}

/** Returns 1 when the delete failed (and logs it), 0 otherwise. */
function logFailure(label: string, error: { message: string } | null): number {
  if (!error) return 0;
  console.warn(`[sweep-stale-fixtures] ${label} delete failed: ${error.message}`);
  return 1;
}

async function deleteInFkOrder(
  db: SupabaseClient,
  workspaceIds: readonly string[],
  stale: StaleSet,
): Promise<number> {
  let failures = 0;
  const ids = [...workspaceIds];

  // links and portal_access_tokens have no ON DELETE CASCADE from workspaces
  // (migration 0001); workspaces.tenant_id does not cascade from tenants.
  // Analytics, plans, stages and steps cascade from workspaces.
  if (ids.length > 0) {
    failures += logFailure("links", (await db.from("links").delete().in("workspace_id", ids)).error);
    failures += logFailure(
      "portal_access_tokens",
      (await db.from("portal_access_tokens").delete().in("workspace_id", ids)).error,
    );
    failures += logFailure("workspaces", (await db.from("workspaces").delete().in("id", ids)).error);
  }
  if (stale.tenantIds.length > 0) {
    failures += logFailure(
      "tenants",
      (await db.from("tenants").delete().in("id", [...stale.tenantIds])).error,
    );
  }
  for (const userId of stale.userIds) {
    failures += logFailure("auth user", (await db.auth.admin.deleteUser(userId)).error);
  }
  return failures;
}

export async function sweepStaleFixtures(
  db: SupabaseClient,
  options: { readonly olderThanHours?: number } = {},
): Promise<SweepCounts> {
  const olderThanHours = options.olderThanHours ?? STALE_FIXTURE_HOURS;
  const cutoffMs = Date.now() - olderThanHours * MS_PER_HOUR;

  const users = await findStaleUsers(db, cutoffMs);
  const staleTenants = await findStaleTenants(db, cutoffMs);
  const stale: StaleSet = {
    userIds: users.ids,
    tenantIds: [...new Set([...staleTenants, ...users.tenantIds])],
  };
  const workspaceIds = await findWorkspaceIds(db, stale);
  const failures = await deleteInFkOrder(db, workspaceIds, stale);

  const counts: SweepCounts = {
    users: stale.userIds.length,
    tenants: stale.tenantIds.length,
    workspaces: workspaceIds.length,
    failures,
  };
  console.log(
    `[sweep-stale-fixtures] removed ${counts.users} user(s), ${counts.tenants} tenant(s), ` +
      `${counts.workspaces} workspace(s) older than ${olderThanHours}h` +
      (failures > 0 ? ` (${failures} delete(s) failed — see warnings)` : ""),
  );
  return counts;
}

/**
 * The per-run entry point both globalSetups call. Never throws: it only removes
 * leftovers, so neither missing credentials (someone running only
 * tests/components) nor a failed sweep may block the suite. Live specs still
 * throw from requireTestEnv() themselves, so the "a gate must not skip
 * silently" rule is intact; this just prints that the sweep did not run.
 *
 * SKIP_FIXTURE_SWEEP=1 opts out (e.g. running a pure unit spec on a machine
 * whose .env.local points at a database you would rather not touch).
 */
export async function sweepStaleFixturesFromEnv(): Promise<void> {
  if (process.env.SKIP_FIXTURE_SWEEP === "1") {
    console.log("[sweep-stale-fixtures] skipped: SKIP_FIXTURE_SWEEP=1");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.log("[sweep-stale-fixtures] skipped: Supabase credentials are not set");
    return;
  }

  try {
    await sweepStaleFixtures(createClient(url, serviceRoleKey, { auth: { persistSession: false } }));
  } catch (error) {
    console.warn("[sweep-stale-fixtures] sweep failed, continuing:", error);
  }
}
