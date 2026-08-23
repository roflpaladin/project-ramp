// Ticket 45 (Sprint 9) — pure CSV structural parsing for the deal-import
// flow. Papaparse handles RFC-4180 tokenizing (quoting, embedded commas/
// newlines, CRLF-vs-LF); everything else here — size/row caps, encoding,
// and the exact deal-import header schema — is app-specific and owned by
// this module. Never throws for malformed user input: every failure path
// returns a CsvImportError instead (lib/import/errors.ts), mirroring
// lib/plans/mutations.ts's PlanActionResult discriminated-union style.
//
// Deliberately does NOT validate cell *content* (formats, formula
// injection) — that is lib/import/validate-rows.ts's job, one layer up.
// This module only answers "is this a well-formed 5-column deal-import
// CSV", never "is row 7's email address valid".

import Papa from "papaparse";

import { MAX_CSV_BYTES, MAX_CSV_ROWS, REQUIRED_COLUMNS, type CsvColumnKey } from "./csv-limits";
import { csvImportError, type CsvImportError } from "./errors";

/** One parsed data row, keyed by the normalized column name. */
export type CsvRow = Readonly<Record<CsvColumnKey, string>>;

export type CsvParseResult = { readonly ok: true; readonly rows: readonly CsvRow[] } | CsvImportError;

const REPLACEMENT_CHAR = "�";
const REQUIRED_COLUMN_SET: ReadonlySet<string> = new Set(REQUIRED_COLUMNS);

const MALFORMED_ROW_MESSAGE = (fileRow: number): string =>
  `Row ${fileRow} could not be parsed: check for unmatched quotes or an unexpected number of columns.`;

/**
 * TextDecoder's utf-8 decoder strips a leading BOM by default (ignoreBOM:
 * false) and throws on any byte sequence that isn't valid UTF-8 when
 * fatal: true — both properties this function relies on rather than
 * hand-rolling BOM/encoding detection.
 */
function decodeUtf8Strict(input: Buffer): { readonly ok: true; readonly text: string } | { readonly ok: false } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    // Defence in depth: a literal U+FFFD in otherwise-valid UTF-8 input is
    // still a strong signal of upstream mangling (e.g. a caller that
    // already lossily re-decoded the file before handing it to us).
    if (text.includes(REPLACEMENT_CHAR)) return { ok: false };
    return { ok: true, text };
  } catch {
    return { ok: false };
  }
}

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase();
}

interface ValidHeader {
  readonly ok: true;
  readonly normalized: readonly string[];
}

/** Exact-match, case/whitespace-trimmed header validation against the closed REQUIRED_COLUMNS schema. */
function validateHeader(headerRow: readonly string[]): ValidHeader | CsvImportError {
  const normalized = headerRow.map(normalizeHeaderCell);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of normalized) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    return csvImportError("DUPLICATE_COLUMNS", `Duplicate column(s) in header: ${[...duplicates].join(", ")}.`);
  }

  const missing = REQUIRED_COLUMNS.filter((col) => !normalized.includes(col));
  if (missing.length > 0) {
    return csvImportError("MISSING_COLUMNS", `Missing required column(s): ${missing.join(", ")}.`);
  }

  const unknown = normalized.filter((name) => !REQUIRED_COLUMN_SET.has(name));
  if (unknown.length > 0) {
    return csvImportError("UNKNOWN_COLUMNS", `Unexpected column(s): ${unknown.join(", ")}.`);
  }

  return { ok: true, normalized };
}

/** Index of the first data row whose field count disagrees with the header — a ragged/malformed CSV, not a content problem. */
function findRaggedRowIndex(dataRows: readonly string[][], headerLength: number): number {
  return dataRows.findIndex((row) => row.length !== headerLength);
}

function buildRow(normalizedHeader: readonly string[], dataRow: readonly string[]): CsvRow {
  const entries = normalizedHeader.map((name, i) => [name, dataRow[i]] as const);
  return Object.fromEntries(entries) as CsvRow;
}

export function parseCsv(input: Buffer): CsvParseResult {
  if (input.byteLength === 0) return csvImportError("EMPTY_FILE", "The CSV file is empty.");
  if (input.byteLength > MAX_CSV_BYTES) {
    return csvImportError("FILE_TOO_LARGE", `The CSV file exceeds the ${MAX_CSV_BYTES} byte limit.`);
  }

  const decoded = decodeUtf8Strict(input);
  if (!decoded.ok) return csvImportError("INVALID_ENCODING", "The CSV file is not valid UTF-8 text.");
  if (decoded.text.trim() === "") return csvImportError("EMPTY_FILE", "The CSV file is empty.");

  // delimiter is fixed at "," rather than left to Papa's auto-detection:
  // the deal-import schema is always comma-separated, and auto-detection
  // risks misfiring on a legitimate file.
  //
  // skipEmptyLines: true (fixed 2026-08-23, code review Finding 2, HIGH) —
  // NOT "greedy". "greedy" also drops any line that is nothing but
  // delimiters (e.g. ",,,," for our 5-column schema), which is NOT a blank
  // line: it's a physical row the seller's spreadsheet actually wrote out,
  // just with every cell empty. Dropping it was silent data loss — it
  // never reached per-row validation, never appeared in the failure
  // summary, shifted every later row's number, and let a submission dodge
  // the MAX_CSV_ROWS cap by padding it with blank-looking rows. `true`
  // only drops genuinely zero-length lines (a stray blank line at EOF);
  // a delimiter-only row now survives as an ordinary data row and fails
  // per-row validation (every field empty) at its real row number, same
  // as any other bad row — see tests/import/parse-csv.spec.ts's
  // "blank-comma rows are preserved" suite.
  const parsed = Papa.parse<string[]>(decoded.text, { header: false, skipEmptyLines: true, delimiter: "," });
  if (parsed.errors.length > 0) {
    return csvImportError("MALFORMED_CSV", MALFORMED_ROW_MESSAGE((parsed.errors[0].row ?? 0) + 1));
  }

  const data = parsed.data;
  // Defensive only: no input has been found that reaches this branch —
  // any non-whitespace content in decoded.text (the guard above already
  // rejects pure whitespace) survives as at least one non-zero-length
  // line, which skipEmptyLines: true never drops. Kept so a future
  // papaparse/whitespace-detection change can't turn into an unguarded
  // `data[0]` read a few lines down (validateHeader(undefined) would
  // throw) — the same "never throw for user input" contract this whole
  // module keeps, not a claim that this line is reachable today.
  if (data.length === 0) return csvImportError("EMPTY_FILE", "The CSV file is empty.");

  const [headerRow, ...dataRows] = data;
  const header = validateHeader(headerRow);
  if (!header.ok) return header;

  if (dataRows.length > MAX_CSV_ROWS) {
    return csvImportError("TOO_MANY_ROWS", `The CSV file has more than ${MAX_CSV_ROWS} data rows.`);
  }

  const raggedIndex = findRaggedRowIndex(dataRows, headerRow.length);
  if (raggedIndex !== -1) {
    return csvImportError("MALFORMED_CSV", MALFORMED_ROW_MESSAGE(raggedIndex + 2));
  }

  return { ok: true, rows: dataRows.map((row) => buildRow(header.normalized, row)) };
}
