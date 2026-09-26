// Sprint 12, Ticket 60. The go-live GATE:
// app/admin/workspaces/[id]/plan/plan-actions.ts's markPlanLiveAction and
// the lib/plans/go-live.ts flow behind it.
//
// Deliberately a NEW file rather than more cases in
// tests/security/mark-plan-live-action.spec.ts: that suite seeds real rows
// in the shared dev Supabase project, and migration 0015 (which adds
// mark_plan_live() and workspaces.is_sample) is not applied there yet — the
// project's migration workflow is a manual SQL Editor paste. Everything the
// gate decides is ours, not Postgres's, so it is provable DB-free.
//
// The entitlements below are built with the REAL resolveEntitlement rather
// than hand-shaped objects, so a change to the billing rules shows up here
// as a failing gate test instead of a stale fake that still passes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveEntitlement } from "@/lib/billing/entitlement";
import type { SellerSession } from "@/lib/plans/require-seller";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { currentSellerSession, revalidatedPaths, mockGetTenantEntitlement, mockMarkPlanLive } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
  revalidatedPaths: [] as string[],
  mockGetTenantEntitlement: vi.fn(),
  mockMarkPlanLive: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidatedPaths.push(path);
  }),
}));

vi.mock("@/lib/billing/tenant-entitlement", () => ({ getTenantEntitlement: mockGetTenantEntitlement }));
vi.mock("@/lib/plans/mark-live", () => ({ markPlanLive: mockMarkPlanLive }));

const { markPlanLiveAction } = await import("@/app/admin/workspaces/[id]/plan/plan-actions");

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-09-21T12:00:00.000Z");

const ACTIVE_PLAN_ROW = { id: PLAN_ID, workspace_id: WORKSPACE_ID, title: "Rollout", status: "active" };

/** Results the seller client's read-back will hand out, in order. */
let clientRows: { data: unknown; error: { message: string } | null }[] = [];

function fakeSellerClient(): SupabaseClient {
  const build = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const operation of ["select", "eq", "in", "order", "limit"]) {
      builder[operation] = () => builder;
    }
    builder.maybeSingle = () => Promise.resolve(clientRows.shift() ?? { data: null, error: null });
    return builder;
  };

  return { from: () => build() } as unknown as SupabaseClient;
}

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: TENANT_ID,
    paddleCustomerId: "ctm_1",
    paddleSubscriptionId: "sub_1",
    tierId: "pro",
    billingCycle: "month",
    status: "active",
    currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
    scheduledChange: null,
    pastDueSince: null,
    lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
    manualEntitlementTier: null,
    manualEntitlementNote: null,
    ...overrides,
  };
}

function givenEntitlement(sub: SubscriptionState | null): void {
  mockGetTenantEntitlement.mockResolvedValue(resolveEntitlement(sub, NOW));
}

beforeEach(() => {
  revalidatedPaths.length = 0;
  clientRows = [{ data: ACTIVE_PLAN_ROW, error: null }];
  currentSellerSession.value = {
    client: fakeSellerClient(),
    userId: "user-1",
    email: "seller@example.com",
    tenantId: TENANT_ID,
  };
  givenEntitlement(null);
  mockMarkPlanLive.mockResolvedValue("live");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockGetTenantEntitlement.mockReset();
  mockMarkPlanLive.mockReset();
});

describe("markPlanLiveAction — happy path", () => {
  it("makes the plan live and returns the row the database ended up with", async () => {
    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: true, data: ACTIVE_PLAN_ROW });
  });

  it("hands the tier's cap down to the database rather than deciding the limit in app code", async () => {
    givenEntitlement(subscription({ tierId: "starter" }));

    await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(mockMarkPlanLive).toHaveBeenCalledWith({
      planId: PLAN_ID,
      tenantId: TENANT_ID,
      maxActiveDeals: 3,
    });
  });

  it("passes null for an invoice customer, who never meets a cap", async () => {
    givenEntitlement(subscription({ manualEntitlementTier: "enterprise" }));

    await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(mockMarkPlanLive).toHaveBeenCalledWith(expect.objectContaining({ maxActiveDeals: null }));
  });

  it("refreshes both the plan page and the workspace page", async () => {
    await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(revalidatedPaths).toEqual([
      `/admin/workspaces/${WORKSPACE_ID}/plan`,
      `/admin/workspaces/${WORKSPACE_ID}`,
    ]);
  });

  it("refreshes the workspace the ROW says it belongs to, not the one the caller named", async () => {
    // B6: the read-back row is server-derived; the argument came from a URL.
    // They agree in every real flow — preferring the row costs nothing and
    // means a stale or tampered argument cannot misdirect the refresh.
    const realWorkspaceId = "66666666-6666-6666-6666-666666666666";
    clientRows = [{ data: { ...ACTIVE_PLAN_ROW, workspace_id: realWorkspaceId }, error: null }];

    await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(revalidatedPaths).toEqual([
      `/admin/workspaces/${realWorkspaceId}/plan`,
      `/admin/workspaces/${realWorkspaceId}`,
    ]);
  });

  it("treats 'already_live' as success — a second click is not a failure", async () => {
    mockMarkPlanLive.mockResolvedValue("already_live");

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result.ok).toBe(true);
  });
});

