// Ticket 45 (Sprint 9), Phase 2a — behavioural coverage for
// lib/import/import-deals.ts's importDeals(). Live-Supabase spec (security
// project, serial, same reasoning as tests/plans/seed-sample-deal.spec.ts):
// the AC is about real inserts landing under RLS for the right tenant, and a
// real partial-write rollback — no mock can stand in for either.
//
// WRITTEN BUT NOT RUN in this session (see the Phase 2a task brief): another
// session currently owns the shared dev-Supabase test slot. This file is
// complete and self-contained; run it in a coordinated slot with
// `npx vitest run tests/import/import-deals.spec.ts`.
//
// Own dedicated fixture (provisioned inline below), mirroring
// tests/security/onboarding-actions.spec.ts's local provisionTestSeller —
// this file's afterAll scans-and-deletes everything under its own
// freshly-provisioned tenant, never touching a concurrent session's rows.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { importDeals, type ImportDealsContext } from "@/lib/import/import-deals";
import type { CsvRow } from "@/lib/import/parse-csv";
import { parseCsv } from "@/lib/import/parse-csv";
import { summarizeImport } from "@/lib/import/summarize-import";
import {
  validateImportRow,
  validateImportRows,
  type RowValidationResult,
  type ValidatedImportRow,
} from "@/lib/import/validate-rows";
import type { PlanWriteClient } from "@/lib/plans/write";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });

const runId = randomUUID();
const SELLER_PASSWORD = "correct-horse-45-battery";
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
  const email = `t45-csv-deals-${runId}@example.com`;
  const companyName = `T45 csv import deals ${runId}`;

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
let context: ImportDealsContext;

beforeAll(async () => {
  sellerA = await provisionTestSeller();
  sellerClient = await signInAsSeller(sellerA);
  context = { tenantId: sellerA.tenantId, userId: sellerA.userId };
}, 60_000);

afterAll(async () => {
  try {
    const { data: workspaces } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
    for (const workspace of workspaces ?? []) {
      try {
        await teardownWorkspace(workspace.id as string);
      } catch (error: unknown) {
        // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
        console.error(`import-deals cleanup — workspace ${workspace.id} failed:`, error);
      }
    }
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("import-deals cleanup — workspace scan failed:", error);
  }

  try {
    await admin.from("tenants").delete().in("id", createdTenantIds);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only
    console.error("import-deals cleanup — tenants failed:", error);
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`import-deals cleanup — auth user ${userId} failed:`, error);
    }
  }
}, 60_000);

async function workspaceCountForTenant(): Promise<number> {
  const { data } = await admin.from("workspaces").select("id").eq("tenant_id", sellerA.tenantId);
  return data?.length ?? 0;
}

async function workspaceByDomain(domain: string) {
  const { data } = await admin
    .from("workspaces")
    .select("id, target_company_name, target_domain, approved_emails")
    .eq("tenant_id", sellerA.tenantId)
    .eq("target_domain", domain)
    .maybeSingle();
  return data;
}

/**
 * Wraps a REAL, signed-in Supabase client so every table except `failingTable`
 * goes through untouched, and `failingTable`'s insert().select().single()
 * chain resolves with a synthetic Postgres-shaped error instead of hitting
 * the database. This is how the per-row rollback test below forces the
 * "workspace insert succeeded, plan insert failed" case — see that test's own
 * comment for why the real schema cannot organically produce this failure.
 */
function wrapClientFailingInsert(real: SupabaseClient, failingTable: string): PlanWriteClient {
  // Deliberately NOT `{ ...real, from: ... }` — spreading a Supabase client
  // class instance only copies its own enumerable properties, not its
  // prototype methods, so a spread copy is not a reliable stand-in for the
  // real client. Every call this module makes to the wrapped client goes
  // through this single `from` closure instead, which always delegates to
  // the closed-over `real` client for any table other than `failingTable`.
  const fakeError = { code: "XXTST", message: "forced test failure — never a real Postgres error" };
  return {
    from(table: string) {
      if (table !== failingTable) return real.from(table);
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: fakeError }),
          }),
        }),
      };
    },
  } as unknown as PlanWriteClient;
}

/**
 * Wraps a REAL client so `success_plans`'s insert AND `workspaces`'s delete
 * both fail — the "compensating rollback itself fails" case. workspaces's
 * insert still goes to the real client (forwarded via `real.from(table)
 * .insert(row)`, not reimplemented), since createWorkspaceForRow must
 * genuinely succeed first for this scenario to be the mid-row failure it
 * claims to be. The delete THROWS (not merely resolves with an `error`
 * field) — rollbackWorkspace's try/catch only guards a thrown rejection; a
 * resolved `{ error }` it never inspects would prove nothing about that
 * catch actually working.
 */
