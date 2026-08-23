// Ticket 45 (Sprint 9) — CSV import error vocabulary, structured the same
// way lib/plans/errors.ts structures PlanErrorCode: one exported closed
// union that every module in lib/import/ works off, so a caller's switch
// over it can be exhaustive and no module ever hands a caller raw
// papaparse/Node internal error text — every message below is app-authored.

/**
 * The full closed set of codes a CSV structural parse can fail with
 * (lib/import/parse-csv.ts). Per-row *content* failures (lib/import/
 * validate-rows.ts) are a separate, per-field string vocabulary, not this
 * union — a bad company_name shouldn't fail the whole file the way a
 * missing column does.
 */
export type CsvImportErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "INVALID_ENCODING"
  | "MISSING_COLUMNS"
  | "UNKNOWN_COLUMNS"
  | "DUPLICATE_COLUMNS"
  | "MALFORMED_CSV";

export interface CsvImportError {
  readonly ok: false;
  readonly error: CsvImportErrorCode;
  readonly message: string;
}

export function csvImportError(error: CsvImportErrorCode, message: string): CsvImportError {
  return { ok: false, error, message };
}
