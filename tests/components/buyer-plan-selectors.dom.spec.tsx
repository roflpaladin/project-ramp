// Sprint 7, Ticket 33 (plans/sprint-6-7-replan.md §7). Pure-logic tests for
// components/buyer/plan-selectors.ts — no DOM APIs needed, but kept under
// the "components" Vitest project (happy-dom, no Supabase env required) via
// the .dom.spec.tsx naming, mirroring T29's plan-tree-utils.dom.spec.tsx,
// which does the same for plan-tree-utils.ts's equally DOM-free logic.

import { describe, expect, it } from "vitest";
import type { BuyerPlan, BuyerStage, BuyerStep } from "@/lib/portal-payload";
import {
  buildCommitteeInviteHref,
  collectBlockedSteps,
  collectOverdueBuyerSteps,
  computeRunway,
  findCurrentStage,
  findNextOpenStep,
  formatPlanDate,
  ownerSideLabel,
  stageStatusLabel,
  stageTone,
  stepStatusLabel,
  stepTone,
} from "@/components/buyer/plan-selectors";

function makeStep(overrides: Partial<BuyerStep> & Pick<BuyerStep, "id" | "label">): BuyerStep {
  return {
    owner_side: "seller",
    owner_name: null,
    due_date: null,
    status: "open",
    display_order: 0,
    completed_at: null,
    ...overrides,
  };
}

function makeStage(overrides: Partial<BuyerStage> & Pick<BuyerStage, "id" | "title">): BuyerStage {
  return {
    display_order: 0,
    status: "upcoming",
    steps: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<BuyerPlan> = {}): BuyerPlan {
  return {
    id: "plan-1",
    title: "Onboarding",
    start_date: null,
    target_date: null,
    status: "active",
    stages: [],
    ...overrides,
  };
}

describe("findNextOpenStep", () => {
  it("returns the first open step in plan order, skipping done and blocked", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [
            makeStep({ id: "st1", label: "Send contract", status: "done" }),
            makeStep({ id: "st2", label: "Blocked thing", status: "blocked" }),
          ],
        }),
        makeStage({
          id: "s2",
          title: "Rollout",
          steps: [makeStep({ id: "st3", label: "Schedule kickoff", status: "open" })],
        }),
      ],
    });

    const result = findNextOpenStep(plan);
    expect(result?.step.id).toBe("st3");
    expect(result?.stage.id).toBe("s2");
  });

  it("returns null when every step is done or blocked", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [
            makeStep({ id: "st1", label: "Done thing", status: "done" }),
            makeStep({ id: "st2", label: "Stuck thing", status: "blocked" }),
          ],
        }),
      ],
    });
    expect(findNextOpenStep(plan)).toBeNull();
  });

  it("returns null for a plan with no stages", () => {
    expect(findNextOpenStep(makePlan())).toBeNull();
  });
});

describe("findCurrentStage", () => {
  it("returns the stage whose status is 'current'", () => {
    const plan = makePlan({
      stages: [
        makeStage({ id: "s1", title: "Kickoff", status: "done" }),
        makeStage({ id: "s2", title: "Rollout", status: "current" }),
        makeStage({ id: "s3", title: "Close", status: "upcoming" }),
      ],
    });
    expect(findCurrentStage(plan)?.id).toBe("s2");
  });

  it("returns null when no stage is marked current", () => {
    const plan = makePlan({ stages: [makeStage({ id: "s1", title: "Kickoff", status: "upcoming" })] });
    expect(findCurrentStage(plan)).toBeNull();
  });
});

describe("collectBlockedSteps", () => {
  it("collects every blocked step across stages, in order", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [makeStep({ id: "st1", label: "Legal review", status: "blocked" })],
        }),
        makeStage({
          id: "s2",
          title: "Rollout",
          steps: [
            makeStep({ id: "st2", label: "Open thing", status: "open" }),
            makeStep({ id: "st3", label: "Security sign-off", status: "blocked" }),
          ],
        }),
      ],
    });
    const blocked = collectBlockedSteps(plan);
    expect(blocked.map((b) => b.step.id)).toEqual(["st1", "st3"]);
  });

  it("returns an empty array when nothing is blocked", () => {
    const plan = makePlan({
      stages: [makeStage({ id: "s1", title: "Kickoff", steps: [makeStep({ id: "st1", label: "x", status: "open" })] })],
    });
    expect(collectBlockedSteps(plan)).toEqual([]);
  });
});

describe("collectOverdueBuyerSteps", () => {
  const now = new Date("2026-08-14T12:00:00Z");

  it("flags a buyer-owned open step whose due date is in the past", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [makeStep({ id: "st1", label: "Provide SSO config", owner_side: "buyer", status: "open", due_date: "2026-08-01" })],
        }),
      ],
    });
    expect(collectOverdueBuyerSteps(plan, now).map((b) => b.step.id)).toEqual(["st1"]);
  });

  it("does not flag a step due later today", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [makeStep({ id: "st1", label: "x", owner_side: "buyer", status: "open", due_date: "2026-08-14" })],
        }),
      ],
    });
    expect(collectOverdueBuyerSteps(plan, now)).toEqual([]);
  });

  it("ignores overdue seller-owned steps — only buyer-owned surfaces here", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [makeStep({ id: "st1", label: "x", owner_side: "seller", status: "open", due_date: "2026-01-01" })],
        }),
      ],
    });
    expect(collectOverdueBuyerSteps(plan, now)).toEqual([]);
  });

  it("ignores a buyer-owned step that is already done, even if its due date has passed", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "s1",
          title: "Kickoff",
          steps: [
            makeStep({
              id: "st1",
              label: "x",
              owner_side: "buyer",
              status: "done",
              due_date: "2026-01-01",
              completed_at: "2026-01-02T00:00:00+00:00",
            }),
          ],
        }),
      ],
    });
    expect(collectOverdueBuyerSteps(plan, now)).toEqual([]);
  });
});

