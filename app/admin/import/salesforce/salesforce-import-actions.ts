"use server";

// Sprint 11, Ticket 56 — Salesforce Opportunity import server actions. Full
// parity with app/admin/import/hubspot/hubspot-import-actions.ts: wires
// lib/crm-import/connection-state.ts -> salesforce-adapter.ts ->
// map-deal-to-workspace.ts -> write-crm-import.ts -> summarize-crm-import.ts
// behind the same two calls: listSalesforceDeals() (the picker) and
// importSalesforceDeals(externalIds) (the actual write).
//
// Named salesforce-import-actions.ts (not actions.ts) so
// tests/security/server-action-auth.spec.ts's listActionFiles probe (only
// walks files whose basename ends in "-actions.ts") covers it automatically
// — same reasoning as hubspot-import-actions.ts's own header.
//
// Order of operations mirrors hubspot-import-actions.ts's own: requireSeller()
// first, then the Salesforce-specific connection check, then checkRateLimit
// (after the cheap checks, before any real work), then the actual pipeline.
//
// NEVER TRUST CLIENT-SENT FIELDS BEYOND THE ID: importSalesforceDeals only
// ever receives externalId strings from its caller — every other field
// (name, amount, stage, company, contact) is re-fetched from Salesforce via
// adapter.getDealDetail() for each id, never taken from whatever the picker
// list call returned earlier. A stale or tampered picker payload can at
// worst name the wrong deal id; it can never inject a fabricated
// company/domain/amount into a write.

import { getSalesforceConnectionState } from "@/lib/crm-import/connection-state";
import { mapDealToWorkspace } from "@/lib/crm-import/map-deal-to-workspace";
import { createSalesforceAdapter } from "@/lib/crm-import/salesforce-adapter";
import { getUnmappedFields } from "@/lib/crm-import/salesforce-field-map";
import { MAX_CRM_IMPORT_DEALS } from "@/lib/crm-import/import-limits";
import { summarizeCrmImport } from "@/lib/crm-import/summarize-crm-import";
import type {
  CrmDealListResult,
  CrmImportFailureReason,
  CrmImportResult,
  CrmProviderAdapter,
  CrmUnmappedField,
} from "@/lib/crm-import/types";
import {
  ALREADY_IMPORTED_MESSAGE,
  getAlreadyImportedExternalIds,
  writeCrmImport,
  type CrmDealPreWriteResult,
  type CrmDealWriteResult,
} from "@/lib/crm-import/write-crm-import";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_IMPORT_RATE_LIMIT } from "@/lib/rate-limit";
import {
  MISSING_TENANT_MESSAGE,
  NO_DEALS_SELECTED_MESSAGE,
  NOT_CONNECTED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  TOO_MANY_DEALS_SELECTED_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  type SalesforceImportActionState,
} from "./salesforce-import-state";

// Module-level: the adapter is stateless (every call re-derives its own
// Salesforce client from the tenant id it's given), so one instance is
// shared across every request this server process handles — same reasoning
// as hubspot-import-actions.ts's own module-level adapter.
const adapter = createSalesforceAdapter();
const CRM_SOURCE = "salesforce";

/** Every action-level guard failure below encodes into CrmImportResult the same way — mirrors hubspot-import-actions.ts's own guardFailureResult. */
function guardFailureResult(
  externalIds: readonly string[],
  reason: CrmImportFailureReason,
  message: string,
  unmappedFields: readonly CrmUnmappedField[],
): CrmImportResult {
  const results: readonly CrmDealWriteResult[] = externalIds.map((externalId) => ({
    externalId,
    ok: false,
    reason,
    message,
  }));
  return summarizeCrmImport(results, unmappedFields);
}

/**
 * Re-fetches canonical detail for every selected id and runs it through the
 * pure mapping core — see this file's own header on never trusting
 * client-sent fields beyond the id itself. Sequential, not Promise.all, same
 * reasoning as hubspot-import-actions.ts's own fetchAndMapDeals.
 */
async function fetchAndMapDeals(
  externalIds: readonly string[],
  tenantId: string,
  adapter: CrmProviderAdapter,
): Promise<readonly CrmDealPreWriteResult[]> {
  let results: readonly CrmDealPreWriteResult[] = [];

  for (const externalId of externalIds) {
    const detailResult = await adapter.getDealDetail(tenantId, externalId);
    const nextResult: CrmDealPreWriteResult = detailResult.ok
      ? mapDealToWorkspace(detailResult.detail)
      : { externalId, ok: false, reason: detailResult.reason, message: detailResult.message };
    results = [...results, nextResult];
  }

  return results;
}

/** Dedupe backstop before writing — see write-crm-import.ts's own header for the 23505 backstop this pre-check pairs with; mirrors hubspot-import-actions.ts's own dedupeAlreadyImported. */
function dedupeAlreadyImported(
  results: readonly CrmDealPreWriteResult[],
  alreadyImported: ReadonlySet<string>,
): readonly CrmDealPreWriteResult[] {
  return results.map((result) =>
    result.ok && alreadyImported.has(result.externalId)
      ? { externalId: result.externalId, ok: false, reason: "invalid_data" as const, message: ALREADY_IMPORTED_MESSAGE }
      : result,
  );
}

