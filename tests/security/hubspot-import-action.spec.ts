// Sprint 10, Ticket 53 — behavioural coverage for
// app/admin/import/hubspot/hubspot-import-actions.ts's listHubSpotDeals(),
// importHubSpotDeals(), and submitHubSpotImport(). Mirrors
// tests/security/csv-import-action.spec.ts's mocking strategy (that file's
// own header is the canonical explanation, repeated in short form here):
//
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts) — only the identity requireSeller()
//   resolves to is faked; every RLS/Postgres decision this suite asserts on
//   is the database's real answer.
// - @/lib/crm-import/hubspot-adapter is module-mocked: this suite is about
//   auth/connection/rate-limit coverage and the write pipeline's real DB
//   behaviour, not HubSpot's own HTTP surface (that is
//   tests/hubspot/hubspot-adapter.spec.ts's job) — a fake adapter returning
//   fixed CrmDealDetail/CrmDealSummary values stands in for it here.
// - @/lib/crm-connections/token-store's isTenantConnected is mocked directly rather
//   than provisioning a real crm_connections row — connection state is a
//   simple boolean gate this suite needs to flip per test, not something
//   worth a real OAuth fixture for.
// - lib/rate-limit.ts's checkRateLimit is NOT mocked — it is the real
//   in-memory fixed window, reset via resetRateLimiterForTests() before
//   every test so ordering between tests in this file can never leak budget
//   from one test into another.
//
// WRITTEN BUT NOT RUN in this session: the shared dev-Supabase test slot is
// busy with CI + a peer session. This file is complete and self-contained;
// run it in a coordinated slot with
// `npx vitest run tests/security/hubspot-import-action.spec.ts`.
//
// Own dedicated fixture (provisioned inline below) — this file's afterAll
// scans-and-deletes everything under its own freshly-provisioned tenant,
// never touching a concurrent session's rows.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { MAX_HUBSPOT_IMPORT_DEALS } from "@/lib/crm-import/import-limits";
import type { CrmAdapterListDealsResult, CrmDealDetail, CrmDealDetailResult } from "@/lib/crm-import/types";
import type { SellerSession } from "@/lib/plans/require-seller";
import { HUBSPOT_IMPORT_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createAdminClient();

const { currentSellerSession } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
}));
const { isTenantConnectedMock } = vi.hoisted(() => ({ isTenantConnectedMock: vi.fn() }));
const { listDealsMock, getDealDetailMock } = vi.hoisted(() => ({
  listDealsMock: vi.fn(),
  getDealDetailMock: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));
vi.mock("@/lib/crm-connections/token-store", () => ({ isTenantConnected: isTenantConnectedMock }));
vi.mock("@/lib/crm-import/hubspot-adapter", () => ({
  createHubSpotAdapter: () => ({
    provider: "hubspot" as const,
    listDeals: listDealsMock,
    getDealDetail: getDealDetailMock,
  }),
}));

const { listHubSpotDeals, importHubSpotDeals, submitHubSpotImport } = await import(
  "@/app/admin/import/hubspot/hubspot-import-actions"
);
const { INITIAL_HUBSPOT_IMPORT_STATE, ...MESSAGES } = await import(
  "@/app/admin/import/hubspot/hubspot-import-state"
);

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-53-battery-action";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t53-hubspot-action-${runId}@example.com`;
  const companyName = `T53 hubspot import action ${runId}`;

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

/** Same FK-safe teardown order as tests/security/csv-import-action.spec.ts's teardownWorkspace. */
async function teardownWorkspace(workspaceId: string): Promise<void> {
  const { data: plans } = await admin.from("success_plans").select("id").eq("workspace_id", workspaceId);
  const planIds = (plans ?? []).map((row) => row.id as string);

  if (planIds.length > 0) {
    const { data: stages } = await admin.from("plan_stages").select("id").in("plan_id", planIds);
    const stageIds = (stages ?? []).map((row) => row.id as string);
    if (stageIds.length > 0) {
      await admin.from("plan_steps").delete().in("stage_id", stageIds);
    }
    await admin.from("plan_stages").delete().in("plan_id", planIds);
    await admin.from("success_plans").delete().in("id", planIds);
  }

  await admin.from("links").delete().eq("workspace_id", workspaceId);
  await admin.from("workspaces").delete().eq("id", workspaceId);
}

let sellerA: SeededSeller;
let sellerClient: SupabaseClient;

beforeAll(async () => {
  sellerA = await provisionTestSeller();
  sellerClient = await signInAsSeller(sellerA);
}, 60_000);

afterAll(async () => {
  try {
    const { data: workspaces } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
    for (const workspace of workspaces ?? []) {
      try {
        await teardownWorkspace(workspace.id as string);
      } catch (error: unknown) {
        // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
        console.error(`hubspot-import-action cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("hubspot-import-action cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("hubspot-import-action cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`hubspot-import-action cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

async function workspaceCountForTenant(): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
  return data?.length ?? 0;
}

function dealDetail(externalId: string, overrides: Partial<CrmDealDetail> = {}): CrmDealDetail {
  return {
    externalId,
    dealName: `T53 action deal ${externalId} — ${runId}`,
    amount: "1000",
    stage: "appointmentscheduled",
    closeDate: "2099-01-01",
    companyName: `T53 action co ${externalId} — ${runId}`,
    // externalId already carries this file's full runId (every call site
    // below embeds it), so appending -${runId} again duplicated the UUID
    // within the leading DNS label, pushing it past the real 63-char label
    // limit lib/domain.ts's isValidDomain correctly enforces — every "good"
    // deal in this file was silently invalid_data as a result. Fixed by not
    // doubling it.
    companyDomain: `t53-action-${externalId}.example.com`,
    contactEmail: `buyer-${externalId}-${runId}@example.com`,
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimiterForTests();
  isTenantConnectedMock.mockReset();
  listDealsMock.mockReset();
  getDealDetailMock.mockReset();
  isTenantConnectedMock.mockResolvedValue(true);
  currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: sellerA.tenantId };
});

describe("listHubSpotDeals — auth and connection preconditions", () => {
  it("unauthenticated: returns an 'unknown' failure, never calls the adapter", async () => {
    currentSellerSession.value = null;

    const result = await listHubSpotDeals();

    expect(result).toEqual({ ok: false, reason: "unknown", message: MESSAGES.UNAUTHENTICATED_MESSAGE, reconnectRequired: false });
    expect(listDealsMock).not.toHaveBeenCalled();
  });

  it("null tenantId: returns an 'unknown' failure without touching the adapter", async () => {
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: null };

    const result = await listHubSpotDeals();

    expect(result.ok).toBe(false);
    expect(listDealsMock).not.toHaveBeenCalled();
  });

  it("not connected: returns token_expired, reconnectRequired true, never calls the adapter", async () => {
    isTenantConnectedMock.mockResolvedValue(false);

    const result = await listHubSpotDeals();

    expect(result).toEqual({ ok: false, reason: "token_expired", message: MESSAGES.NOT_CONNECTED_MESSAGE, reconnectRequired: true });
    expect(listDealsMock).not.toHaveBeenCalled();
  });
});

describe("listHubSpotDeals — rate limiting", () => {
  it("allows the budgeted calls, then rate-limits without calling the adapter again", async () => {
    const emptyListResult: CrmAdapterListDealsResult = { ok: true, deals: [] };
    listDealsMock.mockResolvedValue(emptyListResult);

    for (let call = 0; call < HUBSPOT_IMPORT_RATE_LIMIT.limit; call += 1) {
      const result = await listHubSpotDeals();
      expect(result.ok).toBe(true);
    }
    expect(listDealsMock).toHaveBeenCalledTimes(HUBSPOT_IMPORT_RATE_LIMIT.limit);

    const overBudget = await listHubSpotDeals();

    expect(overBudget).toEqual({ ok: false, reason: "rate_limited", message: MESSAGES.RATE_LIMITED_MESSAGE, reconnectRequired: false });
    expect(listDealsMock).toHaveBeenCalledTimes(HUBSPOT_IMPORT_RATE_LIMIT.limit);
  });
});

describe("listHubSpotDeals — already-imported filter (SETTLED decision)", () => {
  it("filters out a deal already imported under this tenant, and reports alreadyImportedCount", async () => {
    const detail = dealDetail(`already-${runId}`);
    const { writeCrmImport } = await import("@/lib/crm-import/write-crm-import");
    const { mapDealToWorkspace } = await import("@/lib/crm-import/map-deal-to-workspace");
    await writeCrmImport([mapDealToWorkspace(detail)], { tenantId: sellerA.tenantId, userId: sellerA.userId }, sellerClient);

    listDealsMock.mockResolvedValue({
      ok: true,
      deals: [
        { externalId: detail.externalId, name: detail.dealName!, amount: 1000, stage: "Appointment scheduled", companyName: detail.companyName },
        { externalId: "not-yet-imported", name: "Fresh deal", amount: null, stage: "Appointment scheduled", companyName: "Fresh Co" },
      ],
    } satisfies CrmAdapterListDealsResult);

    const result = await listHubSpotDeals();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => d.externalId)).toEqual(["not-yet-imported"]);
    expect(result.alreadyImportedCount).toBe(1);
  });
});

describe("importHubSpotDeals — auth, connection, and rate-limit preconditions (SETTLED shapes)", () => {
  it("unauthenticated: one 'unknown' failure per requested id, writes nothing", async () => {
    currentSellerSession.value = null;
    const before = await workspaceCountForTenant();

    const result = await importHubSpotDeals(["deal-1", "deal-2"]);

    expect(result.status).toBe("failed");
    expect(result.totalCount).toBe(2);
    expect(result.failures).toEqual([
      { externalId: "deal-1", reason: "unknown", message: MESSAGES.UNAUTHENTICATED_MESSAGE },
      { externalId: "deal-2", reason: "unknown", message: MESSAGES.UNAUTHENTICATED_MESSAGE },
    ]);
    expect(await workspaceCountForTenant()).toBe(before);
  });

  it("not connected: one token_expired failure per requested id, status failed, reconnectRequired true (SETTLED)", async () => {
    isTenantConnectedMock.mockResolvedValue(false);

    const result = await importHubSpotDeals(["deal-1", "deal-2", "deal-3"]);

    expect(result.status).toBe("failed");
    expect(result.totalCount).toBe(3);
    expect(result.importedCount).toBe(0);
    expect(result.reconnectRequired).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.failures.every((f) => f.reason === "token_expired")).toBe(true);
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });

  it("rate limited: one rate_limited failure per requested id after the budget is exhausted", async () => {
    getDealDetailMock.mockResolvedValue({
      ok: false,
      reason: "unknown",
      message: "should not be reached",
    } satisfies CrmDealDetailResult);

    for (let call = 0; call < HUBSPOT_IMPORT_RATE_LIMIT.limit; call += 1) {
      await importHubSpotDeals([]);
    }

    const overBudget = await importHubSpotDeals(["deal-1"]);

    expect(overBudget.failures).toEqual([{ externalId: "deal-1", reason: "rate_limited", message: MESSAGES.RATE_LIMITED_MESSAGE }]);
  });

  it("empty selection: returns a vacuous complete result (0/0/0), never calls the adapter", async () => {
    const result = await importHubSpotDeals([]);

    expect(result).toEqual(expect.objectContaining({ status: "complete", totalCount: 0, importedCount: 0, failedCount: 0 }));
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });
});

// Code review (HIGH, security): a hard server-side cap on batch size —
// before this, nothing stopped a caller invoking importHubSpotDeals()
// directly (bypassing the picker UI entirely) with an arbitrarily large
// externalIds array.
describe("importHubSpotDeals — batch-size cap (SETTLED shape, code review HIGH)", () => {
  it("over-cap selection: one 'invalid_data' failure per requested id, adapter never called", async () => {
    const overCapIds = Array.from({ length: MAX_HUBSPOT_IMPORT_DEALS + 1 }, (_, i) => `cap-${i}-${runId}`);

    const result = await importHubSpotDeals(overCapIds);

    expect(result.status).toBe("failed");
    expect(result.totalCount).toBe(overCapIds.length);
    expect(result.failures.every((f) => f.reason === "invalid_data" && f.message === MESSAGES.TOO_MANY_DEALS_SELECTED_MESSAGE)).toBe(
      true,
    );
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });

  it("exactly-at-cap selection is NOT rejected by this guard (boundary check) — reaches the adapter", async () => {
    const atCapIds = Array.from({ length: MAX_HUBSPOT_IMPORT_DEALS }, (_, i) => `at-cap-${i}-${runId}`);
    getDealDetailMock.mockResolvedValue({
      ok: false,
      reason: "invalid_data",
      message: "irrelevant to this boundary check",
    } satisfies CrmDealDetailResult);

    await importHubSpotDeals(atCapIds);

    expect(getDealDetailMock).toHaveBeenCalledTimes(MAX_HUBSPOT_IMPORT_DEALS);
  });
});

describe("importHubSpotDeals — happy path and partial-failure summary", () => {
  it("one good deal + one invalid_data deal (no company domain) -> correct summary, good deal persisted", async () => {
    const before = await workspaceCountForTenant();
    const goodId = `action-good-${runId}`;
    const badId = `action-bad-${runId}`;

    getDealDetailMock.mockImplementation(async (_tenantId: string, externalId: string) => {
      if (externalId === goodId) {
        return { ok: true, detail: dealDetail(goodId) } satisfies CrmDealDetailResult;
      }
      return { ok: true, detail: dealDetail(badId, { companyDomain: null }) } satisfies CrmDealDetailResult;
    });

    const result = await importHubSpotDeals([goodId, badId]);

    expect(result.status).toBe("partial");
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures[0]).toEqual(
      expect.objectContaining({ externalId: badId, reason: "invalid_data" }),
    );
    expect(await workspaceCountForTenant()).toBe(before + 1);
  });
});