describe("computeRunway", () => {
  it("returns null when start_date is missing", () => {
    const plan = makePlan({ start_date: null, target_date: "2026-09-01" });
    expect(computeRunway(plan, new Date())).toBeNull();
  });

  it("returns null when target_date is missing", () => {
    const plan = makePlan({ start_date: "2026-08-01", target_date: null });
    expect(computeRunway(plan, new Date())).toBeNull();
  });

  it("returns null when both dates are missing", () => {
    const plan = makePlan({ start_date: null, target_date: null });
    expect(computeRunway(plan, new Date())).toBeNull();
  });

  it("computes day index, total days and percent at the midpoint", () => {
    const plan = makePlan({ start_date: "2026-08-01", target_date: "2026-08-11" });
    const runway = computeRunway(plan, new Date("2026-08-06T00:00:00Z"));
    expect(runway).not.toBeNull();
    expect(runway?.totalDays).toBe(11);
    expect(runway?.dayIndex).toBe(6);
    expect(runway?.percent).toBeCloseTo(50, 0);
  });

  it("clamps day index to 1 when today is before the start date", () => {
    const plan = makePlan({ start_date: "2026-08-10", target_date: "2026-08-20" });
    const runway = computeRunway(plan, new Date("2026-08-01T00:00:00Z"));
    expect(runway?.dayIndex).toBe(1);
    expect(runway?.percent).toBe(0);
  });

  it("clamps day index to totalDays when today is after the target date", () => {
    const plan = makePlan({ start_date: "2026-08-01", target_date: "2026-08-05" });
    const runway = computeRunway(plan, new Date("2026-09-01T00:00:00Z"));
    expect(runway?.dayIndex).toBe(5);
    expect(runway?.percent).toBe(100);
  });

  it("handles start_date === target_date without dividing by zero", () => {
    const plan = makePlan({ start_date: "2026-08-10", target_date: "2026-08-10" });
    const runway = computeRunway(plan, new Date("2026-08-10T00:00:00Z"));
    expect(runway?.totalDays).toBe(1);
    expect(runway?.dayIndex).toBe(1);
    expect(Number.isFinite(runway?.percent)).toBe(true);
  });

  it("returns null rather than a broken result for an unparsable date", () => {
    const plan = makePlan({ start_date: "not-a-date", target_date: "2026-08-20" });
    expect(computeRunway(plan, new Date())).toBeNull();
  });
});

describe("formatPlanDate", () => {
  it("formats a valid YYYY-MM-DD date for display", () => {
    expect(formatPlanDate("2026-08-14")).toBe("Aug 14, 2026");
  });

  it("falls back to the raw string rather than throwing on malformed input", () => {
    expect(formatPlanDate("garbage")).toBe("garbage");
  });
});

describe("status tone / label mapping", () => {
  it("maps step statuses to the correct tone (never colour-only, but tone drives it)", () => {
    expect(stepTone("done")).toBe("done");
    expect(stepTone("blocked")).toBe("risk");
    expect(stepTone("open")).toBe("wait");
  });

  it("maps step statuses to sentence-case labels", () => {
    expect(stepStatusLabel("done")).toBe("Done");
    expect(stepStatusLabel("blocked")).toBe("Blocked");
    expect(stepStatusLabel("open")).toBe("Open");
  });

  it("only 'done' speaks for stages — 'current' and 'upcoming' stay in the waiting tone", () => {
    expect(stageTone("done")).toBe("done");
    expect(stageTone("current")).toBe("wait");
    expect(stageTone("upcoming")).toBe("wait");
  });

  it("maps stage statuses to sentence-case labels", () => {
    expect(stageStatusLabel("done")).toBe("Done");
    expect(stageStatusLabel("current")).toBe("In progress");
    expect(stageStatusLabel("upcoming")).toBe("Upcoming");
  });
});

describe("ownerSideLabel", () => {
  it("labels a seller-owned step 'Seller'", () => {
    expect(ownerSideLabel(makeStep({ id: "st1", label: "x", owner_side: "seller" }))).toBe("Seller");
  });

  it("labels a buyer-owned step 'Buyer'", () => {
    expect(ownerSideLabel(makeStep({ id: "st1", label: "x", owner_side: "buyer" }))).toBe("Buyer");
  });
});

describe("buildCommitteeInviteHref", () => {
  it("builds a mailto: href carrying the target company name in the subject", () => {
    const href = buildCommitteeInviteHref("Acme Corp");
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Acme Corp");
  });
});
