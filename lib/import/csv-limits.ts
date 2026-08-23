// Ticket 45 (Sprint 9) — named caps and the deal-import column schema for
// CSV upload. No magic numbers at any call site in lib/import/: every
// module imports these instead of repeating a literal.

/**
 * Hard cap on the raw uploaded file, in bytes. Deliberately well under
 * Next's default 1MB server-action request body limit — a file at the cap
 * still leaves headroom for the rest of the form-data envelope around it,
 * so a legitimate upload at the CSV cap never trips the framework's own
 * limit first with a confusing, unrelated error.
 */
export const MAX_CSV_BYTES = 512 * 1024;

/** Excludes the header row — 200 *data* rows is the cap. */
export const MAX_CSV_ROWS = 200;

/**
 * The exact, closed column set the deal-import schema accepts — one row
 * imports one deal (company + a starting plan). Order here is cosmetic
 * (header matching is order-independent); it only sets the order error
 * messages list missing columns in.
 */
export const REQUIRED_COLUMNS = [
  "company_name",
  "company_domain",
  "contact_email",
  "plan_title",
  "target_date",
] as const;

export type CsvColumnKey = (typeof REQUIRED_COLUMNS)[number];