// Code review (MEDIUM): action-level dedupe pre-check — importHubSpotDeals()
// re-checks already-imported status itself (dedupeAlreadyImported, right
// before writeCrmImport), independent of listHubSpotDeals()'s own picker
// filter, so a caller invoking this action directly with a stale/tampered
// id list still cannot re-import a deal. write-crm-import.ts's 23505
// handling is this pre-check's own backstop for the TOCTOU race it cannot
// close by itself (see that module's header) — this test's job is the
// pre-check itself, not the backstop.
describe("importHubSpotDeals — action-level dedupe pre-check (SETTLED decision, code review MEDIUM)", () => {
  it("an already-imported externalId fails as 'already imported'; the good id in the same batch still writes", async () => {
    const { writeCrmImport, ALREADY_IMPORTED_MESSAGE } = await import("@/lib/crm-import/write-crm-import");
    const { mapDealToWorkspace } = await import("@/lib/crm-import/map-deal-to-workspace");

    const alreadyImportedDetail = dealDetail(`predupe-${runId}`);
    await writeCrmImport(
      [mapDealToWorkspace(alreadyImportedDetail)],
      { tenantId: sellerA.tenantId, userId: sellerA.userId },
      sellerClient,
    );

    const goodId = `predupe-good-${runId}`;
    const before = await workspaceCountForTenant();

    getDealDetailMock.mockImplementation(async (_tenantId: string, externalId: string) => {
      if (externalId === alreadyImportedDetail.externalId) {
        return { ok: true, detail: alreadyImportedDetail } satisfies CrmDealDetailResult;
      }
      return { ok: true, detail: dealDetail(goodId) } satisfies CrmDealDetailResult;
    });

    const result = await importHubSpotDeals([alreadyImportedDetail.externalId, goodId]);

    // Re-fetched (never trust client-sent fields — this file's own header),
    // but the pre-check below converts it to an already-imported failure
    // before writeCrmImport is ever asked to write it a second time.
    expect(getDealDetailMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("partial");
    expect(result.failures).toEqual([
      { externalId: alreadyImportedDetail.externalId, reason: "invalid_data", message: ALREADY_IMPORTED_MESSAGE },
    ]);
    expect(result.importedCount).toBe(1);
    // Exactly one NEW workspace (the good id) — no duplicate write attempted
    // for the already-imported id.
    expect(await workspaceCountForTenant()).toBe(before + 1);
  });
});

describe("submitHubSpotImport — form-action wrapper", () => {
  it("no deals selected: returns the no-deals-selected error, never calls importHubSpotDeals's pipeline", async () => {
    const formData = new FormData();

    const state = await submitHubSpotImport(INITIAL_HUBSPOT_IMPORT_STATE, formData);

    expect(state).toEqual({ error: MESSAGES.NO_DEALS_SELECTED_MESSAGE, result: null });
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });

  it("unauthenticated: returns the unauthenticated error before even reading the form", async () => {
    currentSellerSession.value = null;
    const formData = new FormData();
    formData.append("externalId", "deal-1");

    const state = await submitHubSpotImport(INITIAL_HUBSPOT_IMPORT_STATE, formData);

    expect(state).toEqual({ error: MESSAGES.UNAUTHENTICATED_MESSAGE, result: null });
  });

  it("extracts checked externalId values and forwards them to the import pipeline", async () => {
    const id = `submit-${runId}`;
    getDealDetailMock.mockResolvedValue({ ok: true, detail: dealDetail(id) } satisfies CrmDealDetailResult);
    const formData = new FormData();
    formData.append("externalId", id);

    const state = await submitHubSpotImport(INITIAL_HUBSPOT_IMPORT_STATE, formData);

    expect(state.error).toBeNull();
    expect(state.result?.importedCount).toBe(1);
  });
});
