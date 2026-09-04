// Sprint 11, Ticket 56 — behavioural coverage for
// app/admin/import/salesforce/salesforce-import-actions.ts's
// listSalesforceDeals(), importSalesforceDeals(), and
// submitSalesforceImport(). Full parity with
// tests/security/hubspot-import-action.spec.ts's mocking strategy (that
// file's own header is the canonical explanation, repeated in short form
// here):
//
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts) — only the identity requireSeller()
//   resolves to is faked; every RLS/Postgres decision this suite asserts on
//   is the database's real answer.
// - @/lib/crm-import/salesforce-adapter is module-mocked: this suite is
//   about auth/connection/rate-limit coverage and the write pipeline's real
//   DB behaviour, not Salesforce's own HTTP surface (that is
//   tests/salesforce/salesforce-adapter.spec.ts's job).
// - @/lib/crm-connections/token-store's isTenantConnected is mocked directly
//   rather than provisioning a real crm_connections row.
// - lib/rate-limit.ts's checkRateLimit is NOT mocked — it is the real
//   in-memory fixed window, reset via resetRateLimiterForTests() before
//   every test.
//
// Own dedicated fixture (provisioned inline below) — this file's afterAll
// scans-and-deletes everything under its own freshly-provisioned tenant,
// never touching a concurrent session's rows. Run with
// `npx vitest run tests/security/salesforce-import-action.spec.ts` in a
// coordinated dev-Supabase slot (see tests/security/hubspot-import-action.spec.ts's
// own header on the shared-dev-DB contention this project runs under).

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { MAX_CRM_IMPORT_DEALS } from "@/lib/crm-import/import-limits";
import type { CrmAdapterListDealsResult, CrmDealDetail, CrmDealDetailResult } from "@/lib/crm-import/types";
import type { SellerSession } from "@/lib/plans/require-seller";
import { CRM_IMPORT_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
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
vi.mock("@/lib/crm-import/salesforce-adapter", () => ({
  createSalesforceAdapter: () => ({
    provider: "salesforce" as const,
    listDeals: listDealsMock,
    getDealDetail: getDealDetailMock,
  }),
}));

const { listSalesforceDeals, importSalesforceDeals, submitSalesforceImport } = await import(
  "@/app/admin/import/salesforce/salesforce-import-actions"
);
const { INITIAL_SALESFORCE_IMPORT_STATE, ...MESSAGES } = await import(
  "@/app/admin/import/salesforce/salesforce-import-state"
);

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-56-battery-action";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t56-salesforce-action-${runId}@example.com`;
  const companyName = `T56 salesforce import action ${runId}`;

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

/** Same FK-safe teardown order as tests/security/hubspot-import-action.spec.ts's teardownWorkspace. */
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
        console.error(`salesforce-import-action cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("salesforce-import-action cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("salesforce-import-action cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`salesforce-import-action cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

async function workspaceCountForTenant(): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
  return data?.length ?? 0;
}

// Valid-shaped Salesforce ids (15-18 alphanumeric chars) — every externalId
// this file uses must pass salesforce-adapter.ts's own SOQL-injection guard
// were it exercised for real; getDealDetailMock stands in for the adapter
// here, but keeping ids realistic avoids this suite silently depending on
// adapter-mock behaviour a real adapter would reject.
function sfId(label: string): string {
  const hash = randomUUID().replace(/-/g, "").slice(0, 10);
  return `006${label}${hash}`.slice(0, 18).padEnd(15, "0");
}

function dealDetail(externalId: string, overrides: Partial<CrmDealDetail> = {}): CrmDealDetail {
  return {
    externalId,
    dealName: `T56 action deal ${externalId} — ${runId}`,
    amount: "1000",
    stage: "Qualification",
    closeDate: "2099-01-01",
    companyName: `T56 action co ${externalId} — ${runId}`,
    companyDomain: `t56-action-${externalId}.example.com`,
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

describe("listSalesforceDeals — auth and connection preconditions", () => {
  it("unauthenticated: returns an 'unknown' failure, never calls the adapter", async () => {
    currentSellerSession.value = null;

    const result = await listSalesforceDeals();

    expect(result).toEqual({ ok: false, reason: "unknown", message: MESSAGES.UNAUTHENTICATED_MESSAGE, reconnectRequired: false });
    expect(listDealsMock).not.toHaveBeenCalled();
  });

  it("null tenantId: returns an 'unknown' failure without touching the adapter", async () => {
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: null };

    const result = await listSalesforceDeals();

    expect(result.ok).toBe(false);
    expect(listDealsMock).not.toHaveBeenCalled();
  });

  it("not connected: returns token_expired, reconnectRequired true, never calls the adapter", async () => {
    isTenantConnectedMock.mockResolvedValue(false);

    const result = await listSalesforceDeals();

    expect(result).toEqual({ ok: false, reason: "token_expired", message: MESSAGES.NOT_CONNECTED_MESSAGE, reconnectRequired: true });
    expect(listDealsMock).not.toHaveBeenCalled();
  });
});

describe("listSalesforceDeals — rate limiting", () => {
  it("allows the budgeted calls, then rate-limits without calling the adapter again", async () => {
    const emptyListResult: CrmAdapterListDealsResult = { ok: true, deals: [] };
    listDealsMock.mockResolvedValue(emptyListResult);

    for (let call = 0; call < CRM_IMPORT_RATE_LIMIT.limit; call += 1) {
      const result = await listSalesforceDeals();
      expect(result.ok).toBe(true);
    }
    expect(listDealsMock).toHaveBeenCalledTimes(CRM_IMPORT_RATE_LIMIT.limit);

    const overBudget = await listSalesforceDeals();

    expect(overBudget).toEqual({ ok: false, reason: "rate_limited", message: MESSAGES.RATE_LIMITED_MESSAGE, reconnectRequired: false });
    expect(listDealsMock).toHaveBeenCalledTimes(CRM_IMPORT_RATE_LIMIT.limit);
  });
});

describe("listSalesforceDeals — already-imported filter, isolated per crmSource (SETTLED decision)", () => {
  it("filters out a deal already imported under this tenant's salesforce source, and reports alreadyImportedCount", async () => {
    const detail = dealDetail(sfId("ALREADY"));
    const { writeCrmImport } = await import("@/lib/crm-import/write-crm-import");
    const { mapDealToWorkspace } = await import("@/lib/crm-import/map-deal-to-workspace");
    await writeCrmImport(
      [mapDealToWorkspace(detail)],
      { tenantId: sellerA.tenantId, userId: sellerA.userId, crmSource: "salesforce" },
      sellerClient,
    );

    listDealsMock.mockResolvedValue({
      ok: true,
      deals: [
        { externalId: detail.externalId, name: detail.dealName!, amount: 1000, stage: "Qualification", companyName: detail.companyName },
        { externalId: sfId("FRESH"), name: "Fresh deal", amount: null, stage: "Qualification", companyName: "Fresh Co" },
      ],
    } satisfies CrmAdapterListDealsResult);

    const result = await listSalesforceDeals();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => d.externalId)).not.toContain(detail.externalId);
    expect(result.alreadyImportedCount).toBe(1);
  });
});

