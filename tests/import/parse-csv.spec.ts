// Ticket 45 (Sprint 9) — pure CSV structural parsing. Covers only the
// SHAPE of the file (bytes/encoding/headers/row count/quoting) — per-field
// content rules (formats, formula injection) live in validate-rows.spec.ts,
// one module down. parseCsv() never throws for user input: every case here
// asserts a returned envelope, RED or GREEN.
//
// House style: tests/plans/validate.spec.ts (exact-string assertions on the
// discriminated-union result), tests/plans/queries.spec.ts (describe-per-
// behaviour naming). No Supabase client, no tests/fixtures/env import —
// this module has no I/O.

import { describe, expect, it } from "vitest";

import { MAX_CSV_BYTES, MAX_CSV_ROWS } from "@/lib/import/csv-limits";
import { parseCsv } from "@/lib/import/parse-csv";
// Used only by the "blank-comma rows" integration checkpoint below (code
// review Finding 2) — proves parseCsv's row-preservation fix actually
// reaches validate-rows.ts with the correct row number, not just that
// parseCsv's own return shape looks right in isolation.
import { validateImportRows } from "@/lib/import/validate-rows";

const HEADER = "company_name,company_domain,contact_email,plan_title,target_date";

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

function validRow(n: number | string = 1): string {
  return `Acme ${n},acme${n}.com,ceo@acme${n}.com,Q1 Plan ${n},2027-01-01`;
}

