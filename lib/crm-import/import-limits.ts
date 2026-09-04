// Sprint 10, Ticket 53 code review (HIGH, security) — named cap for the CRM
// deal-import batch size. Mirrors lib/import/csv-limits.ts's own
// MAX_CSV_ROWS convention: a single named constant every call site imports,
// no magic numbers. Before this cap existed, importHubSpotDeals() had no
// server-side bound on externalIds.length at all — the picker UI only ever
// submits a checkbox-sized selection, but a caller invoking the server
// action directly (bypassing the UI) could submit an arbitrarily large
// array and force this pipeline to sequentially re-fetch + write that many
// deals in one call.
//
// Renamed from MAX_HUBSPOT_IMPORT_DEALS (Sprint 11, Ticket 56) — the same
// same-budget-different-key rename lib/rate-limit.ts's own
// CRM_IMPORT_RATE_LIMIT went through: salesforce-import-actions.ts shares
// this exact cap and write-amplification threat model with HubSpot's own
// import path, so one provider-agnostic name serves both rather than two
// identical constants.

/**
 * Hard cap on the number of externalIds a single importHubSpotDeals() /
 * importSalesforceDeals() (or their submit*Import() wrappers) call accepts.
 * Matches CSV import's own MAX_CSV_ROWS (lib/import/csv-limits.ts) so every
 * deal-import path shares the same per-call write-amplification ceiling.
 */
export const MAX_CRM_IMPORT_DEALS = 200;