describe("markPlanLiveAction — the limit", () => {
  it("returns DEAL_LIMIT_REACHED when the database refuses at the cap", async () => {
    mockMarkPlanLive.mockResolvedValue("limit_reached");

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "DEAL_LIMIT_REACHED" });
    expect(revalidatedPaths).toEqual([]);
  });

  it("honours the database's verdict even when the entitlement alone would allow it", async () => {
    // Two tabs at the cap: our own read said "unlimited", the locked count
    // inside mark_plan_live() disagreed. The database wins.
    givenEntitlement(subscription({ tierId: "advanced" }));
    mockMarkPlanLive.mockResolvedValue("limit_reached");

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "DEAL_LIMIT_REACHED" });
  });

  it("returns SAMPLE_DEAL_LOCKED when the plan lives in the sample workspace", async () => {
    // Reachable with plain UI clicks: close the sample as Won, start a new
    // plan in that same workspace, press "make it live". The sample is never
    // counted, so it must never be able to carry a real deal.
    mockMarkPlanLive.mockResolvedValue("sample_workspace");

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "SAMPLE_DEAL_LOCKED" });
    expect(revalidatedPaths).toEqual([]);
  });

  it("returns NOT_FOUND when the plan is gone, closed, or in another tenant", async () => {
    mockMarkPlanLive.mockResolvedValue("not_found");

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when the read-back finds nothing the seller can see", async () => {
    clientRows = [{ data: null, error: null }];

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("markPlanLiveAction — billing state", () => {
  it("refuses a new deal with BILLING_PAST_DUE once the grace has ended, without touching the database", async () => {
    givenEntitlement(subscription({ status: "past_due", pastDueSince: "2026-08-01T00:00:00.000Z" }));

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "BILLING_PAST_DUE" });
    expect(mockMarkPlanLive).not.toHaveBeenCalled();
  });

  it("still lets a past-due seller inside the grace window go live", async () => {
    givenEntitlement(subscription({ status: "past_due", pastDueSince: "2026-09-20T12:00:00.000Z" }));

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result.ok).toBe(true);
  });

  it("lets an invoice customer through even when Paddle says they are long past due", async () => {
    givenEntitlement(
      subscription({
        status: "past_due",
        pastDueSince: "2026-08-01T00:00:00.000Z",
        manualEntitlementTier: "enterprise",
      }),
    );

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result.ok).toBe(true);
    expect(mockMarkPlanLive).toHaveBeenCalledWith(expect.objectContaining({ maxActiveDeals: null }));
  });
});

describe("markPlanLiveAction — failing closed", () => {
  it("returns UNAUTHENTICATED and reads no billing state at all when there is no session", async () => {
    currentSellerSession.value = null;

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mockGetTenantEntitlement).not.toHaveBeenCalled();
  });

  it("refuses — and never guesses a tier — when the session carries no tenant claim", async () => {
    currentSellerSession.value = { ...currentSellerSession.value!, tenantId: null };

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "BILLING_CHECK_FAILED" });
    expect(mockMarkPlanLive).not.toHaveBeenCalled();
  });

  it("returns BILLING_CHECK_FAILED — never the upgrade wall — when the billing read fails", async () => {
    mockGetTenantEntitlement.mockRejectedValue(new Error("Failed to read the tenant subscription: timeout"));

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "BILLING_CHECK_FAILED" });
    expect(mockMarkPlanLive).not.toHaveBeenCalled();
  });

  it("logs the failed billing read with the tenant id, and never swallows it silently", async () => {
    mockGetTenantEntitlement.mockRejectedValue(new Error("timeout"));

    await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(TENANT_ID), expect.anything());
  });

  it("returns UNKNOWN_ERROR when the go-live call itself throws", async () => {
    mockMarkPlanLive.mockRejectedValue(new Error("Failed to mark the plan live: connection reset"));

    const result = await markPlanLiveAction(WORKSPACE_ID, PLAN_ID);

    expect(result).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(revalidatedPaths).toEqual([]);
  });
});
