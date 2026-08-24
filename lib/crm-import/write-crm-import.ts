// Sprint 10, Ticket 53 — the DB writer for the HubSpot deal import. Mirrors
// lib/import/import-deals.ts's shape deliberately (see that module's own
// header for the full rationale, repeated in short form here): RLS-scoped
// seller client, one workspace + one success_plan per deal, one deal's
// failure NEVER aborts another, best-effort compensating workspace delete on
// a mid-deal plan-insert failure.
//
// Takes CrmDealPreWriteResult[] — the union of (a) a deal that already
// failed upstream (an adapter fetch error, or lib/crm-import/
// map-deal-to-workspace.ts's content validation) and (b) a deal that passed
// content validation and is ready to write. Case (a) passes straight
// through unchanged, exactly like import-deals.ts's already-failed
// RowValidationResult rows — this module never re-validates content, only
// turns an already-validated deal into a database write (or a new per-deal
// failure if that write is refused).
//
// ALREADY-IMPORTED DEDUPE: hubspot-import-actions.ts's importHubSpotDeals()
// pre-filters already-imported deals via getAlreadyImportedExternalIds()
// below BEFORE calling writeCrmImport — that pre-check is the primary
// defence. The unique index idx_workspaces_tenant_crm (tenant_id,
// crm_source, crm_object_id) — added in 0004, reused as-is here, no new
// migration needed — is this function's own backstop for the TOCTOU race
// between that pre-check and this insert (SETTLED decision): a 23505 on
// that specific index maps to a named "already imported" failure, never an
// unrecognised UNKNOWN_ERROR-style message.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostgrestErrorLike } from "@/lib/plans/errors";
import { createPlan, type PlanWriteClient } from "@/lib/plans/write";
import type { MapDealResult, ValidatedCrmDeal } from "./map-deal-to-workspace";
import type { CrmImportFailureReason } from "./types";

const GENERIC_WRITE_FAILURE_MESSAGE = "This deal could not be imported. Please try again.";
/**
 * Code review (MEDIUM): exported so hubspot-import-actions.ts's
 * dedupeAlreadyImported() reuses this exact copy for its own pre-write
 * already-imported check, instead of a second, drift-prone literal with the
 * same wording.
 */
export const ALREADY_IMPORTED_MESSAGE = "This deal has already been imported.";
const ALREADY_IMPORTED_LOOKUP_FAILURE_MESSAGE = "Could not check which deals were already imported. Please try again.";
const ALREADY_IMPORTED_INDEX = "idx_workspaces_tenant_crm";
const CRM_SOURCE = "hubspot";

export interface WriteCrmImportContext {
  readonly tenantId: string;
  readonly userId: string;
}

/** A per-deal fetch failure from upstream (hubspot-adapter.ts's getDealDetail) — passed straight through by writeCrmImport, never re-attempted. */
export interface CrmDealFetchFailure {
  readonly externalId: string;
  readonly ok: false;
  readonly reason: CrmImportFailureReason;
  readonly message: string;
}

/** Everything writeCrmImport can receive for one deal: already-failed (fetch or content validation) or ready to write. */
export type CrmDealPreWriteResult = MapDealResult | CrmDealFetchFailure;

export type CrmDealWriteResult =
  | { readonly externalId: string; readonly ok: true }
  | { readonly externalId: string; readonly ok: false; readonly reason: CrmImportFailureReason; readonly message: string };

function isAlreadyImportedConflict(error: PostgrestErrorLike): boolean {
  if (error.code !== "23505") return false;
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return source.includes(ALREADY_IMPORTED_INDEX);
}

function messageForWorkspaceInsertError(error: PostgrestErrorLike): { reason: CrmImportFailureReason; message: string } {
  if (isAlreadyImportedConflict(error)) {
    return { reason: "invalid_data", message: ALREADY_IMPORTED_MESSAGE };
  }
  return { reason: "unknown", message: GENERIC_WRITE_FAILURE_MESSAGE };
}

/** Best-effort compensating delete — mirrors lib/import/import-deals.ts's rollbackWorkspace, one step deep. */
async function rollbackWorkspace(client: PlanWriteClient, workspaceId: string): Promise<void> {
  try {
    await client.from("workspaces").delete().eq("id", workspaceId);
  } catch {
    // Best-effort only — the original failure this deal already recorded is
    // the one that reaches the caller, never a cleanup error.
  }
}

