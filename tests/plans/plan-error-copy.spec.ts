// Sprint 12, Ticket 60. Copy coverage for
// app/admin/workspaces/[id]/plan/error-messages.ts.
//
// PlanErrorCode is a closed union, and every member of it now reaches a
// seller through describePlanError — T60 adds the ones that carry money and
// infrastructure news (the upgrade wall, the past-due block, the closed
// deal, a billing read we could not complete). The list below is a
// deliberate hand-maintained mirror of the union: a new code added to
// lib/plans/errors.ts without copy fails the type check in error-messages.ts,
// and a new code added without a line here fails this file — the two
// together are what stop a seller ever meeting a blank error.
//
// Pure: no DB, no React.

import { describe, expect, it } from "vitest";

import { describePlanError } from "@/app/admin/workspaces/[id]/plan/error-messages";
import type { PlanErrorCode } from "@/lib/plans/errors";

const ALL_CODES: readonly PlanErrorCode[] = [
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "PLAN_ALREADY_LIVE",
  "PLAN_CLOSED",
  "DEAL_LIMIT_REACHED",
  "BILLING_PAST_DUE",
  "BILLING_CHECK_FAILED",
  "GO_LIVE_NOT_PERMITTED",
  "INVALID_DATE_RANGE",
  "INCOHERENT_COMPLETION",
  "REORDER_SET_MISMATCH",
  "VALIDATION_ERROR",
  "UNKNOWN_ERROR",
];

describe("describePlanError — every code has product-voice copy", () => {
  it.each(ALL_CODES)("%s reads as a sentence, not an exception", (code) => {
    const message = describePlanError(code);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/!/);
    expect(message).toMatch(/^[A-Z]/);
    expect(message).toMatch(/\.$/);
  });

  it("gives every code its own sentence — no two share one", () => {
    const messages = ALL_CODES.map(describePlanError);

    expect(new Set(messages).size).toBe(ALL_CODES.length);
  });
});

describe("describePlanError — the T60 money and infrastructure codes", () => {
  it("tells a seller at their cap that the limit is the reason, and where to lift it", () => {
    const message = describePlanError("DEAL_LIMIT_REACHED");

    expect(message).toMatch(/active deals/i);
    expect(message).toMatch(/plan|upgrade/i);
  });

  it("tells a past-due seller their existing deals keep working", () => {
    const message = describePlanError("BILLING_PAST_DUE");

    expect(message).toMatch(/payment/i);
    expect(message).toMatch(/existing deals|keep working/i);
  });

  it("says we could not CHECK the plan — never that the seller is out of deals", () => {
    // Orchestrator call (2026-09-21): an infrastructure failure must never
    // render as the upgrade wall.
    const message = describePlanError("BILLING_CHECK_FAILED");

    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/upgrade/i);
    expect(message).not.toBe(describePlanError("DEAL_LIMIT_REACHED"));
  });

  it("explains that a closed deal is read-only and what to do next", () => {
    const message = describePlanError("PLAN_CLOSED");

    expect(message).toMatch(/closed/i);
    expect(message).toMatch(/new plan|read-only/i);
  });
});
