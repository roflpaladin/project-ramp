// Sprint 10, Ticket 52 — behavioural coverage for
// app/settings/integrations/hubspot-actions.ts's disconnectHubSpot().
// Mirrors tests/security/csv-import-action.spec.ts's mocking strategy (that
// file's header comment is the canonical explanation, repeated in short
// form here):
//
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts, T39) — only the identity requireSeller()
//   resolves to is faked; the actual delete this action performs
//   (lib/hubspot/token-store.ts's deleteTenantTokens) runs for real against
//   the live crm_connections table (0010, already applied to dev — see
//   tests/security/crm-connections-store.spec.ts's header).
// - next/navigation's redirect() is mocked to a recorder that throws a
//   sentinel (onboarding-actions.spec.ts's pattern) — disconnectHubSpot
//   always redirects, never returns a value.
// - @/lib/hubspot/token-exchange's revokeRefreshToken is module-mocked, per
//   this ticket's brief — it is a real outbound call to HubSpot, which this
//   suite must never make. Both its success and (rejecting) failure paths
//   are exercised to prove the local delete still runs unconditionally.
//
// WRITTEN BUT NOT RUN in this session (shared dev Supabase project is under
// CI right now — same reason csv-import-action.spec.ts states). Run with
// `npx vitest run tests/security/hubspot-disconnect-action.spec.ts` in a
// coordinated slot.
//
// Own dedicated fixture tenant (provisioned inline below) — afterAll only
// touches rows tagged with this run's own tenantId.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { isTenantConnected, saveTenantTokens } from "@/lib/hubspot/token-store";
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

vi.mock("@/lib/hubspot/token-exchange", () => ({ revokeRefreshToken }));

const { disconnectHubSpot } = await import("@/app/settings/integrations/hubspot-actions");

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-52-battery-disconnect";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t52-hubspot-disconnect-${runId}@example.com`;
  const companyName = `T52 hubspot disconnect ${runId}`;

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
    console.error("hubspot-disconnect-action cleanup — crm_connections failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("hubspot-disconnect-action cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`hubspot-disconnect-action cleanup — auth user ${userId} failed:`, error);
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
    refreshToken: `t52-disconnect-refresh-${randomUUID()}`,
    scope: "crm.objects.deals.read",
    connectedBy: sellerA.userId,
  });
}

describe("disconnectHubSpot — auth precondition", () => {
  it("unauthenticated: redirects to /admin/login, never touches token-exchange or the DB", async () => {
    currentSellerSession.value = null;
    await seedConnection();

    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(await isTenantConnected(sellerA.tenantId)).toBe(true); // untouched
  });
});

describe("disconnectHubSpot — happy path (revoke succeeds)", () => {
  it("revokes on HubSpot, deletes the local row, and redirects with ?disconnected=1", async () => {
    await seedConnection();
    revokeRefreshToken.mockResolvedValue(undefined);

    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);

    expect(revokeRefreshToken).toHaveBeenCalledTimes(1);
    expect(redirectCalls).toEqual(["/settings/integrations?disconnected=1"]);
    expect(await isTenantConnected(sellerA.tenantId)).toBe(false);
  });
});

describe("disconnectHubSpot — revoke fails (best-effort)", () => {
  it("still deletes the local row unconditionally, and redirects with ?warning=revoke_failed", async () => {
    await seedConnection();
    revokeRefreshToken.mockRejectedValue(new Error("HubSpot rejected the revoke request (status 500)."));

    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/settings/integrations?warning=revoke_failed"]);
    expect(await isTenantConnected(sellerA.tenantId)).toBe(false);
  });
});

describe("disconnectHubSpot — nothing connected yet", () => {
  it("never calls revokeRefreshToken when there is no stored refresh token, and still redirects success", async () => {
    // No seedConnection() call — this tenant has no row for this test.
    await expect(disconnectHubSpot(new FormData())).rejects.toBe(redirectSentinel);

    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(redirectCalls).toEqual(["/settings/integrations?disconnected=1"]);
  });
});