describe("importSalesforceDeals — auth, connection, and rate-limit preconditions (SETTLED shapes)", () => {
  it("unauthenticated: one 'unknown' failure per requested id, writes nothing", async () => {
    currentSellerSession.value = null;
    const before = await workspaceCountForTenant();

    const result = await importSalesforceDeals(["deal-1", "deal-2"]);

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

    const result = await importSalesforceDeals(["deal-1", "deal-2", "deal-3"]);

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

    for (let call = 0; call < CRM_IMPORT_RATE_LIMIT.limit; call += 1) {
      await importSalesforceDeals([]);
    }

    const overBudget = await importSalesforceDeals(["deal-1"]);

    expect(overBudget.failures).toEqual([{ externalId: "deal-1", reason: "rate_limited", message: MESSAGES.RATE_LIMITED_MESSAGE }]);
  });

  it("empty selection: returns a vacuous complete result (0/0/0), never calls the adapter", async () => {
    const result = await importSalesforceDeals([]);

    expect(result).toEqual(expect.objectContaining({ status: "complete", totalCount: 0, importedCount: 0, failedCount: 0 }));
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });
});

describe("importSalesforceDeals — batch-size cap (parity with hubspot-import-actions.ts's own guard)", () => {
  it("over-cap selection: one 'invalid_data' failure per requested id, adapter never called", async () => {
    const overCapIds = Array.from({ length: MAX_CRM_IMPORT_DEALS + 1 }, (_, i) => `cap-${i}-${runId}`);

    const result = await importSalesforceDeals(overCapIds);

    expect(result.status).toBe("failed");
    expect(result.totalCount).toBe(overCapIds.length);
    expect(result.failures.every((f) => f.reason === "invalid_data" && f.message === MESSAGES.TOO_MANY_DEALS_SELECTED_MESSAGE)).toBe(
      true,
    );
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });

  it("exactly-at-cap selection is NOT rejected by this guard (boundary check) — reaches the adapter", async () => {
    const atCapIds = Array.from({ length: MAX_CRM_IMPORT_DEALS }, (_, i) => `at-cap-${i}-${runId}`);
    getDealDetailMock.mockResolvedValue({
      ok: false,
      reason: "invalid_data",
      message: "irrelevant to this boundary check",
    } satisfies CrmDealDetailResult);

    await importSalesforceDeals(atCapIds);

    expect(getDealDetailMock).toHaveBeenCalledTimes(MAX_CRM_IMPORT_DEALS);
  });
});

