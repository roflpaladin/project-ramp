// Sprint 10, Ticket 53 code review (HIGH, security) — named cap for the
// HubSpot deal-import batch size. Mirrors lib/import/csv-limits.ts's own
// MAX_CSV_ROWS convention: a single named constant every call site imports,
// no magic numbers. Before this cap existed, importHubSpotDeals() had no
// server-side bound on externalIds.length at all — the picker UI only ever
// submits a checkbox-sized selection, but a caller invoking the server
// action directly (bypassing the UI) could submit an arbitrarily large
// array and force this pipeline to sequentially re-fetch + write that many
// deals in one call.

/**
 * Hard cap on the number of externalIds a single importHubSpotDeals() (or
 * submitHubSpotImport()) call accepts. Matches CSV import's own
 * MAX_CSV_ROWS (lib/import/csv-limits.ts) so both deal-import paths share
 * the same per-call write-amplification ceiling.
 */
export const MAX_HUBSPOT_IMPORT_DEALS = 200;
