// Ticket 45 (Sprint 9), Phase 2a — the DB writer for the deal-import CSV.
// Takes lib/import/validate-rows.ts's per-row results and, for every row that
// passed content validation, writes ONE workspace + ONE success_plan under the
// signed-in seller's own tenant. Rows that already failed validation pass
// straight through unchanged — this module never re-validates content, only
// turns an already-valid row into a database write (or a new per-row
// failure if that write is refused).
//
// RLS-scoped seller client, not the service-role client (contrast
// lib/seed/sample-deal.ts's seedSampleDeal, which runs pre-session during
// onboarding): a CSV import is an authenticated seller acting on their own
// tenant, the same shape of call as onboarding-actions.ts's
// createFirstWorkspace (direct `seller.client.from("workspaces").insert(...)`)
// and lib/plans/write.ts's createPlan (RLS-scoped, injectable client). This
// file follows both of those precedents rather than inventing a third style:
// the workspace insert mirrors createFirstWorkspace exactly; the plan insert
// calls write.ts's createPlan() directly instead of hand-rolling a second
// `.from("success_plans").insert(...)` call.
//
// One row's failure NEVER aborts another row (AC): every row is processed
// independently and always produces a RowValidationResult for itself, never
// a thrown error. On a mid-row failure (workspace ok, plan insert refused)
// the row's own workspace is compensatingly deleted before recording the
// failure — reverse creation order, same "best-effort, independently
// try/caught" shape as seedSampleDeal's rollback(), just one step deep here
// because a single failed row never gets further than "workspace exists,
// plan does not".
//
// DOMAIN REQUIREMENT: company_domain is a required field of
// lib/import/validate-rows.ts's schema (code review, Phase 2a — moved up
// from a DB-writer-only check) precisely BECAUSE workspaces.target_domain is
// NOT NULL (0001_init_schema.sql): a row with no domain never reaches this
// module at all — it arrives as an already-failed RowValidationResult and is
// passed through unchanged by importDeals below, same as any other
// content-invalid row. Nothing in this file re-checks it; ValidatedImportRow
// itself now types company_domain as a required `string`, not `string | null`.
//
// DUPLICATE-LIVE-PLAN INDEX (0005's idx_success_plans_one_live_per_workspace):
// each row creates its own brand-new workspace before creating its plan, so
// two rows in the same import can never collide on this index — it is scoped
// per workspace_id, and no two rows ever share one. The mapping below still
// carries a PLAN_ALREADY_LIVE branch (a) as defence in depth against a future
// change that reuses a workspace, and (b) because leaving an unmapped 23505
// fall through to the generic UNKNOWN_ERROR message would be a worse failure
// mode than naming it, at negligible cost.
//
// WORKSPACES HAS NO DUPLICATE COMPANY/DOMAIN CONSTRAINT today
// (0001_init_schema.sql defines no unique index on target_domain or
// target_company_name) — so a "duplicate domain" row failure is not
// currently reachable via a DB constraint. Documented rather than guessed
// around: if the Notion Technical Source of Truth adds one later, the
// generic UNKNOWN_ERROR branch below already covers an unrecognised 23505
// without leaking raw Postgres text, and a named branch can be added the
// same way PLAN_ALREADY_LIVE was.

import "server-only";

import { normalizeDomain } from "@/lib/domain";
import { mapPostgrestError, type PlanErrorCode } from "@/lib/plans/errors";
import { createPlan, type PlanWriteClient } from "@/lib/plans/write";
import type { RowValidationResult, ValidatedImportRow } from "./validate-rows";

const GENERIC_ROW_FAILURE_MESSAGE = "This row could not be saved. Please check the values and try again.";

export interface ImportDealsContext {
  readonly tenantId: string;
  readonly userId: string;
}

function messageForPlanErrorCode(code: PlanErrorCode): string {
  switch (code) {
    case "PLAN_ALREADY_LIVE":
      return "A live plan already exists for this workspace; this row was skipped.";
    case "INVALID_DATE_RANGE":
      return "target_date: must not be before the plan's start date.";
    default:
      return GENERIC_ROW_FAILURE_MESSAGE;
  }
}

/** Best-effort compensating delete — mirrors seedSampleDeal's rollback() shape, one step deep. */
async function rollbackWorkspace(client: PlanWriteClient, workspaceId: string): Promise<void> {
  try {
    await client.from("workspaces").delete().eq("id", workspaceId);
  } catch {
    // Best-effort only — the original failure this row already recorded is
    // the one that reaches the caller, never a cleanup error.
  }
}

async function createWorkspaceForRow(
  client: PlanWriteClient,
  context: ImportDealsContext,
  row: ValidatedImportRow,
  domain: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; message: string }> {
  const { data, error } = await client
    .from("workspaces")
    .insert({
      tenant_id: context.tenantId,
      target_company_name: row.company_name,
      target_domain: domain,
      created_by: context.userId,
      approved_emails: row.contact_email ? [row.contact_email] : [],
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error ? messageForPlanErrorCode(mapPostgrestError(error).code) : GENERIC_ROW_FAILURE_MESSAGE;
    return { ok: false, message };
  }
  return { ok: true, workspaceId: data.id as string };
}

async function importRow(
  row: ValidatedImportRow,
  rowNumber: number,
  context: ImportDealsContext,
  client: PlanWriteClient,
): Promise<RowValidationResult> {
  const workspaceResult = await createWorkspaceForRow(client, context, row, normalizeDomain(row.company_domain));
  if (!workspaceResult.ok) {
    return { rowNumber, ok: false, errors: [workspaceResult.message] };
  }

  const planResult = await createPlan(
    { workspace_id: workspaceResult.workspaceId, title: row.plan_title, target_date: row.target_date },
    client,
  );

  if (!planResult.ok) {
    await rollbackWorkspace(client, workspaceResult.workspaceId);
    return { rowNumber, ok: false, errors: [messageForPlanErrorCode(planResult.code)] };
  }

  return { rowNumber, ok: true, value: row };
}

/**
 * Writes one workspace + success_plan per validated row, under the given
 * tenant/user. Rows that already failed lib/import/validate-rows.ts's
 * content check pass through unchanged. Returns the same
 * `RowValidationResult[]` shape validateImportRows produces, so the result is
 * ready for lib/import/summarize-import.ts's summarizeImport() as-is — no
 * transformation step, no new summary type.
 *
 * Sequential, not Promise.all: up to MAX_CSV_ROWS (200) rows per import is
 * small enough that a bounded, easy-to-reason-about loop is preferable to a
 * 200-way concurrent burst against Supabase's connection pool for a
 * best-serve, non-latency-critical background action.
 */
export async function importDeals(
  validationResults: readonly RowValidationResult[],
  context: ImportDealsContext,
  client: PlanWriteClient,
): Promise<readonly RowValidationResult[]> {
  let results: readonly RowValidationResult[] = [];

  for (const result of validationResults) {
    const rowResult = result.ok ? await importRow(result.value, result.rowNumber, context, client) : result;
    results = [...results, rowResult];
  }

  return results;
}
