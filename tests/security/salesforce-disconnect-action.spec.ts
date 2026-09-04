// Sprint 11, Ticket 55 — behavioural coverage for
// app/settings/integrations/salesforce-actions.ts's disconnectSalesforce().
// Mirrors tests/security/hubspot-disconnect-action.spec.ts's mocking
// strategy byte-for-byte (that file's header is the canonical explanation,
// repeated in short form here):
//
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts, T39) — only the identity requireSeller()
//   resolves to is faked; the actual delete this action performs
//   (lib/crm-connections/token-store.ts's deleteTenantTokens) runs for real
//   against the live crm_connections table.
// - next/navigation's redirect() is mocked to a recorder that throws a
//   sentinel — disconnectSalesforce always redirects, never returns a value.
// - @/lib/salesforce/token-exchange's revokeRefreshToken is module-mocked,
//   per this ticket's brief — it is a real outbound call to Salesforce,
//   which this suite must never make.
//
// seedConnection() below writes `instance_url` — 0013_crm_connections_instance_url.sql
// (Sprint 11, Ticket 55) added that column to dev on 2026-09-04 (founder,
// via SQL Editor), so this file is no longer blocked on it. Still subject to
// the same shared-dev-Supabase-under-CI coordination as every other live
// spec in this directory (hubspot-disconnect-action.spec.ts's header) — run
// with `npx vitest run tests/security/salesforce-disconnect-action.spec.ts`
// in a coordinated slot. Prod does not yet have 0013 — applied at merge
// time, per this project's migration convention (docs/environments.md).
//
// Own dedicated fixture tenant (provisioned inline below) — afterAll only
// touches rows tagged with this run's own tenantId.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { isTenantConnected, saveTenantTokens } from "@/lib/crm-connections/token-store";
import type { SellerSession } from "@/lib/plans/require-seller";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createAdminClient();

const { redirectSentinel, redirectCalls, currentSellerSession, revokeRefreshToken } = vi.hoisted(() => ({
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectCalls: [] as string[],
  currentSellerSession: { value: null as SellerSession | null },
  revokeRefreshToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

vi.mock("@/lib/salesforce/token-exchange", () => ({ revokeRefreshToken }));

const { disconnectSalesforce } = await import("@/app/settings/integrations/salesforce-actions");

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-55-battery-disconnect";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t55-salesforce-disconnect-${runId}@example.com`;
  const companyName = `T55 salesforce disconnect ${runId}`;

  const result = await provisionSeller({ email, password: SELLER_PASSWORD, companyName });
  if (!result.ok) throw new Error(`provisionSeller failed: ${result.message}`);
  createdUserIds.push(result.userId);
  createdTenantIds.push(result.tenantId);
  return { tenantId: result.tenantId, userId: result.userId, email };
}

async function signInAsSeller(seller: SeededSeller): Promise<SupabaseClient> {
  const scoped = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });
  const { error } = await scoped.auth.signInWithPassword({ email: seller.email, password: SELLER_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${seller.email}: ${error.message}`);
  return scoped;
}

let sellerA: SeededSeller;
let sellerClient: SupabaseClient;

beforeAll(async () => {
  sellerA = await provisionTestSeller();
  sellerClient = await signInAsSeller(sellerA);
}, 60_000);

afterAll(async () => {
  try {
    await admin.from("crm_connections").delete().in("tenant_id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
    console.error("salesforce-disconnect-action cleanup — crm_connections failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("salesforce-disconnect-action cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`salesforce-disconnect-action cleanup — auth user ${userId} failed:`, error);
    }
  }

  await sellerClient?.auth.signOut().catch(() => undefined);
}, 60_000);

beforeEach(() => {
  redirectCalls.length = 0;
  revokeRefreshToken.mockReset();
  currentSellerSession.value = {
    client: sellerClient,
    userId: sellerA.userId,
    email: sellerA.email,
    tenantId: sellerA.tenantId,
  };
});

async function seedConnection(): Promise<void> {
  await saveTenantTokens({
    tenantId: sellerA.tenantId,
    provider: "salesforce",
    refreshToken: `t55-disconnect-refresh-${randomUUID()}`,
    scope: "api refresh_token",
    connectedBy: sellerA.userId,
    instanceUrl: "https://my-dev-org.my.salesforce.com",
  });
}

describe("disconnectSalesforce — auth precondition", () => {
  it("unauthenticated: redirects to /admin/login, never touches token-exchange or the DB", async () => {
    currentSellerSession.value = null;
    await seedConnection();

    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(await isTenantConnected(sellerA.tenantId, "salesforce")).toBe(true); // untouched
  });
});

describe("disconnectSalesforce — happy path (revoke succeeds)", () => {
  it("revokes on Salesforce, deletes the local row, and redirects with ?disconnected=salesforce", async () => {
    await seedConnection();
    revokeRefreshToken.mockResolvedValue(undefined);

    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(revokeRefreshToken).toHaveBeenCalledTimes(1);
    expect(redirectCalls).toEqual(["/settings/integrations?disconnected=salesforce"]);
    expect(await isTenantConnected(sellerA.tenantId, "salesforce")).toBe(false);
  });
});

describe("disconnectSalesforce — revoke fails (best-effort)", () => {
  it("still deletes the local row unconditionally, and redirects with ?warning=sf_revoke_failed", async () => {
    await seedConnection();
    revokeRefreshToken.mockRejectedValue(new Error("Salesforce rejected the revoke request (status 500)."));

    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual([`/settings/integrations?warning=${encodeURIComponent("sf_revoke_failed")}`]);
    expect(await isTenantConnected(sellerA.tenantId, "salesforce")).toBe(false);
  });
});

describe("disconnectSalesforce — nothing connected yet", () => {
  it("never calls revokeRefreshToken when there is no stored refresh token, and still redirects success", async () => {
    // No seedConnection() call — this tenant has no Salesforce row for this test.
    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(redirectCalls).toEqual(["/settings/integrations?disconnected=salesforce"]);
  });
});

describe("disconnectSalesforce — provider isolation", () => {
  it("never touches a HubSpot row for the same tenant", async () => {
    await saveTenantTokens({
      tenantId: sellerA.tenantId,
      provider: "hubspot",
      refreshToken: `t55-hubspot-sibling-${randomUUID()}`,
      scope: "crm.objects.deals.read",
      connectedBy: sellerA.userId,
    });
    await seedConnection();

    await expect(disconnectSalesforce(new FormData())).rejects.toBe(redirectSentinel);

    expect(await isTenantConnected(sellerA.tenantId, "salesforce")).toBe(false);
    expect(await isTenantConnected(sellerA.tenantId, "hubspot")).toBe(true); // untouched
  });
});
