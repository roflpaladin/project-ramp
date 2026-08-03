// T28-6 (Sprint 6, Ticket 28) — exhaustive per-branch unit tests for the
// hand-rolled boundary validators, delivered in the same pass as
// lib/plans/validate.ts per the ticket's reversal trigger: without this file,
// validate.ts should have been Zod instead.
//
// Also covers T28-18: checkDateOrder, the TypeScript pre-check for
// target_date < start_date, tested in its own describe block, standalone
// from the DB path (which is QA's tests/plans/errors.spec.ts-adjacent DB
// suite, T28-16) and separately from its use inside validatePlanPatch /
// validateNewPlanInput below.

import { describe, expect, it } from "vitest";

import type { NewPlanInput, NewStageInput, NewStepInput, PlanPatch, StagePatch, StepPatch } from "@/lib/plans/mutations";
import {
  checkDateOrder,
  validateNewPlanInput,
  validateNewStageInput,
  validateNewStepInput,
  validatePlanPatch,
  validateReorderInput,
  validateStagePatch,
  validateStepPatch,
} from "@/lib/plans/validate";

describe("checkDateOrder (T28-18: TypeScript pre-check)", () => {
  it("passes when both dates are absent", () => {
    expect(checkDateOrder(null, null)).toEqual({ ok: true, data: undefined });
  });

  it("passes when only start_date is present", () => {
    expect(checkDateOrder("2026-01-01", undefined)).toEqual({ ok: true, data: undefined });
  });

  it("passes when only target_date is present", () => {
    expect(checkDateOrder(undefined, "2026-01-01")).toEqual({ ok: true, data: undefined });
  });

  it("passes when target_date equals start_date", () => {
    expect(checkDateOrder("2026-01-01", "2026-01-01")).toEqual({ ok: true, data: undefined });
  });

  it("passes when target_date is after start_date", () => {
    expect(checkDateOrder("2026-01-01", "2026-06-01")).toEqual({ ok: true, data: undefined });
  });

  it("fails with INVALID_DATE_RANGE when target_date is before start_date", () => {
    expect(checkDateOrder("2026-06-01", "2026-01-01")).toEqual({ ok: false, code: "INVALID_DATE_RANGE" });
  });
});