export async function listSalesforceDeals(): Promise<CrmDealListResult> {
  const seller = await requireSeller();
  if (!seller) return { ok: false, reason: "unknown", message: UNAUTHENTICATED_MESSAGE, reconnectRequired: false };
  if (!seller.tenantId) {
    return { ok: false, reason: "unknown", message: MISSING_TENANT_MESSAGE, reconnectRequired: false };
  }

  const connection = await getSalesforceConnectionState(seller.tenantId);
  if (!connection.isConnected) {
    return { ok: false, reason: "token_expired", message: NOT_CONNECTED_MESSAGE, reconnectRequired: true };
  }

  const limit = checkRateLimit(
    `salesforce-import-list:${seller.userId}`,
    CRM_IMPORT_RATE_LIMIT.limit,
    CRM_IMPORT_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", message: RATE_LIMITED_MESSAGE, reconnectRequired: false };
  }

  const listResult = await adapter.listDeals(seller.tenantId);
  if (!listResult.ok) {
    return {
      ok: false,
      reason: listResult.reason,
      message: listResult.message,
      reconnectRequired: listResult.reason === "token_expired",
    };
  }

  // SETTLED decision (mirrors hubspot-import-actions.ts's own): already-
  // imported deals are filtered from the picker server-side, by querying
  // workspaces on (tenant_id, crm_source, crm_object_id) — never trusting
  // the caller to have not re-requested one.
  const alreadyImportedResult = await getAlreadyImportedExternalIds(seller.tenantId, CRM_SOURCE, seller.client);
  if (!alreadyImportedResult.ok) {
    return { ok: false, reason: "unknown", message: alreadyImportedResult.message, reconnectRequired: false };
  }
  const deals = listResult.deals.filter((deal) => !alreadyImportedResult.ids.has(deal.externalId));

  return { ok: true, deals, alreadyImportedCount: listResult.deals.length - deals.length };
}

export async function importSalesforceDeals(externalIds: readonly string[]): Promise<CrmImportResult> {
  const unmappedFields = getUnmappedFields();

  const seller = await requireSeller();
  if (!seller) return guardFailureResult(externalIds, "unknown", UNAUTHENTICATED_MESSAGE, unmappedFields);
  if (!seller.tenantId) return guardFailureResult(externalIds, "unknown", MISSING_TENANT_MESSAGE, unmappedFields);

  const connection = await getSalesforceConnectionState(seller.tenantId);
  if (!connection.isConnected) {
    // SETTLED shape: a disconnected tenant short-circuits before the loop —
    // one token_expired failure per requested externalId.
    return guardFailureResult(externalIds, "token_expired", NOT_CONNECTED_MESSAGE, unmappedFields);
  }

  const limit = checkRateLimit(
    `salesforce-import:${seller.userId}`,
    CRM_IMPORT_RATE_LIMIT.limit,
    CRM_IMPORT_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return guardFailureResult(externalIds, "rate_limited", RATE_LIMITED_MESSAGE, unmappedFields);
  }

  // Hard server-side cap on batch size, same placement and reasoning as
  // hubspot-import-actions.ts's own MAX_CRM_IMPORT_DEALS guard.
  if (externalIds.length > MAX_CRM_IMPORT_DEALS) {
    return guardFailureResult(externalIds, "invalid_data", TOO_MANY_DEALS_SELECTED_MESSAGE, unmappedFields);
  }

  if (externalIds.length === 0) {
    return summarizeCrmImport([], unmappedFields);
  }

  const preWriteResults = await fetchAndMapDeals(externalIds, seller.tenantId, adapter);

  // Primary already-imported defence — write-crm-import.ts's 23505 handling
  // is this pre-check's backstop for the race between this read and the
  // insert below (SETTLED decision, mirrors hubspot-import-actions.ts's own).
  const alreadyImportedResult = await getAlreadyImportedExternalIds(seller.tenantId, CRM_SOURCE, seller.client);
  if (!alreadyImportedResult.ok) {
    return guardFailureResult(externalIds, "unknown", alreadyImportedResult.message, unmappedFields);
  }
  const dedupedResults = dedupeAlreadyImported(preWriteResults, alreadyImportedResult.ids);

  const writeResults = await writeCrmImport(
    dedupedResults,
    { tenantId: seller.tenantId, userId: seller.userId, crmSource: CRM_SOURCE },
    seller.client,
  );

  return summarizeCrmImport(writeResults, unmappedFields);
}

/**
 * useActionState-shaped wrapper around importSalesforceDeals() for a later
 * UI phase — extracts the picker's checked externalId values from the
 * submitted form. requireSeller() is called here too (not just inside
 * importSalesforceDeals()) so this exported function independently satisfies
 * the server-action auth coverage probe without relying on a callee it
 * delegates to — mirrors hubspot-import-actions.ts's own
 * submitHubSpotImport() reasoning verbatim.
 */
export async function submitSalesforceImport(
  _previousState: SalesforceImportActionState,
  formData: FormData,
): Promise<SalesforceImportActionState> {
  const seller = await requireSeller();
  if (!seller) return { error: UNAUTHENTICATED_MESSAGE, result: null };

  const externalIds = formData.getAll("externalId").map(String);
  if (externalIds.length === 0) {
    return { error: NO_DEALS_SELECTED_MESSAGE, result: null };
  }
  // Same batch-size cap importSalesforceDeals() enforces, checked here too
  // so a caller sees the clear cap-naming error before the pipeline
  // delegates any work — mirrors this action's own no-deals-selected guard.
  if (externalIds.length > MAX_CRM_IMPORT_DEALS) {
    return { error: TOO_MANY_DEALS_SELECTED_MESSAGE, result: null };
  }

  const result = await importSalesforceDeals(externalIds);
  return { error: null, result };
}
