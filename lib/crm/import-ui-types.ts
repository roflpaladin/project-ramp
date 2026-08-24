// Sprint 10, Ticket 54, Phase 1 — CRM import UI display types.
//
// PROVISIONAL — pending T53 (backend CRM import pipeline, built by another
// session in parallel). These shapes were handed down by the T53 owner as a
// contract: field NAMES may still shift before T53 lands, but the STRUCTURE
// (which fields exist, which are nullable, which unions are closed) will
// not. Phase 1 UI below is built entirely against mocks of these types —
// no real API calls. When T53 lands, reconcile this file against its actual
// response shape rather than assuming it is untouched.
//
// The closed error-reason set (CrmImportFailureReason) is exhaustively
// switched on by components/crm/import-result-summary.tsx's copy map — if
// T53 adds a reason not listed here, that switch must be extended too, not
// worked around with a fallback string.

/** One deal as summarized from the source CRM, prior to import. */
export interface CrmDealSummary {
  readonly externalId: string;
  readonly name: string;
  readonly amount: number | null;
  readonly stage: string;
  readonly companyName: string | null;
}

/** One source-CRM field mapped (or not) to a Brava deal field. */
export interface CrmFieldMapping {
  readonly sourceField: string;
  readonly sourceLabel: string;
  /** null = unmapped. MUST be surfaced to the seller, never dropped invisibly. */
  readonly targetField: string | null;
  readonly sampleValue: string | null;
}

/** The closed set of reasons a single deal can fail import. */
export type CrmImportFailureReason = "rate_limited" | "token_expired" | "invalid_data" | "unknown";

export interface CrmImportFailure {
  readonly externalId: string;
  readonly reason: CrmImportFailureReason;
  readonly message: string;
}

/** One source field that had nowhere to land in Brava. Contract AMENDED
 * 2026-08-24 (binding, per the T53 owner): was a bare source-key string;
 * now carries the human label so sellers see friendly names, with the raw
 * key kept for debugging/tooltips. */
export interface CrmUnmappedField {
  readonly sourceField: string;
  readonly sourceLabel: string;
}

export interface CrmImportResult {
  readonly status: "complete" | "partial" | "failed";
  readonly importedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
  readonly failures: readonly CrmImportFailure[];
  readonly unmappedFields: readonly CrmUnmappedField[];
  readonly retryable: boolean;
  readonly reconnectRequired: boolean;
}

export interface CrmConnectionState {
  readonly provider: "hubspot";
  readonly isConnected: boolean;
}
