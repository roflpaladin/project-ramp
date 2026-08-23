// Ticket 45 (Sprint 9), Phase 2a — behavioural coverage for
// app/admin/import/import-actions.ts's importDealsFromCsv(). Mirrors
// tests/security/onboarding-actions.spec.ts's mocking strategy (that file's
// header comment is the canonical explanation, repeated in short form here):
//
// - @/lib/plans/require-seller's requireSeller() is mocked to hand back a
//   REAL, RLS-scoped Supabase client obtained via an actual
//   signInWithPassword() against a dedicated test seller (provisioned below
//   via lib/auth/provision-seller.ts, T39) — only the identity requireSeller()
//   resolves to is faked; every RLS/Postgres decision this suite asserts on
//   is the database's real answer.
// - next/navigation is NOT mocked here, unlike onboarding-actions.spec.ts:
//   importDealsFromCsv never calls redirect() (see import-actions.ts's own
//   header comment on why UNAUTHENTICATED is a returned state here, not a
//   redirect) — nothing in this file needs the sentinel-throw trick.
// - lib/rate-limit.ts's checkRateLimit is NOT mocked — it is the real
//   in-memory fixed window, reset via resetRateLimiterForTests() before every
//   test so ordering between tests in this file can never leak budget from
//   one test into another.
//
// WRITTEN BUT NOT RUN in this session (see the Phase 2a task brief): another
// session currently owns the shared dev-Supabase test slot. This file is
// complete and self-contained; run it in a coordinated slot with
// `npx vitest run tests/security/csv-import-action.spec.ts`.
//
// Own dedicated fixture (provisioned inline below) — this file's afterAll
// scans-and-deletes everything under its own freshly-provisioned tenant,
// never touching a concurrent session's rows.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { MAX_CSV_BYTES } from "@/lib/import/csv-limits";
import type { SellerSession } from "@/lib/plans/require-seller";
import { CSV_IMPORT_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createAdminClient();

const { currentSellerSession } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

const { importDealsFromCsv } = await import("@/app/admin/import/import-actions");
const { INITIAL_CSV_IMPORT_STATE, ...MESSAGES } = await import("@/app/admin/import/import-state");

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-45-battery-action";
const FUTURE_DATE = "2099-01-01";
const CSV_HEADER = "company_name,company_domain,contact_email,plan_title,target_date";

interface SeededSeller {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function provisionTestSeller(): Promise<SeededSeller> {
  const email = `t45-csv-action-${runId}@example.com`;
  const companyName = `T45 csv import action ${runId}`;

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

/** Same FK-safe teardown order as tests/security/onboarding-actions.spec.ts's teardownWorkspace. */
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
        console.error(`csv-import-action cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("csv-import-action cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("csv-import-action cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`csv-import-action cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

beforeEach(() => {
  resetRateLimiterForTests();
  currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: sellerA.tenantId };
});

async function workspaceCountForTenant(): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
  return data?.length ?? 0;
}

function formDataWithFile(content: string, filename = "deals.csv"): FormData {
  const formData = new FormData();
  formData.set("file", new File([content], filename, { type: "text/csv" }));
  return formData;
}

function csvFor(rows: Array<{ name: string; domain: string; email: string; title: string }>): string {
  return [
    CSV_HEADER,
    ...rows.map((r) => `"${r.name}",${r.domain},${r.email},"${r.title}",${FUTURE_DATE}`),
  ].join("\n");
}

describe("importDealsFromCsv — auth and session preconditions", () => {
  it("unauthenticated: returns the UNAUTHENTICATED message state and writes nothing", async () => {
    currentSellerSession.value = null;
    const before = await workspaceCountForTenant();

    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formDataWithFile(csvFor([])));

    expect(result).toEqual({ error: MESSAGES.UNAUTHENTICATED_MESSAGE, summary: null });
    expect(await workspaceCountForTenant()).toBe(before);
  });

  it("null tenantId: returns the missing-tenant message state without touching the database", async () => {
    currentSellerSession.value = { client: sellerClient, userId: sellerA.userId, email: sellerA.email, tenantId: null };

    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formDataWithFile(csvFor([])));

    expect(result).toEqual({ error: MESSAGES.MISSING_TENANT_MESSAGE, summary: null });
  });
});

