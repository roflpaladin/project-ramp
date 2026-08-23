// Ticket 45 (Sprint 9) — per-row deal-import validation. Every case here
// returns a result for its OWN row rather than throwing, per the AC:
// validateImportRows must never abort the batch over one bad row. Reuses
// lib/plans/validate.ts's hand-rolled style (DATE_FORMAT/EMAIL_FORMAT
// regex constants, plain "field: reason" message convention) rather than
// introducing a second validation vocabulary — see lib/import/validate-rows.ts's
// header comment for the mapping.
//
// The formula-injection matrix is the security AC: Google Sheets/Excel treat
// a cell starting with =, +, @, or a tab/CR as a formula regardless of
// column type, so a CSV-imported "company name" cell is exactly as
// dangerous as any other cell. We REJECT rather than silently rewrite —
// see the module's header comment for why silent mutation was rejected.

import { describe, expect, it } from "vitest";

import type { CsvRow } from "@/lib/import/parse-csv";
import { validateImportRow, validateImportRows } from "@/lib/import/validate-rows";

const NOW = new Date("2026-06-01T00:00:00Z");

const VALID_ROW: CsvRow = {
  company_name: "Acme Corp",
  company_domain: "acme.com",
  contact_email: "ceo@acme.com",
  plan_title: "Q1 Rollout",
  target_date: "2027-01-01",
};