describe("importSalesforceDeals — happy path and partial-failure summary", () => {
  it("one good deal + one invalid_data deal (no company domain) -> correct summary, good deal persisted", async () => {
    const before = await workspaceCountForTenant();
    const goodId = sfId("GOODDEAL01");
    const badId = sfId("BADDEAL001");

    getDealDetailMock.mockImplementation(async (_tenantId: string, externalId: string) => {
      if (externalId === goodId) {
        return { ok: true, detail: dealDetail(goodId) } satisfies CrmDealDetailResult;
      }
      return { ok: true, detail: dealDetail(badId, { companyDomain: null }) } satisfies CrmDealDetailResult;
    });

    const result = await importSalesforceDeals([goodId, badId]);

    expect(result.status).toBe("partial");
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures[0]).toEqual(
      expect.objectContaining({ externalId: badId, reason: "invalid_data" }),
    );
    expect(await workspaceCountForTenant()).toBe(before + 1);

    const workspace = await admin
      .from("workspaces")
      .select("crm_source")
      .eq("tenant_id", sellerA.tenantId)
      .eq("crm_object_id", goodId)
      .maybeSingle();
    expect(workspace.data?.crm_source).toBe("salesforce");
  });
});

describe("importSalesforceDeals — action-level dedupe pre-check (SETTLED decision, parity with hubspot)", () => {
  it("an already-imported externalId fails as 'already imported'; the good id in the same batch still writes", async () => {
    const { writeCrmImport, ALREADY_IMPORTED_MESSAGE } = await import("@/lib/crm-import/write-crm-import");
    const { mapDealToWorkspace } = await import("@/lib/crm-import/map-deal-to-workspace");

    const alreadyImportedDetail = dealDetail(sfId("PREDUPE001"));
    await writeCrmImport(
      [mapDealToWorkspace(alreadyImportedDetail)],
      { tenantId: sellerA.tenantId, userId: sellerA.userId, crmSource: "salesforce" },
      sellerClient,
    );

    const goodId = sfId("PREDUPEGOOD");
    const before = await workspaceCountForTenant();

    getDealDetailMock.mockImplementation(async (_tenantId: string, externalId: string) => {
      if (externalId === alreadyImportedDetail.externalId) {
        return { ok: true, detail: alreadyImportedDetail } satisfies CrmDealDetailResult;
      }
      return { ok: true, detail: dealDetail(goodId) } satisfies CrmDealDetailResult;
    });

    const result = await importSalesforceDeals([alreadyImportedDetail.externalId, goodId]);

    expect(getDealDetailMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("partial");
    expect(result.failures).toEqual([
      { externalId: alreadyImportedDetail.externalId, reason: "invalid_data", message: ALREADY_IMPORTED_MESSAGE },
    ]);
    expect(result.importedCount).toBe(1);
    expect(await workspaceCountForTenant()).toBe(before + 1);
  });
});

describe("submitSalesforceImport — form-action wrapper", () => {
  it("no deals selected: returns the no-deals-selected error, never calls importSalesforceDeals's pipeline", async () => {
    const formData = new FormData();

    const state = await submitSalesforceImport(INITIAL_SALESFORCE_IMPORT_STATE, formData);

    expect(state).toEqual({ error: MESSAGES.NO_DEALS_SELECTED_MESSAGE, result: null });
    expect(getDealDetailMock).not.toHaveBeenCalled();
  });

  it("unauthenticated: returns the unauthenticated error before even reading the form", async () => {
    currentSellerSession.value = null;
    const formData = new FormData();
    formData.append("externalId", "deal-1");

    const state = await submitSalesforceImport(INITIAL_SALESFORCE_IMPORT_STATE, formData);

    expect(state).toEqual({ error: MESSAGES.UNAUTHENTICATED_MESSAGE, result: null });
  });

  it("extracts checked externalId values and forwards them to the import pipeline", async () => {
    const id = sfId("SUBMITID01");
    getDealDetailMock.mockResolvedValue({ ok: true, detail: dealDetail(id) } satisfies CrmDealDetailResult);
    const formData = new FormData();
    formData.append("externalId", id);

    const state = await submitSalesforceImport(INITIAL_SALESFORCE_IMPORT_STATE, formData);

    expect(state.error).toBeNull();
    expect(state.result?.importedCount).toBe(1);
  });
});