describe("importDealsFromCsv — file preconditions, checked before parse", () => {
  it("missing file: returns the missing-file message, never calls parseCsv", async () => {
    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, new FormData());
    expect(result).toEqual({ error: MESSAGES.MISSING_FILE_MESSAGE, summary: null });
  });

  it("empty file (0 bytes): returns the empty-file message", async () => {
    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formDataWithFile(""));
    expect(result).toEqual({ error: MESSAGES.EMPTY_FILE_MESSAGE, summary: null });
  });

  it("oversized file: rejected on File.size before ever being read into memory or parsed", async () => {
    const before = await workspaceCountForTenant();
    const oversized = new File([Buffer.alloc(MAX_CSV_BYTES + 1024, "a")], "big.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.set("file", oversized);

    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formData);

    expect(result).toEqual({ error: MESSAGES.FILE_TOO_LARGE_MESSAGE, summary: null });
    expect(await workspaceCountForTenant()).toBe(before);
  });
});

describe("importDealsFromCsv — rate limiting", () => {
  it("allows the budgeted calls, then returns the rate-limit message without parsing/writing", async () => {
    const before = await workspaceCountForTenant();

    for (let call = 0; call < CSV_IMPORT_RATE_LIMIT.limit; call += 1) {
      const csv = csvFor([
        {
          name: `T45 ratelimit ${call} — ${runId}`,
          domain: `t45-ratelimit-${call}-${runId}.example.com`,
          email: `buyer-ratelimit-${call}-${runId}@example.com`,
          title: "Plan",
        },
      ]);
      const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formDataWithFile(csv));
      expect(result.error).toBeNull();
      expect(result.summary).toEqual({ total: 1, succeeded: 1, failed: 0, failures: [] });
    }
    expect(await workspaceCountForTenant()).toBe(before + CSV_IMPORT_RATE_LIMIT.limit);

    const overBudget = await importDealsFromCsv(
      INITIAL_CSV_IMPORT_STATE,
      formDataWithFile(csvFor([{ name: "Over budget", domain: "over-budget.example.com", email: "x@example.com", title: "Plan" }])),
    );

    expect(overBudget).toEqual({ error: MESSAGES.RATE_LIMITED_MESSAGE, summary: null });
    // The refusal happens before parse+write — budget exhaustion writes nothing extra.
    expect(await workspaceCountForTenant()).toBe(before + CSV_IMPORT_RATE_LIMIT.limit);
  });
});

describe("importDealsFromCsv — happy path and partial-failure summary", () => {
  it("2 good rows + 1 content-invalid row: correct summary, good rows persisted under the tenant, bad row absent", async () => {
    const before = await workspaceCountForTenant();
    const domainA = `t45-action-mixed-a-${runId}.example.com`;
    const domainB = `t45-action-mixed-b-${runId}.example.com`;
    const csv = [
      CSV_HEADER,
      `"T45 action mixed A — ${runId}",${domainA},buyer-a-${runId}@example.com,"Plan A",${FUTURE_DATE}`,
      // target_date malformed -> fails content validation, never reaches the DB.
      `"T45 action mixed bad — ${runId}",t45-action-mixed-bad-${runId}.example.com,buyer-bad-${runId}@example.com,"Plan bad",not-a-date`,
      `"T45 action mixed B — ${runId}",${domainB},buyer-b-${runId}@example.com,"Plan B",${FUTURE_DATE}`,
    ].join("\n");

    const result = await importDealsFromCsv(INITIAL_CSV_IMPORT_STATE, formDataWithFile(csv));

    expect(result.error).toBeNull();
    expect(result.summary?.total).toBe(3);
    expect(result.summary?.succeeded).toBe(2);
    expect(result.summary?.failed).toBe(1);
    expect(result.summary?.failures).toEqual([
      { rowNumber: 2, errors: expect.arrayContaining([expect.stringContaining("target_date")]) },
    ]);

    expect(await workspaceCountForTenant()).toBe(before + 2);

    const { data: workspaceA } = await admin
      .from("workspaces")
      .select("id, target_company_name")
      .eq("tenant_id", sellerA.tenantId)
      .eq("target_domain", domainA)
      .maybeSingle();
    expect(workspaceA?.target_company_name).toBe(`T45 action mixed A — ${runId}`);

    const { data: badWorkspace } = await admin
      .from("workspaces")
      .select("id")
      .eq("tenant_id", sellerA.tenantId)
      .eq("target_domain", `t45-action-mixed-bad-${runId}.example.com`)
      .maybeSingle();
    expect(badWorkspace).toBeNull();
  });
});
