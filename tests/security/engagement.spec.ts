// T31-8 (Sprint 6, Ticket 31; plans/sprint-6-7-replan.md §6). Unit tests for
// lib/plans/engagement.ts's computeEngagementSignal — a pure function, zero
// I/O, `now` always injected. Every stall-boundary assertion here is a clock
// test by construction: `now` is a fixed constant, never Date.now()/new
// Date(), so a flake here would mean the function itself is non-deterministic
// (a real defect), not test timing.

import { describe, expect, it } from "vitest";
import { computeEngagementSignal, type EngagementEventInput } from "@/lib/plans/engagement";
import type { PlanStepRow } from "@/lib/plans/types";

const NOW = new Date("2026-08-10T00:00:00.000Z");
const STALL_THRESHOLD_DAYS = 5;

function makeStep(overrides: Partial<PlanStepRow> & Pick<PlanStepRow, "id">): PlanStepRow {
  return {
    stage_id: "stage-1",
    label: "Step",
    owner_side: "buyer",
    owner_name: null,
    owner_email: null,
    due_date: null,
    status: "open",
    display_order: 0,
    completed_at: null,
    completed_by_email: null,
    private_note: null,
    ...overrides,
  };
}

function eventAt(isoOffsetDays: number): EngagementEventInput {
  const date = new Date(NOW.getTime() - isoOffsetDays * 24 * 60 * 60 * 1000);
  return { actionType: "portal_view", createdAt: date.toISOString() };
}

const OPEN_BUYER_STEP = [makeStep({ id: "step-1", owner_side: "buyer", status: "open" })];
const NO_STEPS: PlanStepRow[] = [];

describe("computeEngagementSignal — clock behaviour at the stall boundary", () => {
  it("is active when the last event is exactly stallThresholdDays old (boundary, inclusive)", () => {
    // Arrange
    const events = [eventAt(STALL_THRESHOLD_DAYS)];
    // Act
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    // Assert — daysSinceLastActivity <= stallThresholdDays is "active" per the
    // module's own documented boundary semantics (<=, not <).
    expect(signal.state).toBe("active");
    expect(signal.daysSinceLastActivity).toBe(STALL_THRESHOLD_DAYS);
  });

  it("is active when the last event is just under stallThresholdDays old", () => {
    const events = [eventAt(STALL_THRESHOLD_DAYS - 1)];
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("active");
  });

  it("is stalled (not active) when the last event is just over stallThresholdDays old and a buyer step is open", () => {
    const events = [eventAt(STALL_THRESHOLD_DAYS + 1)];
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("stalled");
    expect(signal.daysSinceLastActivity).toBe(STALL_THRESHOLD_DAYS + 1);
  });
});

describe("computeEngagementSignal — active > stalled > waiting precedence", () => {
  it("returns active even when a buyer-owned step is open, when there is recent activity", () => {
    const events = [eventAt(0)];
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("active");
  });

  it("returns stalled (not waiting) when activity is old AND a buyer-owned step is open", () => {
    const events = [eventAt(STALL_THRESHOLD_DAYS + 10)];
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("stalled");
  });

  it("returns waiting (not stalled) when activity is old and no buyer-owned step is open", () => {
    const events = [eventAt(STALL_THRESHOLD_DAYS + 10)];
    const sellerOnlySteps = [makeStep({ id: "step-1", owner_side: "seller", status: "open" })];
    const signal = computeEngagementSignal(events, sellerOnlySteps, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("waiting");
  });
});

describe("computeEngagementSignal — empty events", () => {
  it("treats a never-engaged buyer with an open buyer-owned step as stalled, not waiting", () => {
    // Per the module's own documented semantics: silence from day one is
    // exactly the condition the nudge exists to surface, not a softer state.
    const signal = computeEngagementSignal([], OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("stalled");
    expect(signal.lastActivityAt).toBeNull();
    expect(signal.daysSinceLastActivity).toBeNull();
  });

  it("returns waiting when there are no events and no buyer-owned open steps at all", () => {
    const signal = computeEngagementSignal([], NO_STEPS, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("waiting");
    expect(signal.openBuyerStepCount).toBe(0);
  });
});

describe("computeEngagementSignal — no buyer-owned open steps", () => {
  it("returns waiting when all buyer-owned steps are done, even with stale/no activity", () => {
    const doneBuyerStep = [makeStep({ id: "step-1", owner_side: "buyer", status: "done" })];
    const signal = computeEngagementSignal([], doneBuyerStep, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("waiting");
  });
});

describe("computeEngagementSignal — buyer-owned open step with stale/no activity", () => {
  it("returns stalled with the correct openBuyerStepCount when multiple buyer steps are open", () => {
    const steps = [
      makeStep({ id: "step-1", owner_side: "buyer", status: "open" }),
      makeStep({ id: "step-2", owner_side: "buyer", status: "open" }),
      makeStep({ id: "step-3", owner_side: "seller", status: "open" }), // not counted
    ];
    const signal = computeEngagementSignal([eventAt(STALL_THRESHOLD_DAYS + 1)], steps, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("stalled");
    expect(signal.openBuyerStepCount).toBe(2);
  });
});

describe("computeEngagementSignal — invalid now", () => {
  it("throws for an unparsable now string", () => {
    expect(() => computeEngagementSignal([], OPEN_BUYER_STEP, "not-a-date", STALL_THRESHOLD_DAYS)).toThrow();
  });

  it("throws for a NaN Date object passed as now", () => {
    expect(() => computeEngagementSignal([], OPEN_BUYER_STEP, new Date("invalid"), STALL_THRESHOLD_DAYS)).toThrow();
  });
});

describe("computeEngagementSignal — malformed event createdAt", () => {
  it("skips an event with an unparsable createdAt rather than throwing", () => {
    const events: EngagementEventInput[] = [{ actionType: "portal_view", createdAt: "not-a-real-timestamp" }];
    expect(() => computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS)).not.toThrow();
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.lastActivityAt).toBeNull();
    expect(signal.state).toBe("stalled"); // malformed event treated as no activity, open buyer step present
  });

  it("uses only the valid event when one event of several has a malformed createdAt", () => {
    const events: EngagementEventInput[] = [eventAt(0), { actionType: "link_click", createdAt: "garbage" }];
    const signal = computeEngagementSignal(events, OPEN_BUYER_STEP, NOW, STALL_THRESHOLD_DAYS);
    expect(signal.state).toBe("active");
    expect(signal.lastActivityAt).toBe(NOW.toISOString());
  });
});
