// Sprint 8, Ticket 39 — seller self-serve registration & tenant
// auto-provisioning. Live-Supabase spec (security project, serial): a mock
// cannot prove that a fresh signup lands in an isolated tenant, which is the
// ticket's AC. The full cross-tenant matrix is Ticket 40; this file pins the
// provisioning core's own contract:
//
//   1. provisionSeller atomically yields tenant row + auth user with the
//      app_metadata.tenant_id claim attached at creation time (no post-hoc
//      metadata write — the claim race the poker flagged).
//   2. The new seller's RLS-scoped session sees exactly its own tenant and
//      nothing else.
//   3. A duplicate email fails cleanly and leaves NO orphan tenant row.
//   4. Invalid input fails fast with no side effects.
//
// Test rows are tagged with a per-run UUID and deleted in afterAll — this
// suite shares the dev Supabase project with other work (Session B runs
// concurrently this sprint; see plans/HANDOVER-sprint-8-session-B.md §1).

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false },
});

const runId = randomUUID();
const companyMarker = `T39 spec ${runId}`;
const createdUserIds: string[] = [];

function uniqueEmail(label: string): string {
  return `t39-${label}-${runId}@example.com`;
}

async function countMarkedTenants(): Promise<number> {
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("company_name", companyMarker);
  if (error) throw new Error(`counting marked tenants failed: ${error.message}`);
  return data.length;
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
  await admin.from("tenants").delete().eq("company_name", companyMarker);
});

describe("provisionSeller", () => {
  it("creates an isolated tenant and a user carrying the tenant_id claim from birth", async () => {
    const email = uniqueEmail("happy");
    const result = await provisionSeller({
      email,
      password: "correct-horse-9",
      companyName: companyMarker,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    // Tenant row exists under the given company name.
    const { data: tenant } = await admin
      .from("tenants")
      .select("id, company_name")
      .eq("id", result.tenantId)
      .single();
    expect(tenant?.company_name).toBe(companyMarker);

    // The claim was attached at createUser time, not patched afterwards, and
    // the account is immediately sign-in-able (auto-confirmed: transactional
    // confirmation email flow is Ticket 57, Sprint 11).
    const { data: fetched } = await admin.auth.admin.getUserById(result.userId);
    expect(fetched?.user?.app_metadata?.tenant_id).toBe(result.tenantId);
    expect(fetched?.user?.email_confirmed_at).toBeTruthy();
  });

  it("gives the fresh seller an RLS-scoped view of exactly their own tenant", async () => {
    const email = uniqueEmail("rls");
    const result = await provisionSeller({
      email,
      password: "correct-horse-9",
      companyName: companyMarker,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    // An anon-key client is subject to RLS — the service-role client can
    // never demonstrate isolation (see tests/fixtures/env.ts).
    const scoped = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false },
    });
    const { error: signInError } = await scoped.auth.signInWithPassword({
      email,
      password: "correct-horse-9",
    });
    expect(signInError).toBeNull();

    const { data: visibleTenants, error } = await scoped.from("tenants").select("id");
    expect(error).toBeNull();
    expect(visibleTenants).toHaveLength(1);
    expect(visibleTenants?.[0]?.id).toBe(result.tenantId);

    // A brand-new tenant owns no workspaces; RLS must yield zero rows, not
    // other tenants' rows (the dev project has seeded workspaces to leak).
    const { data: visibleWorkspaces } = await scoped.from("workspaces").select("id");
    expect(visibleWorkspaces).toHaveLength(0);

    await scoped.auth.signOut();
  });

  it("rejects a duplicate email without leaving an orphan tenant row", async () => {
    const email = uniqueEmail("dup");
    const first = await provisionSeller({
      email,
      password: "correct-horse-9",
      companyName: companyMarker,
    });
    expect(first.ok).toBe(true);
    if (first.ok) createdUserIds.push(first.userId);

    const before = await countMarkedTenants();

    const second = await provisionSeller({
      email,
      password: "different-horse-9",
      companyName: companyMarker,
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      createdUserIds.push(second.userId);
      return;
    }
    expect(second.code).toBe("email_taken");

    // The compensating delete ran: tenant count is unchanged — no signup can
    // strand a tenants row with no user attached to it.
    expect(await countMarkedTenants()).toBe(before);
  });

  it("fails fast on invalid input with no side effects", async () => {
    const cases = [
      { email: "not-an-email", password: "correct-horse-9", companyName: companyMarker },
      { email: uniqueEmail("shortpw"), password: "short", companyName: companyMarker },
      { email: uniqueEmail("nocompany"), password: "correct-horse-9", companyName: "  " },
    ];

    const before = await countMarkedTenants();

    for (const input of cases) {
      const result = await provisionSeller(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_input");
    }

    expect(await countMarkedTenants()).toBe(before);
  });
});
