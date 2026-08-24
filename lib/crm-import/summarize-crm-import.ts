// Sprint 10, Ticket 53 — the explicit partial-failure report the ticket's
// binding CrmImportResult shape demands, mirroring
// lib/import/summarize-import.ts's "never silently drop failed deals in
// favour of a bare count" reasoning. Pure aggregation over
// lib/crm-import/write-crm-import.ts's per-deal results — no I/O, never
// mutates its input.

import type { CrmImportFailure, CrmImportResult, CrmUnmappedField } from "./types";
import type { CrmDealWriteResult } from "./write-crm-import";

function deriveStatus(importedCount: number, totalCount: number): CrmImportResult["status"] {
  // totalCount === 0 -> "complete": nothing was requested, so vacuously
  // nothing failed either (see hubspot-import-actions.ts's empty-selection
  // case).
  if (totalCount === 0 || importedCount === totalCount) return "complete";
  if (importedCount === 0) return "failed";
  return "partial";
}

export function summarizeCrmImport(
  results: readonly CrmDealWriteResult[],
  unmappedFields: readonly CrmUnmappedField[],
): CrmImportResult {
  const failures: readonly CrmImportFailure[] = results
    .filter((result): result is Extract<CrmDealWriteResult, { ok: false }> => !result.ok)
    .map((result) => ({ externalId: result.externalId, reason: result.reason, message: result.message }));

  const importedCount = results.length - failures.length;

  return {
    status: deriveStatus(importedCount, results.length),
    importedCount,
    failedCount: failures.length,
    totalCount: results.length,
    failures,
    unmappedFields,
    // SETTLED derivation: a retry might succeed on its own for these two
    // reasons without the seller doing anything else first.
    retryable: failures.some((failure) => failure.reason === "rate_limited" || failure.reason === "unknown"),
    // SETTLED derivation: the seller must reconnect HubSpot before any retry
    // can succeed.
    reconnectRequired: failures.some((failure) => failure.reason === "token_expired"),
  };
}
