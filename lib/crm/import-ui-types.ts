// Sprint 10, Ticket 54, Phase 1/2 — CRM import UI display types.
//
// INTERIM COPY (reconciliation rule agreed cross-session 2026-08-24): after
// T53 merges, the canonical contract home is lib/crm-import/types.ts (owned
// by the T53 build, same shapes). T54's wiring follow-up swaps every import
// over to that module and DELETES this file — do not extend this file after
// T53 is on main.
//
// CONFIRMED 2026-08-24 — the T53 owner has locked this contract: field names
// are final. Phase 1/2 UI below is still built entirely against mocks of
// these types — T53's backend server actions do not exist yet — but the
// shapes themselves are no longer expected to shift. When T53 lands, wire
// its actual response through these types rather than redefining them.
//
// The closed error-reason set (CrmImportFailureReason) is exhaustively
// switched on by components/crm/import-result-summary.tsx's copy map — if
// T53 adds a reason not listed here, that switch must be extended too, not
// worked around with a fallback string.

/**
 * One deal as summarized from the source CRM, prior to import. Deals already
 * imported into Brava are filtered out server-side before reaching the UI —
 * the picker never needs to de-duplicate or grey them out itself.
 */
export interface CrmDealSummary {
  readonly externalId: string;
  readonly name: string;
  readonly amount: number | null;
  /** Human-readable stage label; the backend persists HubSpot's raw stage id
   * separately, so this field is display-only and never round-tripped. */
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

/**
 * Backend derivation rule (confirmed 2026-08-24, from the T53 owner) — the
 * UI trusts these booleans exactly as given and never re-derives them from
 * `failures`:
 *   - `retryable` is true when at least one failure's reason is
 *     `"rate_limited"` or `"unknown"` (transient conditions worth another
 *     attempt).
 *   - `reconnectRequired` is true when at least one failure's reason is
 *     `"token_expired"`.
 *   - A tenant whose HubSpot connection was never established, or has since
 *     been disconnected, short-circuits: `status` is `"failed"`, `failures`
 *     contains exactly one `"token_expired"` entry per requested deal,
 *     `reconnectRequired` is true, and the counts stay internally consistent
 *     (`importedCount` 0, `failedCount === totalCount`).
 */
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

/**
 * The deal picker's list-call result (non-binding addition, confirmed
 * workable 2026-08-24 by the T53 owner — the picker built against this
 * shape in Phase 2, ahead of T53's actual server action existing).
 *
 * `alreadyImportedCount` amended 2026-08-24 (binding): count of deals the
 * server filtered out because they are already imported, so the picker can
 * tell "nothing in HubSpot" apart from "everything is already in".
 */
export type CrmDealListResult =
  | { readonly ok: true; readonly deals: readonly CrmDealSummary[]; readonly alreadyImportedCount: number }
  | {
      readonly ok: false;
      readonly reason: "rate_limited" | "token_expired" | "unknown";
      readonly message: string;
      readonly reconnectRequired: boolean;
    };
