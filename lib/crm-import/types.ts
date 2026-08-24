// Sprint 10, Ticket 53 — HubSpot deal import & mapping. Binding shapes agreed
// with the peer UI session (Ticket 54 builds against these exact names/
// shapes — do not rename without re-coordinating). Pull-based, one-shot
// import: a seller picks deals from a HubSpot list, this pipeline re-fetches
// each one's canonical detail server-side and writes one workspace +
// starter success_plan per deal (T45's CSV-import pairing, reused here).
//
// No ongoing sync — every field below describes a single import call's
// input/output, never a persisted subscription.

/** One deal as shown in the picker list — human-facing summary only, never trusted for the actual write (the write path always re-fetches canonical detail server-side; see hubspot-adapter.ts's getDealDetail). */
export interface CrmDealSummary {
  readonly externalId: string;
  readonly name: string;
  readonly amount: number | null;
  /** Human-readable pipeline stage label (resolved via one cached pipeline-metadata fetch per list call) — NOT the raw id persisted to workspaces.crm_stage. See hubspot-adapter.ts's header for this divergence. */
  readonly stage: string;
  readonly companyName: string | null;
}

/** One row of the field-mapping table shown to the seller before import (hubspot-field-map.ts's static HubSpot-standard-property table). */
export interface CrmFieldMapping {
  readonly sourceField: string;
  readonly sourceLabel: string;
  /** null when this HubSpot field has no target in Brava's v1 mapping — surfaced as an unmapped field, never silently dropped. */
  readonly targetField: string | null;
  readonly sampleValue: string | null;
}

/**
 * The full closed set of reasons a single deal can fail to import.
 * "invalid_data" is never produced by an adapter LIST call (see
 * CrmListFailureReason below) — it is either a structural problem with one
 * specific object (a malformed detail-fetch response) or a content problem
 * lib/crm-import/map-deal-to-workspace.ts's pure validation catches, or a
 * write-time (tenant_id, crm_source, crm_object_id) conflict
 * (lib/crm-import/write-crm-import.ts's 23505 backstop).
 */
export type CrmImportFailureReason = "rate_limited" | "token_expired" | "invalid_data" | "unknown";

export interface CrmImportFailure {
  readonly externalId: string;
  readonly reason: CrmImportFailureReason;
  readonly message: string;
}

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
  /** true when some failure is rate_limited or unknown — a retry might succeed without the seller doing anything else first. */
  readonly retryable: boolean;
  /** true when some failure is token_expired — the seller must reconnect HubSpot before retrying. */
  readonly reconnectRequired: boolean;
}

export interface CrmConnectionState {
  readonly provider: "hubspot";
  readonly isConnected: boolean;
}

/**
 * Reasons a whole-list adapter call can fail with — a strict subset of
 * CrmImportFailureReason. No "invalid_data": a list call either returns a
 * page of deals or it doesn't; there is no single deal's content to reject
 * yet (that only exists once a deal's own detail has been fetched).
 */
export type CrmListFailureReason = "rate_limited" | "token_expired" | "unknown";

export type CrmDealListResult =
  | { readonly ok: true; readonly deals: readonly CrmDealSummary[]; readonly alreadyImportedCount: number }
  | {
      readonly ok: false;
      readonly reason: CrmListFailureReason;
      readonly message: string;
      readonly reconnectRequired: boolean;
    };

/**
 * One provider's list call, BEFORE the already-imported filter is applied.
 * The adapter has no knowledge of Brava's own `workspaces` table, so it
 * cannot compute `alreadyImportedCount` itself — hubspot-import-actions.ts's
 * listHubSpotDeals() queries workspaces on (tenant_id, crm_source,
 * crm_object_id) (SETTLED decision) and turns this into the final,
 * UI-facing CrmDealListResult above.
 */
export type CrmAdapterListDealsResult =
  | { readonly ok: true; readonly deals: readonly CrmDealSummary[] }
  | { readonly ok: false; readonly reason: CrmListFailureReason; readonly message: string };

/**
 * One deal's full, re-fetched detail — the only shape the write path ever
 * trusts. `stage` is HubSpot's raw internal stage id, deliberately NOT the
 * human label CrmDealSummary.stage carries (persisted as-is to
 * workspaces.crm_stage — see hubspot-adapter.ts's header for the
 * picker-label-vs-persisted-id divergence). Every field is the raw
 * HubSpot property value (or an already-resolved company/contact field);
 * format/content validation happens one layer up, in
 * lib/crm-import/map-deal-to-workspace.ts.
 */
export interface CrmDealDetail {
  readonly externalId: string;
  readonly dealName: string | null;
  readonly amount: string | null;
  readonly stage: string | null;
  readonly closeDate: string | null;
  readonly companyName: string | null;
  readonly companyDomain: string | null;
  readonly contactEmail: string | null;
}

export type CrmDealDetailResult =
  | { readonly ok: true; readonly detail: CrmDealDetail }
  | { readonly ok: false; readonly reason: CrmImportFailureReason; readonly message: string };

/**
 * One CRM provider's read surface for the pull-based, one-shot deal import.
 * hubspot-adapter.ts is the only implementation today; a future provider
 * (e.g. Salesforce) implements this same interface rather than forking a
 * parallel import pipeline.
 */
export interface CrmProviderAdapter {
  readonly provider: "hubspot";
  listDeals(tenantId: string): Promise<CrmAdapterListDealsResult>;
  getDealDetail(tenantId: string, externalId: string): Promise<CrmDealDetailResult>;
}