describe("validateImportRow", () => {
  it("accepts a fully valid row", () => {
    const result = validateImportRow(VALID_ROW, 1, NOW);
    expect(result).toEqual({
      rowNumber: 1,
      ok: true,
      value: {
        company_name: "Acme Corp",
        company_domain: "acme.com",
        contact_email: "ceo@acme.com",
        plan_title: "Q1 Rollout",
        target_date: "2027-01-01",
      },
    });
  });

  it("accepts a row with every optional field blank", () => {
    const row: CsvRow = { ...VALID_ROW, company_domain: "", contact_email: "", target_date: "" };
    const result = validateImportRow(row, 1, NOW);
    expect(result).toEqual({
      rowNumber: 1,
      ok: true,
      value: {
        company_name: "Acme Corp",
        company_domain: null,
        contact_email: null,
        plan_title: "Q1 Rollout",
        target_date: null,
      },
    });
  });

  it("trims surrounding whitespace from every field", () => {
    const row: CsvRow = {
      company_name: "  Acme Corp  ",
      company_domain: "  acme.com  ",
      contact_email: "  ceo@acme.com  ",
      plan_title: "  Q1 Rollout  ",
      target_date: "  2027-01-01  ",
    };
    const result = validateImportRow(row, 1, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      company_name: "Acme Corp",
      company_domain: "acme.com",
      contact_email: "ceo@acme.com",
      plan_title: "Q1 Rollout",
      target_date: "2027-01-01",
    });
  });

  describe("company_name", () => {
    it("rejects an empty company_name", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "" }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: ["company_name: is required."] });
    });

    it("rejects a whitespace-only company_name", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "   " }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: ["company_name: is required."] });
    });

    it("accepts a company_name at exactly 120 characters", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "A".repeat(120) }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a company_name over 120 characters", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "A".repeat(121) }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["company_name: must be 120 characters or fewer."],
      });
    });
  });

  describe("company_domain (optional)", () => {
    it("accepts a missing company_domain", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: "" }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("accepts a plausible hostname", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: "sub.acme.co" }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a domain with no TLD", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: "acme" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["company_domain: must be a valid domain (e.g. example.com)."],
      });
    });

    it("rejects a domain containing a space", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: "acme corp.com" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["company_domain: must be a valid domain (e.g. example.com)."],
      });
    });
  });

  describe("contact_email (optional)", () => {
    it("accepts a missing contact_email", () => {
      const result = validateImportRow({ ...VALID_ROW, contact_email: "" }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a malformed email", () => {
      const result = validateImportRow({ ...VALID_ROW, contact_email: "not-an-email" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["contact_email: must be a valid email address."],
      });
    });
  });

  describe("plan_title", () => {
    it("rejects an empty plan_title", () => {
      const result = validateImportRow({ ...VALID_ROW, plan_title: "" }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: ["plan_title: is required."] });
    });

    it("accepts a plan_title at exactly 160 characters", () => {
      const result = validateImportRow({ ...VALID_ROW, plan_title: "B".repeat(160) }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a plan_title over 160 characters", () => {
      const result = validateImportRow({ ...VALID_ROW, plan_title: "B".repeat(161) }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["plan_title: must be 160 characters or fewer."],
      });
    });
  });

  describe("target_date (optional)", () => {
    it("accepts a missing target_date", () => {
      const result = validateImportRow({ ...VALID_ROW, target_date: "" }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a malformed target_date", () => {
      const result = validateImportRow({ ...VALID_ROW, target_date: "01/01/2027" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["target_date: must be in YYYY-MM-DD format."],
      });
    });

    it("accepts a target_date equal to today", () => {
      const result = validateImportRow({ ...VALID_ROW, target_date: "2026-06-01" }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("rejects a target_date in the past", () => {
      const result = validateImportRow({ ...VALID_ROW, target_date: "2020-01-01" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["target_date: must not be in the past."],
      });
    });
  });

  describe("formula-injection rule (security AC)", () => {
    const DANGEROUS_MESSAGE =
      "company_name: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.";

    it.each([
      ["=CMD(...)", "=CMD(...)"],
      ["=1+1", "=1+1"],
      ["+SUM(A1)", "+SUM(A1)"],
      ["@echo", "@echo"],
      ["-2+3", "-2+3"],
      ["tab-prefixed", "\tActa Inc"],
      ["CR-prefixed", "\rActa Inc"],
    ])("rejects a company_name that is %s", (_label, value) => {
      const result = validateImportRow({ ...VALID_ROW, company_name: value }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: [DANGEROUS_MESSAGE] });
    });

    it("rejects a company_name containing an embedded NUL byte", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "Acme\x00Corp" }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: [DANGEROUS_MESSAGE] });
    });

    it.each([
      ["a mid-string equals sign", "Acme=Corp"],
      ["a lowercase word starting with e", "e=mc2 Ltd"],
    ])("accepts a company_name containing %s (not a leading character)", (_label, value) => {
      const result = validateImportRow({ ...VALID_ROW, company_name: value }, 1, NOW);
      expect(result.ok).toBe(true);
    });

    it("applies the rule to every field, not just company_name", () => {
      const row: CsvRow = {
        company_name: "=1+1",
        company_domain: "+acme.com",
        contact_email: "@acme.com",
        plan_title: "-Plan",
        target_date: "=2027-01-01",
      };
      const result = validateImportRow(row, 1, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toEqual([
        "company_name: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        "company_domain: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        "contact_email: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        "plan_title: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        "target_date: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
      ]);
    });
  });

  describe("formula-injection rule — Unicode leading whitespace (code review Finding 1)", () => {
    // These characters are all stripped by String.prototype.trim() — the
    // SAME trim used to produce the stored value — but are not ordinary
    // ASCII spaces. A check that only strips ASCII spaces before
    // inspecting the "first character" sees the Unicode whitespace char
    // itself, doesn't recognise it as dangerous, and lets the =/+/@/-
    // hiding right behind it through — while the value that actually gets
    // STORED has already had that Unicode whitespace trimmed off,
    // exposing the bare formula. The check must inspect the exact same
    // trimmed value that gets stored, not a hand-rolled ASCII-only strip.
    const DANGEROUS_TAIL = "=1+1";

    it("rejects a BOM (U+FEFF)-prefixed formula in company_name", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: `﻿${DANGEROUS_TAIL}` }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["company_name: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte."],
      });
    });

    it("rejects an NBSP (U+00A0)-prefixed formula in plan_title", () => {
      const result = validateImportRow({ ...VALID_ROW, plan_title: ` ${DANGEROUS_TAIL}` }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["plan_title: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte."],
      });
    });

    it("rejects an em-space (U+2003)-prefixed formula in company_domain", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: ` ${DANGEROUS_TAIL}` }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: [
          "company_domain: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        ],
      });
    });

    it("rejects an ideographic-space (U+3000)-prefixed formula in contact_email", () => {
      const result = validateImportRow({ ...VALID_ROW, contact_email: `　${DANGEROUS_TAIL}` }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: [
          "contact_email: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte.",
        ],
      });
    });

    it("still rejects a plain tab-prefixed value (no regression from the Unicode fix)", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "\tActa Inc" }, 1, NOW);
      expect(result).toEqual({
        rowNumber: 1,
        ok: false,
        errors: ["company_name: value cannot start with =, +, @, -, a tab, or a carriage return, and cannot contain a null byte."],
      });
    });

    it("treats a required field that is ONLY Unicode whitespace as empty, not dangerous", () => {
      const result = validateImportRow({ ...VALID_ROW, company_name: "﻿  　" }, 1, NOW);
      expect(result).toEqual({ rowNumber: 1, ok: false, errors: ["company_name: is required."] });
    });

    it("treats an optional field that is ONLY Unicode whitespace as absent, not dangerous", () => {
      const result = validateImportRow({ ...VALID_ROW, company_domain: "﻿  　" }, 1, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.company_domain).toBeNull();
    });
  });
});

describe("validateImportRows (batch)", () => {
  it("never aborts the batch: reports row 3's failure without aborting rows 4-10", () => {
    const rows: CsvRow[] = Array.from({ length: 10 }, (_, i) =>
      i === 2 ? { ...VALID_ROW, company_name: "" } : { ...VALID_ROW, company_name: `Acme ${i + 1}` },
    );

    const results = validateImportRows(rows, NOW);

    expect(results).toHaveLength(10);
    expect(results[2]).toEqual({ rowNumber: 3, ok: false, errors: ["company_name: is required."] });
    const otherRows = results.filter((_, i) => i !== 2);
    expect(otherRows.every((r) => r.ok)).toBe(true);
  });

  it("numbers rows 1-indexed within the data rows given (excluding header)", () => {
    const results = validateImportRows([VALID_ROW, VALID_ROW], NOW);
    expect(results.map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(validateImportRows([], NOW)).toEqual([]);
  });
});