describe("validateNewPlanInput", () => {
  const base: NewPlanInput = { workspace_id: "ws-1", title: "Q1 rollout" };

  it("accepts a minimal valid input", () => {
    expect(validateNewPlanInput(base)).toEqual({ ok: true, data: base });
  });

  it("trims the title", () => {
    const result = validateNewPlanInput({ ...base, title: "  Q1 rollout  " });
    expect(result).toEqual({ ok: true, data: { ...base, title: "Q1 rollout" } });
  });

  it("rejects an empty title", () => {
    expect(validateNewPlanInput({ ...base, title: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a whitespace-only title", () => {
    expect(validateNewPlanInput({ ...base, title: "   " })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a missing workspace_id", () => {
    expect(validateNewPlanInput({ ...base, workspace_id: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed start_date", () => {
    expect(validateNewPlanInput({ ...base, start_date: "01/01/2026" })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a malformed target_date", () => {
    expect(validateNewPlanInput({ ...base, target_date: "not-a-date" })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects target_date before start_date", () => {
    expect(
      validateNewPlanInput({ ...base, start_date: "2026-06-01", target_date: "2026-01-01" }),
    ).toEqual({ ok: false, code: "INVALID_DATE_RANGE" });
  });

  it("accepts an in-order date range", () => {
    const input = { ...base, start_date: "2026-01-01", target_date: "2026-06-01" };
    expect(validateNewPlanInput(input)).toEqual({ ok: true, data: input });
  });

  it("rejects an out-of-domain status", () => {
    expect(validateNewPlanInput({ ...base, status: "cancelled" as never })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("accepts a valid status", () => {
    const input = { ...base, status: "active" as const };
    expect(validateNewPlanInput(input)).toEqual({ ok: true, data: input });
  });
});

describe("validatePlanPatch", () => {
  it("accepts an empty patch", () => {
    expect(validatePlanPatch({})).toEqual({ ok: true, data: {} });
  });

  it("rejects an empty-string title", () => {
    expect(validatePlanPatch({ title: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a whitespace-only title", () => {
    expect(validatePlanPatch({ title: "   " })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed start_date", () => {
    expect(validatePlanPatch({ start_date: "2026/01/01" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed target_date", () => {
    expect(validatePlanPatch({ target_date: "2026/01/01" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects target_date before start_date when both are in the same patch", () => {
    const patch: PlanPatch = { start_date: "2026-06-01", target_date: "2026-01-01" };
    expect(validatePlanPatch(patch)).toEqual({ ok: false, code: "INVALID_DATE_RANGE" });
  });

  it("does not cross-check date order when only one date is in the patch", () => {
    // Documented limitation: a single-field patch can't be checked against a
    // row it hasn't read. write.ts's round trip against 0005's CHECK is the
    // actual guarantee here, not this function.
    expect(validatePlanPatch({ target_date: "2020-01-01" })).toEqual({
      ok: true,
      data: { target_date: "2020-01-01" },
    });
  });

  it("rejects an out-of-domain status", () => {
    expect(validatePlanPatch({ status: "archived" as never })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("accepts a valid full patch", () => {
    const patch: PlanPatch = { title: "Renamed", start_date: "2026-01-01", target_date: "2026-06-01", status: "won" };
    expect(validatePlanPatch(patch)).toEqual({ ok: true, data: patch });
  });
});

describe("validateNewStageInput", () => {
  const base: NewStageInput = { plan_id: "plan-1", title: "Discovery" };

  it("accepts a minimal valid input", () => {
    expect(validateNewStageInput(base)).toEqual({ ok: true, data: base });
  });

  it("rejects an empty title", () => {
    expect(validateNewStageInput({ ...base, title: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a missing plan_id", () => {
    expect(validateNewStageInput({ ...base, plan_id: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a negative display_order", () => {
    expect(validateNewStageInput({ ...base, display_order: -1 })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a non-integer display_order", () => {
    expect(validateNewStageInput({ ...base, display_order: 1.5 })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("accepts display_order zero", () => {
    const input = { ...base, display_order: 0 };
    expect(validateNewStageInput(input)).toEqual({ ok: true, data: input });
  });

  it("rejects an out-of-domain status", () => {
    expect(validateNewStageInput({ ...base, status: "blocked" as never })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });
});

describe("validateStagePatch", () => {
  it("accepts an empty patch", () => {
    expect(validateStagePatch({})).toEqual({ ok: true, data: {} });
  });

  it("rejects an empty-string title", () => {
    expect(validateStagePatch({ title: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a negative display_order", () => {
    expect(validateStagePatch({ display_order: -5 })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects an out-of-domain status", () => {
    expect(validateStagePatch({ status: "nope" as never })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("accepts a valid full patch", () => {
    const patch: StagePatch = { title: "Renamed", display_order: 2, status: "current" };
    expect(validateStagePatch(patch)).toEqual({ ok: true, data: patch });
  });
});

describe("validateNewStepInput", () => {
  const base: NewStepInput = { stage_id: "stage-1", label: "Sign MSA", owner_side: "buyer" };

  it("accepts a minimal valid input", () => {
    expect(validateNewStepInput(base)).toEqual({ ok: true, data: base });
  });

  it("rejects an empty label", () => {
    expect(validateNewStepInput({ ...base, label: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a missing stage_id", () => {
    expect(validateNewStepInput({ ...base, stage_id: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects an out-of-domain owner_side", () => {
    expect(validateNewStepInput({ ...base, owner_side: "both" as never })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a malformed owner_email", () => {
    expect(validateNewStepInput({ ...base, owner_email: "not-an-email" })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("accepts a valid owner_email", () => {
    const input = { ...base, owner_email: "rep@acme.com" };
    expect(validateNewStepInput(input)).toEqual({ ok: true, data: input });
  });

  it("accepts a null owner_email", () => {
    const input = { ...base, owner_email: null };
    expect(validateNewStepInput(input)).toEqual({ ok: true, data: input });
  });

  it("rejects a malformed due_date", () => {
    expect(validateNewStepInput({ ...base, due_date: "yesterday" })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a negative display_order", () => {
    expect(validateNewStepInput({ ...base, display_order: -1 })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects status 'done' at runtime even though the type excludes it", () => {
    // Simulates a FormData-assembled object bypassing NewStepInput's
    // compile-time Exclude<StepStatus, "done"> — the boundary must not trust
    // the type system for input that didn't originate as a TS literal.
    const withDoneStatus = { ...base, status: "done" } as unknown as NewStepInput;
    expect(validateNewStepInput(withDoneStatus)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("accepts status 'blocked'", () => {
    const input = { ...base, status: "blocked" as const };
    expect(validateNewStepInput(input)).toEqual({ ok: true, data: input });
  });
});

describe("validateStepPatch", () => {
  it("accepts an empty patch", () => {
    expect(validateStepPatch({})).toEqual({ ok: true, data: {} });
  });

  it("rejects an empty-string label", () => {
    expect(validateStepPatch({ label: "" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects an out-of-domain owner_side", () => {
    expect(validateStepPatch({ owner_side: "everyone" as never })).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a malformed owner_email", () => {
    expect(validateStepPatch({ owner_email: "nope" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed due_date", () => {
    expect(validateStepPatch({ due_date: "12-31-2026" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a negative display_order", () => {
    expect(validateStepPatch({ display_order: -2 })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects status 'done' at runtime", () => {
    const withDoneStatus = { status: "done" } as unknown as StepPatch;
    expect(validateStepPatch(withDoneStatus)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("accepts a valid full patch", () => {
    const patch: StepPatch = {
      label: "Sign the MSA",
      owner_side: "seller",
      owner_email: "ae@ramp.test",
      due_date: "2026-03-01",
      display_order: 3,
      status: "open",
    };
    expect(validateStepPatch(patch)).toEqual({ ok: true, data: patch });
  });
});

describe("validateReorderInput", () => {
  const uuidA = "11111111-1111-4111-8111-111111111111";
  const uuidB = "22222222-2222-4222-8222-222222222222";

  it("accepts a valid ordered id array", () => {
    expect(validateReorderInput([uuidA, uuidB])).toEqual({ ok: true, data: [uuidA, uuidB] });
  });

  it("accepts an empty array (a parent with zero children)", () => {
    expect(validateReorderInput([])).toEqual({ ok: true, data: [] });
  });

  it("rejects a non-array input", () => {
    expect(validateReorderInput("not-an-array" as never)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects an array containing a non-string element", () => {
    expect(validateReorderInput([uuidA, 42 as never])).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects an array containing a malformed uuid", () => {
    expect(validateReorderInput([uuidA, "not-a-uuid"])).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });
});
