// Sprint 10, Ticket 52 — live-DB coverage for crm_connections (0010) and
// lib/hubspot/token-store.ts's CRUD over it. Mirrors
// tests/security/tenant-isolation-matrix.spec.ts's "admin sees the row ->
// owning tenant's scoped client sees ZERO rows (no seller policy exists by
// design) -> foreign tenant's scoped client also sees ZERO rows" structure
// for a table that follows the 0002/0008 "RLS enabled, zero policies"
// shape — the boundary crm_connections is meant to prove is exactly that no
// authenticated seller session, not even the owning tenant's own, can read
// this table directly; only the service-role client (i.e.
// lib/hubspot/token-store.ts) can.
//
// 2026-08-24: 0010_crm_connections.sql has already been applied to the dev
// Supabase project this suite's env points at — no self-provisioning DDL
// helper (0006's pattern) is needed or used here; this file reads/writes
// the real table directly, same as every other live spec in this
// directory.
//
// WRITTEN BUT NOT RUN in this session (same reason as csv-import-action.spec.ts's
// header): the shared dev Supabase project is under CI right now. Run with
// `npx vitest run tests/security/crm-connections-store.spec.ts` in a
// coordinated slot.
//
// Own dedicated fixture tenant (provisioned inline below), not a shared
// one — afterAll deletes only rows tagged with this run's own tenantId(s).

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import {
  deleteTenantTokens,
  getTenantRefreshToken,
  isTenantConnected,
  saveTenantTokens,
} from "@/lib/hubspot/token-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createAdminClient();

/** Never signed in — the "anonymous visitor" control, same role tenant-isolation-matrix.spec.ts uses. */
const anonClient = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-52-battery-hubspot";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly scoped: SupabaseClient;
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

async function provisionTestSeller(label: string): Promise<SeededSeller> {
  const email = `t52-crm-connections-${label}-${runId}@example.com`;
  const companyName = `T52 crm connections ${label} ${runId}`;

  const result = await provisionSeller({ email, password: SELLER_PASSWORD, companyName });
  if (!result.ok) throw new Error(`provisionSeller failed: ${result.message}`);
  createdUserIds.push(result.userId);
  createdTenantIds.push(result.tenantId);

  const scoped = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
  const { error } = await scoped.auth.signInWithPassword({ email, password: SELLER_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  return { tenantId: result.tenantId, userId: result.userId, email, scoped };
}

let sellerA: SeededSeller;

beforeAll(async () => {
  sellerA = await provisionTestSeller("a");
}, 60_000);

afterAll(async () => {
  try {
    await admin.from("crm_connections").delete().in("tenant_id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
    console.error("crm-connections-store cleanup — crm_connections failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("crm-connections-store cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`crm-connections-store cleanup — auth user ${userId} failed:`, error);
    }
  }

  await sellerA?.scoped.auth.signOut().catch(() => undefined);
}, 60_000);

describe("lib/hubspot/token-store.ts — round trip against the real crm_connections table", () => {
  it("isTenantConnected is false before any row exists", async () => {
    expect(await isTenantConnected(sellerA.tenantId)).toBe(false);
  });

  it("saveTenantTokens writes a row whose refresh token round-trips through getTenantRefreshToken decrypted", async () => {
    await saveTenantTokens({
      tenantId: sellerA.tenantId,
      refreshToken: "plain-refresh-token-value",
      scope: "crm.objects.deals.read",
      connectedBy: sellerA.userId,
    });

    expect(await getTenantRefreshToken(sellerA.tenantId)).toBe("plain-refresh-token-value");
    expect(await isTenantConnected(sellerA.tenantId)).toBe(true);
  });

  it("stores the refresh token encrypted at rest — the raw column value is never the plaintext", async () => {
    const { data, error } = await admin
      .from("crm_connections")
      .select("encrypted_refresh_token")
      .eq("tenant_id", sellerA.tenantId)
      .eq("provider", "hubspot")
      .single();

    expect(error).toBeNull();
    expect(data?.encrypted_refresh_token).not.toBe("plain-refresh-token-value");
    expect(data?.encrypted_refresh_token).toContain(":"); // iv:tag:data shape (lib/encrypt-secret.ts)
  });

  it("saveTenantTokens upserts on (tenant_id, provider) — a reconnect replaces, not duplicates, the row", async () => {
    await saveTenantTokens({
      tenantId: sellerA.tenantId,
      refreshToken: "rotated-refresh-token-value",
      scope: "crm.objects.deals.read",
      connectedBy: sellerA.userId,
    });

    const { data, error } = await admin.from("crm_connections").select("id").eq("tenant_id", sellerA.tenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await getTenantRefreshToken(sellerA.tenantId)).toBe("rotated-refresh-token-value");
  });

  it("deleteTenantTokens removes the row; getTenantRefreshToken and isTenantConnected reflect the deletion", async () => {
    await deleteTenantTokens(sellerA.tenantId);

    expect(await getTenantRefreshToken(sellerA.tenantId)).toBeNull();
    expect(await isTenantConnected(sellerA.tenantId)).toBe(false);
  });
});

describe("crm_connections — RLS enabled, zero policies (0010, service-role only)", () => {
  beforeAll(async () => {
    // Re-seed a row for the RLS checks below — the round-trip suite above deleted it.
    await saveTenantTokens({
      tenantId: sellerA.tenantId,
      refreshToken: "rls-check-refresh-token",
      scope: "crm.objects.deals.read",
      connectedBy: sellerA.userId,
    });
  });

  it("admin (service-role) sees the seeded row — proves the negative checks below aren't vacuous", async () => {
    const { data, error } = await admin
      .from("crm_connections")
      .select("id")
      .eq("tenant_id", sellerA.tenantId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  // Deliberately NOT "owner can read" — 0010 grants zero seller policies on
  // this table on purpose (service-role only, same as portal_access_tokens
  // and waitlist_signups). An authenticated seller reading even their OWN
  // tenant's connection row directly would itself be a boundary defect.
  it("the owning tenant's own authenticated client sees ZERO rows — no seller policy exists by design", async () => {
    const { data, error } = await sellerA.scoped
      .from("crm_connections")
      .select("id")
      .eq("tenant_id", sellerA.tenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("an anonymous (unauthenticated) client sees ZERO rows", async () => {
    const { data, error } = await anonClient.from("crm_connections").select("id").eq("tenant_id", sellerA.tenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
