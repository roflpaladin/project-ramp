// Ticket 45 (Sprint 9) — the explicit partial-failure report the AC
// demands: a CSV import must never silently drop failed rows in favour of
// a bare count. Pure aggregation over lib/import/validate-rows.ts's
// per-row results — no I/O, never mutates its input.

import type { RowValidationResult } from "./validate-rows";

export interface ImportFailure {
  readonly rowNumber: number;
  readonly errors: readonly string[];
}

export interface ImportSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: readonly ImportFailure[];
}

export function summarizeImport(results: readonly RowValidationResult[]): ImportSummary {
  const failures = results
    .filter((result): result is Extract<RowValidationResult, { ok: false }> => !result.ok)
    .map((result) => ({ rowNumber: result.rowNumber, errors: result.errors }));

  return {
    total: results.length,
    succeeded: results.length - failures.length,
    failed: failures.length,
    failures,
  };
}