describe("parseCsv", () => {
  describe("size and encoding boundaries", () => {
    it("rejects a zero-byte file with EMPTY_FILE", () => {
      const result = parseCsv(csvBuffer(""));
      expect(result).toEqual({ ok: false, error: "EMPTY_FILE", message: "The CSV file is empty." });
    });

    it("rejects a whitespace-only file with EMPTY_FILE", () => {
      const result = parseCsv(csvBuffer("   \n   \n"));
      expect(result).toEqual({ ok: false, error: "EMPTY_FILE", message: "The CSV file is empty." });
    });

    it("rejects a file over the byte cap with FILE_TOO_LARGE", () => {
      const header = `${HEADER}\n`;
      const baseRow = "Acme,,,Plan,\n";
      const baseSize = Buffer.byteLength(header + baseRow, "utf-8");
      const padding = MAX_CSV_BYTES - baseSize + 1;
      const oversized = csvBuffer(header + `Acme,,,Plan,${"x".repeat(padding)}\n`);

      expect(Buffer.byteLength(oversized)).toBe(MAX_CSV_BYTES + 1);

      const result = parseCsv(oversized);
      expect(result).toEqual({
        ok: false,
        error: "FILE_TOO_LARGE",
        message: `The CSV file exceeds the ${MAX_CSV_BYTES} byte limit.`,
      });
    });

    it("accepts a file at exactly the byte cap", () => {
      const header = `${HEADER}\n`;
      const baseRow = "Acme,,,Plan,\n";
      const baseSize = Buffer.byteLength(header + baseRow, "utf-8");
      const padding = MAX_CSV_BYTES - baseSize;
      const exact = csvBuffer(header + `Acme,,,Plan,${"x".repeat(padding)}\n`);

      expect(Buffer.byteLength(exact)).toBe(MAX_CSV_BYTES);

      const result = parseCsv(exact);
      expect(result.ok).toBe(true);
    });

    it("strips a UTF-8 BOM instead of folding it into the first header name", () => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const rest = csvBuffer(`${HEADER}\n${validRow()}\n`);
      const result = parseCsv(Buffer.concat([bom, rest]));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].company_name).toBe("Acme 1");
    });

    it("rejects non-UTF-8 bytes with INVALID_ENCODING", () => {
      const invalid = Buffer.from([0x61, 0xff, 0xfe, 0x62]);
      const result = parseCsv(invalid);
      expect(result).toEqual({ ok: false, error: "INVALID_ENCODING", message: "The CSV file is not valid UTF-8 text." });
    });

    it("rejects a file whose decoded text contains a replacement character with INVALID_ENCODING", () => {
      // U+FFFD embedded directly (as opposed to arising from a failed
      // decode) — the defence-in-depth branch, not the TextDecoder-throws
      // branch above.
      const withReplacementChar = csvBuffer(`${HEADER}\nAcme�,,,Plan,\n`);
      const result = parseCsv(withReplacementChar);
      expect(result).toEqual({ ok: false, error: "INVALID_ENCODING", message: "The CSV file is not valid UTF-8 text." });
    });
  });

  describe("newline styles", () => {
    it("parses LF-terminated rows", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n${validRow()}\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toHaveLength(1);
    });

    it("parses CRLF-terminated rows", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\r\n${validRow()}\r\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toHaveLength(1);
    });
  });

  describe("header-only and empty-data cases", () => {
    it("returns an empty row list for a header-only file (no data rows)", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n`));
      expect(result).toEqual({ ok: true, rows: [] });
    });

    it("returns an empty row list for a header-only file with trailing blank lines", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n\n\n`));
      expect(result).toEqual({ ok: true, rows: [] });
    });

    it("treats a delimiter-only first line as a real (if useless) header row, not as EMPTY_FILE", () => {
      // Superseded by the code-review Finding 2 fix: skipEmptyLines was
      // changed from "greedy" (which silently dropped delimiter-only
      // lines — the exact bug Finding 2 flagged) to true (which drops
      // only genuinely zero-length lines). A ",,,," line is no longer
      // invisible to the parser: it is a real line with five empty
      // column names, all identical, so it fails header validation as a
      // duplicate rather than vanishing as if the file were blank.
      const result = parseCsv(csvBuffer(",,,,\n,,,,\n"));
      expect(result).toEqual({
        ok: false,
        error: "DUPLICATE_COLUMNS",
        message: "Duplicate column(s) in header: .",
      });
    });
  });

  describe("header validation", () => {
    it("accepts headers matched case-insensitively and whitespace-trimmed", () => {
      const messyHeader = " Company_Name , COMPANY_DOMAIN, Contact_Email ,Plan_Title,  Target_Date ";
      const result = parseCsv(csvBuffer(`${messyHeader}\n${validRow()}\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows[0]).toEqual({
        company_name: "Acme 1",
        company_domain: "acme1.com",
        contact_email: "ceo@acme1.com",
        plan_title: "Q1 Plan 1",
        target_date: "2027-01-01",
      });
    });

    it("rejects a header missing a required column with MISSING_COLUMNS naming it", () => {
      const header = "company_name,company_domain,contact_email,plan_title";
      const result = parseCsv(csvBuffer(`${header}\nAcme,acme.com,ceo@acme.com,Plan\n`));
      expect(result).toEqual({
        ok: false,
        error: "MISSING_COLUMNS",
        message: "Missing required column(s): target_date.",
      });
    });

    it("rejects a header with an unrecognised extra column with UNKNOWN_COLUMNS naming it", () => {
      const header = `${HEADER},notes`;
      const result = parseCsv(csvBuffer(`${header}\n${validRow()},some notes\n`));
      expect(result).toEqual({
        ok: false,
        error: "UNKNOWN_COLUMNS",
        message: "Unexpected column(s): notes.",
      });
    });

    it("rejects a header with a duplicate column name with DUPLICATE_COLUMNS naming it", () => {
      const header = "company_name,company_name,contact_email,plan_title,target_date,company_domain";
      const result = parseCsv(csvBuffer(`${header}\nAcme,Acme,ceo@acme.com,Plan,2027-01-01,acme.com\n`));
      expect(result).toEqual({
        ok: false,
        error: "DUPLICATE_COLUMNS",
        message: "Duplicate column(s) in header: company_name.",
      });
    });
  });

  describe("row count boundary", () => {
    function csvWithRows(count: number): Buffer {
      const rows = Array.from({ length: count }, (_, i) => `Company${i},,,Plan${i},`).join("\n");
      return csvBuffer(`${HEADER}\n${rows}\n`);
    }

    it("accepts exactly 200 data rows", () => {
      const result = parseCsv(csvWithRows(MAX_CSV_ROWS));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toHaveLength(MAX_CSV_ROWS);
    });

    it("rejects 201 data rows with TOO_MANY_ROWS", () => {
      const result = parseCsv(csvWithRows(MAX_CSV_ROWS + 1));
      expect(result).toEqual({
        ok: false,
        error: "TOO_MANY_ROWS",
        message: `The CSV file has more than ${MAX_CSV_ROWS} data rows.`,
      });
    });
  });

  describe("quoted fields", () => {
    it("parses a quoted field containing a comma", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n"Acme, Inc.",acme.com,ceo@acme.com,Q1 Plan,2027-01-01\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows[0].company_name).toBe("Acme, Inc.");
    });

    it("parses a quoted field containing an embedded newline", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n"Acme\nInc.",acme.com,ceo@acme.com,Q1 Plan,2027-01-01\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows[0].company_name).toBe("Acme\nInc.");
    });

    it("rejects an unterminated quoted field with MALFORMED_CSV", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n"Acme,acme.com,ceo@acme.com,Q1 Plan,2027-01-01\n`));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("MALFORMED_CSV");
    });
  });

  describe("malformed row shape", () => {
    it("rejects a row with fewer fields than the header with MALFORMED_CSV", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\nAcme,acme.com,ceo@acme.com\n`));
      expect(result).toEqual({
        ok: false,
        error: "MALFORMED_CSV",
        message: "Row 2 could not be parsed: check for unmatched quotes or an unexpected number of columns.",
      });
    });

    it("rejects a row with more fields than the header with MALFORMED_CSV", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n${validRow()},extra-field\n`));
      expect(result).toEqual({
        ok: false,
        error: "MALFORMED_CSV",
        message: "Row 2 could not be parsed: check for unmatched quotes or an unexpected number of columns.",
      });
    });
  });

  describe("valid multi-row file", () => {
    it("parses several valid rows into row objects keyed by column name", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n${validRow(1)}\n${validRow(2)}\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toEqual([
        {
          company_name: "Acme 1",
          company_domain: "acme1.com",
          contact_email: "ceo@acme1.com",
          plan_title: "Q1 Plan 1",
          target_date: "2027-01-01",
        },
        {
          company_name: "Acme 2",
          company_domain: "acme2.com",
          contact_email: "ceo@acme2.com",
          plan_title: "Q1 Plan 2",
          target_date: "2027-01-01",
        },
      ]);
    });
  });

  describe("blank-comma rows are preserved, not silently dropped (code review Finding 2)", () => {
    // A row of nothing but delimiters (",,,," for our 5-column schema) is
    // NOT a blank line — it is a physical CSV row the seller's
    // spreadsheet actually wrote out, just with every cell empty. Dropping
    // it (skipEmptyLines: "greedy" used to) is silent data loss: it never
    // reaches per-row validation, never appears in the failure summary,
    // shifts every subsequent row's number, and lets a submission evade
    // the row-count cap. A TRULY empty line (zero characters between two
    // newlines) is still dropped — see the EMPTY_FILE case at the bottom
    // of this block — only delimiter-only rows changed behaviour.
    const BLANK_ROW = ",,,,"; // 5 empty fields, matching HEADER's 5 columns

    it("keeps a comma-only data row as an explicit (empty) row instead of dropping it", () => {
      const result = parseCsv(csvBuffer(`${HEADER}\n${validRow(1)}\n${BLANK_ROW}\n${validRow(2)}\n`));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toHaveLength(3);
      expect(result.rows[1]).toEqual({
        company_name: "",
        company_domain: "",
        contact_email: "",
        plan_title: "",
        target_date: "",
      });
    });

    it("(a) the blank-comma row surfaces as a required-field validation failure at the correct row number", () => {
      const parsed = parseCsv(csvBuffer(`${HEADER}\n${validRow(1)}\n${BLANK_ROW}\n${validRow(2)}\n`));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const results = validateImportRows(parsed.rows);
      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[1]).toEqual({
        rowNumber: 2,
        ok: false,
        errors: [
          "company_name: is required.",
          // company_domain is required too (code review, Phase 2a: moved up
          // from a DB-writer-only check — see validate-rows.ts's
          // ValidatedImportRow comment) — a fully blank row now fails on it
          // alongside company_name and plan_title.
          "company_domain: is required.",
          "plan_title: is required.",
        ],
      });
      expect(results[2].ok).toBe(true);
    });

    it("(b) reports the correct physical row number for a ragged row that follows a blank-comma row", () => {
      const result = parseCsv(
        csvBuffer(`${HEADER}\n${validRow(1)}\n${BLANK_ROW}\nAcme,acme.com,ceo@acme.com\n`), // ragged: 3 fields, not 5
      );
      expect(result).toEqual({
        ok: false,
        error: "MALFORMED_CSV",
        message: "Row 4 could not be parsed: check for unmatched quotes or an unexpected number of columns.",
      });
    });

    it("(c) counts blank-comma rows toward the physical row cap (200 valid + 1 blank = 201 → TOO_MANY_ROWS)", () => {
      const validRows = Array.from({ length: MAX_CSV_ROWS }, (_, i) => `Company${i},,,Plan${i},`);
      const withOneBlank = [...validRows, BLANK_ROW];
      const result = parseCsv(csvBuffer(`${HEADER}\n${withOneBlank.join("\n")}\n`));
      expect(result).toEqual({
        ok: false,
        error: "TOO_MANY_ROWS",
        message: `The CSV file has more than ${MAX_CSV_ROWS} data rows.`,
      });
    });

    it("(d) still returns EMPTY_FILE for a whole file that is blank/newline-only (no comma content at all)", () => {
      const result = parseCsv(csvBuffer("\n\n\n"));
      expect(result).toEqual({ ok: false, error: "EMPTY_FILE", message: "The CSV file is empty." });
    });
  });
});