function wrapClientFailingPlanInsertAndWorkspaceDelete(real: SupabaseClient): PlanWriteClient {
  const insertError = { code: "XXTST", message: "forced test failure — plan insert (never a real Postgres error)" };
  return {
    from(table: string) {
      if (table === "success_plans") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: insertError }),
            }),
          }),
        };
      }
      if (table === "workspaces") {
        return {
          insert: (row: Record<string, unknown>) => real.from(table).insert(row),
          delete: () => ({
            eq: async () => {
              throw new Error("forced test failure — workspace delete (never a real Postgres error)");
            },
          }),
        };
      }
      return real.from(table);
    },
  } as unknown as PlanWriteClient;
}

function okRow(rowNumber: number, overrides: Partial<ValidatedImportRow> = {}): RowValidationResult {
  return {
    rowNumber,
    ok: true,
    value: {
      company_name: `T45 row ${rowNumber} — ${runId}`,
      company_domain: `t45-row-${rowNumber}-${runId}.example.com`,
      contact_email: `buyer-${rowNumber}-${runId}@example.com`,
      plan_title: `Rollout plan ${rowNumber}`,
      target_date: FUTURE_DATE,
      ...overrides,
    },
  };
}

describe("importDeals — full pipeline (parseCsv -> validateImportRows -> importDeals -> summarizeImport)", () => {
  it("happy path: 3 valid rows create 3 workspaces + 3 plans, each under the seller's tenant", async () => {
    const rows = [1, 2, 3].map((n) => ({
      name: `T45 happy ${n} — ${runId}`,
      domain: `t45-happy-${n}-${runId}.example.com`,
      email: `buyer-happy-${n}-${runId}@example.com`,
    }));
    const csv = [
      CSV_HEADER,
      ...rows.map((r) => `"${r.name}",${r.domain},${r.email},"Q1 rollout",${FUTURE_DATE}`),
    ].join("\n");

    const before = await workspaceCountForTenant();

    const parsed = parseCsv(Buffer.from(csv, "utf-8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validated = validateImportRows(parsed.rows);
    expect(validated.every((r) => r.ok)).toBe(true);

    const writeResults = await importDeals(validated, context, sellerClient);
    const summary = summarizeImport(writeResults);

    expect(summary).toEqual({ total: 3, succeeded: 3, failed: 0, failures: [] });
    expect(await workspaceCountForTenant()).toBe(before + 3);

    for (const r of rows) {
      const workspace = await workspaceByDomain(r.domain);
      expect(workspace?.target_company_name).toBe(r.name);
      expect(workspace?.approved_emails).toEqual([r.email]);

      const { data: plan } = await admin
        .from("success_plans")
        .select("title, target_date, workspace_id")
        .eq("workspace_id", workspace!.id)
        .maybeSingle();
      expect(plan?.title).toBe("Q1 rollout");
      expect(plan?.target_date).toBe(FUTURE_DATE);
    }
  });

  it("mixed batch: 2 valid rows + 1 content-invalid row -> correct summary, good rows persisted, bad row absent", async () => {
    const goodDomainA = `t45-mixed-a-${runId}.example.com`;
    const goodDomainB = `t45-mixed-b-${runId}.example.com`;
    const csv = [
      CSV_HEADER,
      `"T45 mixed A — ${runId}",${goodDomainA},buyer-a-${runId}@example.com,"Plan A",${FUTURE_DATE}`,
      // Row 2: company_name blank -> fails content validation, never reaches importDeals's DB step.
      `"",${`t45-mixed-bad-${runId}.example.com`},buyer-bad-${runId}@example.com,"Plan bad",${FUTURE_DATE}`,
      `"T45 mixed B — ${runId}",${goodDomainB},buyer-b-${runId}@example.com,"Plan B",${FUTURE_DATE}`,
    ].join("\n");

    const before = await workspaceCountForTenant();

    const parsed = parseCsv(Buffer.from(csv, "utf-8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validated = validateImportRows(parsed.rows);
    const writeResults = await importDeals(validated, context, sellerClient);
    const summary = summarizeImport(writeResults);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([
      { rowNumber: 2, errors: expect.arrayContaining([expect.stringContaining("company_name")]) },
    ]);

    expect(await workspaceCountForTenant()).toBe(before + 2);
    expect(await workspaceByDomain(goodDomainA)).not.toBeNull();
    expect(await workspaceByDomain(goodDomainB)).not.toBeNull();
    expect(await workspaceByDomain(`t45-mixed-bad-${runId}.example.com`)).toBeNull();
  });
});

describe("importDeals — company_domain is required by validate-rows.ts's schema, not a DB-writer-level check", () => {
  // Code review, Phase 2a: the "no domain" rejection moved UP into
  // lib/import/validate-rows.ts (workspaces.target_domain is NOT NULL,
  // 0001_init_schema.sql — see that module's ValidatedImportRow comment).
  // A row with a blank company_domain therefore never reaches importDeals as
  // an `ok: true` row at all; it arrives here already-failed and importDeals
  // must pass it through unchanged, exactly like any other content-invalid
  // row, without attempting a DB write.
  it("a row with no company_domain fails validateImportRow, then passes through importDeals unchanged with no DB write", async () => {
    const before = await workspaceCountForTenant();
    const csvRow: CsvRow = {
      company_name: `T45 no-domain — ${runId}`,
      company_domain: "",
      contact_email: `buyer-no-domain-${runId}@example.com`,
      plan_title: "Plan",
      target_date: FUTURE_DATE,
    };
    const validated = validateImportRow(csvRow, 1);
    expect(validated).toEqual({ rowNumber: 1, ok: false, errors: ["company_domain: is required."] });

    const [result] = await importDeals([validated], context, sellerClient);

    expect(result).toBe(validated);
    expect(await workspaceCountForTenant()).toBe(before);
  });
});

describe("importDeals — per-row rollback on a mid-row DB failure", () => {
  // The real schema gives no organic way to fail the SECOND insert
  // (success_plans) after the FIRST (workspaces) already succeeded for one
  // row in one importDeals() call: 0005's only relevant constraint
  // (idx_success_plans_one_live_per_workspace) is scoped per workspace_id,
  // and every row creates its own brand-new workspace_id — see
  // lib/import/import-deals.ts's header comment. A wrapped real client
  // (wrapClientFailingInsert above) is used instead to force the plan insert
  // to fail for exactly one table, so this test exercises the ACTUAL
  // importDeals()/importRow() rollback path end to end rather than asserting
  // it indirectly. The second `it` below (code review, Phase 2a) goes one
  // step further with wrapClientFailingPlanInsertAndWorkspaceDelete: the
  // compensating delete ALSO fails, proving rollbackWorkspace's try/catch
  // actually swallows that failure rather than letting it escape or
  // overwrite the row's real (plan-insert) error message.
  it("workspace insert succeeds, plan insert fails -> the row's own workspace is rolled back, no orphan remains", async () => {
    const before = await workspaceCountForTenant();
    const row = okRow(1, {
      company_domain: `t45-rollback-${runId}.example.com`,
      company_name: `T45 rollback — ${runId}`,
    });
    const failingClient = wrapClientFailingInsert(sellerClient, "success_plans");

    const [result] = await importDeals([row], context, failingClient);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rowNumber).toBe(1);
    expect(result.errors[0]).not.toMatch(/postgres|xxtst|forced test failure/i);

    expect(await workspaceCountForTenant()).toBe(before);
    expect(await workspaceByDomain(`t45-rollback-${runId}.example.com`)).toBeNull();
  });

  it("plan insert fails AND the compensating workspace delete also fails -> still reports ok:false with the ORIGINAL plan-insert message, no throw escapes", async () => {
    const before = await workspaceCountForTenant();
    const domain = `t45-double-fail-${runId}.example.com`;
    const row = okRow(2, { company_domain: domain, company_name: `T45 double-fail — ${runId}` });
    const failingClient = wrapClientFailingPlanInsertAndWorkspaceDelete(sellerClient);

    // No throw escapes importDeals(): if rollbackWorkspace's try/catch didn't
    // swallow the delete's rejection, this whole await would reject instead
    // of resolving with a per-row failure result.
    const [result] = await importDeals([row], context, failingClient);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rowNumber).toBe(2);
    // The ORIGINAL plan-insert failure, not a cleanup/delete error — same
    // generic message the single-failure rollback test above asserts, since
    // both failures map through the same unrecognised-code fallback.
    expect(result.errors).toEqual(["This row could not be saved. Please check the values and try again."]);
    expect(result.errors[0]).not.toMatch(/delete|cleanup/i);

    // The workspace itself is NOT rolled back this time — the compensating
    // delete failed too — so it is a genuine, known orphan. Documented, not
    // silently hidden: afterAll's tenant-scoped teardown still reaps it.
    expect(await workspaceCountForTenant()).toBe(before + 1);
    const orphan = await workspaceByDomain(domain);
    expect(orphan).not.toBeNull();
  });
});

describe("importDeals — already-failed validation rows pass through unchanged", () => {
  it("never attempts a DB write for a row validateImportRows already rejected", async () => {
    const before = await workspaceCountForTenant();
    const failedRow: RowValidationResult = { rowNumber: 7, ok: false, errors: ["plan_title: is required."] };

    const [result] = await importDeals([failedRow], context, sellerClient);

    expect(result).toBe(failedRow);
    expect(await workspaceCountForTenant()).toBe(before);
  });
});