async function createWorkspaceForDeal(
  client: PlanWriteClient,
  context: WriteCrmImportContext,
  deal: ValidatedCrmDeal,
): Promise<{ ok: true; workspaceId: string } | { ok: false; reason: CrmImportFailureReason; message: string }> {
  const { data, error } = await client
    .from("workspaces")
    .insert({
      tenant_id: context.tenantId,
      target_company_name: deal.companyName,
      target_domain: deal.companyDomain,
      created_by: context.userId,
      approved_emails: deal.contactEmail ? [deal.contactEmail] : [],
      crm_source: CRM_SOURCE,
      crm_object_id: deal.externalId,
      crm_stage: deal.stage,
      crm_amount: deal.amount,
      crm_close_date: deal.targetDate,
      crm_synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, ...(error ? messageForWorkspaceInsertError(error) : { reason: "unknown", message: GENERIC_WRITE_FAILURE_MESSAGE }) };
  }
  return { ok: true, workspaceId: data.id as string };
}

async function writeDeal(
  deal: ValidatedCrmDeal,
  context: WriteCrmImportContext,
  client: PlanWriteClient,
): Promise<CrmDealWriteResult> {
  const workspaceResult = await createWorkspaceForDeal(client, context, deal);
  if (!workspaceResult.ok) {
    return { externalId: deal.externalId, ok: false, reason: workspaceResult.reason, message: workspaceResult.message };
  }

  const planResult = await createPlan(
    { workspace_id: workspaceResult.workspaceId, title: deal.planTitle, target_date: deal.targetDate },
    client,
  );

  if (!planResult.ok) {
    // Divergence from T45's import-deals.ts (code review, LOW): that module
    // branches on PlanErrorCode to special-case PLAN_ALREADY_LIVE with its
    // own message. This deal's workspace was JUST created above (one plan
    // per new workspace, never an existing one), so createPlan can never
    // return PLAN_ALREADY_LIVE here — every planResult failure collapses to
    // the same generic "unknown" outcome rather than an unreachable branch.
    await rollbackWorkspace(client, workspaceResult.workspaceId);
    return { externalId: deal.externalId, ok: false, reason: "unknown", message: GENERIC_WRITE_FAILURE_MESSAGE };
  }

  return { externalId: deal.externalId, ok: true };
}

/**
 * Writes one workspace + success_plan per deal that passed content
 * validation. A deal that already failed upstream passes through unchanged.
 * Sequential, not Promise.all — same reasoning as lib/import/import-deals.ts
 * (a bounded, easy-to-reason-about loop over a picker-sized selection, not a
 * large concurrent burst against Supabase's connection pool).
 */
export async function writeCrmImport(
  results: readonly CrmDealPreWriteResult[],
  context: WriteCrmImportContext,
  client: PlanWriteClient,
): Promise<readonly CrmDealWriteResult[]> {
  let outcomes: readonly CrmDealWriteResult[] = [];

  for (const result of results) {
    const outcome: CrmDealWriteResult = result.ok
      ? await writeDeal(result.value, context, client)
      : { externalId: result.externalId, ok: false, reason: result.reason, message: result.message };
    outcomes = [...outcomes, outcome];
  }

  return outcomes;
}

/**
 * Code review (HIGH, code): getAlreadyImportedExternalIds used to throw on
 * any non-23505 query error, and both call sites in
 * hubspot-import-actions.ts awaited it unguarded — an uncaught throw there
 * would have crashed the whole server action instead of returning a typed
 * failure the UI can render. A typed result (matching this module's own
 * CrmDealWriteResult union shape) forces every caller to handle the failure
 * path explicitly instead.
 */
export type AlreadyImportedLookupResult =
  | { readonly ok: true; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly message: string };

/**
 * The (tenant_id, crm_source) external ids already imported as a workspace
 * — the primary already-imported defence (see this module's header); the
 * writer's own 23505 handling above is the backstop for the race this
 * pre-check cannot close by itself. Used both by hubspot-import-actions.ts's
 * listHubSpotDeals() (to filter the picker) and importHubSpotDeals() (to
 * dedupe before writing) — both callers fold an `ok: false` result into
 * their own typed error path (an "unknown" failure) rather than letting a
 * query error surface as an uncaught exception.
 */
export async function getAlreadyImportedExternalIds(
  tenantId: string,
  client: SupabaseClient,
): Promise<AlreadyImportedLookupResult> {
  const { data, error } = await client
    .from("workspaces")
    .select("crm_object_id")
    .eq("tenant_id", tenantId)
    .eq("crm_source", CRM_SOURCE);

  if (error) {
    // Logged with full context server-side, never surfaced to the caller —
    // same discipline as lib/pulse/resolve-step-labels.ts's own degrade.
    console.error("[crm-import] already-imported lookup failed:", { tenantId, message: error.message });
    return { ok: false, message: ALREADY_IMPORTED_LOOKUP_FAILURE_MESSAGE };
  }

  const ids = (data ?? [])
    .map((row) => row.crm_object_id as string | null)
    .filter((id): id is string => id !== null);
  return { ok: true, ids: new Set(ids) };
}
