// T28-5 (Sprint 6, Ticket 28). Pure unit tests for mapPostgrestError against
// synthetic PostgrestError-shaped objects — no DB, no Supabase client. This
// is the primary verification for the mapper; behavioural DB tests that
// provoke each constraint for real belong to QA's T28-16.

import { describe, expect, it } from "vitest";

import { mapPostgrestError, type PostgrestErrorLike } from "@/lib/plans/errors";

function pgError(overrides: PostgrestErrorLike): PostgrestErrorLike {
  return { code: null, message: null, details: null, ...overrides };
}

describe("mapPostgrestError", () => {
  describe("23505 (unique violation)", () => {
    it("maps idx_success_plans_one_live_per_workspace to PLAN_ALREADY_LIVE / 409", () => {
      const error = pgError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "idx_success_plans_one_live_per_workspace"',
        details: "Key (workspace_id)=(...) already exists.",
      });

      expect(mapPostgrestError(error)).toEqual({ code: "PLAN_ALREADY_LIVE", status: 409 });
    });

    it("maps an unrelated unique constraint to UNKNOWN_ERROR / 500, never PLAN_ALREADY_LIVE", () => {
      const error = pgError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_workspaces_tenant_crm"',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });

    it("maps a 23505 with no extractable constraint name to UNKNOWN_ERROR / 500", () => {
      const error = pgError({ code: "23505", message: "duplicate key value" });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });
  });

  describe("23514 (check violation)", () => {
    it("maps success_plans_date_order to INVALID_DATE_RANGE / 400", () => {
      const error = pgError({
        code: "23514",
        message:
          'new row for relation "success_plans" violates check constraint "success_plans_date_order"',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "INVALID_DATE_RANGE", status: 400 });
    });

    it("maps plan_steps_completion_coherent to INCOHERENT_COMPLETION / 500 (a bug, not user error)", () => {
      const error = pgError({
        code: "23514",
        message:
          'new row for relation "plan_steps" violates check constraint "plan_steps_completion_coherent"',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "INCOHERENT_COMPLETION", status: 500 });
    });

    it("does NOT misclassify the unnamed success_plans_status_check as a date-range error", () => {
      // Guards the fallback the code comment explicitly rejects: a
      // relation-only ("mentions success_plans") fallback would have
      // misclassified this as INVALID_DATE_RANGE.
      const error = pgError({
        code: "23514",
        message:
          'new row for relation "success_plans" violates check constraint "success_plans_status_check"',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });

    it("maps an unrecognised 23514 to UNKNOWN_ERROR / 500", () => {
      const error = pgError({
        code: "23514",
        message: 'new row for relation "plan_stages" violates check constraint "plan_stages_status_check"',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });

    it("extracts the constraint name from `details` when `message` doesn't carry it", () => {
      const error = pgError({
        code: "23514",
        message: "check constraint violated",
        details: 'Failing row contains constraint "success_plans_date_order".',
      });

      expect(mapPostgrestError(error)).toEqual({ code: "INVALID_DATE_RANGE", status: 400 });
    });
  });

  describe("42501 (RLS policy violation)", () => {
    it("maps to NOT_FOUND / 404, never 403", () => {
      const error = pgError({
        code: "42501",
        message: 'new row violates row-level security policy for table "success_plans"',
      });

      const result = mapPostgrestError(error);

      expect(result).toEqual({ code: "NOT_FOUND", status: 404 });
      expect(result.status).not.toBe(403);
    });
  });

  describe("P0001 (0007's reorder RPCs)", () => {
    it("maps REORDER_SET_MISMATCH to the REORDER_SET_MISMATCH code / 400", () => {
      const error = pgError({ code: "P0001", message: "REORDER_SET_MISMATCH" });

      expect(mapPostgrestError(error)).toEqual({ code: "REORDER_SET_MISMATCH", status: 400 });
    });

    it("does not map an unrelated P0001 exception to REORDER_SET_MISMATCH", () => {
      const error = pgError({ code: "P0001", message: "some other raised exception" });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });
  });

  describe("unknown / unmapped errors", () => {
    it("maps an unrecognised SQLSTATE to a safe generic 500 that leaks no Postgres text", () => {
      const error = pgError({ code: "08006", message: "connection failure to the database" });

      const result = mapPostgrestError(error);

      expect(result).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
      // Structural guarantee: the mapping shape has no message/details field
      // at all, so a caller that only reads `result` cannot forward raw
      // Postgres text even by accident.
      expect(Object.keys(result)).toEqual(["code", "status"]);
    });

    it("maps a missing/null code to UNKNOWN_ERROR / 500", () => {
      const error = pgError({ code: null, message: "something went wrong" });

      expect(mapPostgrestError(error)).toEqual({ code: "UNKNOWN_ERROR", status: 500 });
    });
  });
});
