// Sprint 7 · Ticket 36 — T36-5 (plans/sprint-6-7-replan.md §7).
//
// Regression coverage for the forecast-nudge.tsx correction: pre-Ticket-36
// this pill switched to a Signal border/wash whenever engagement was
// "stalled" — a second Signal alongside stall-alert.tsx's call-to-action
// whenever a workspace's CRM strip was also visible. This pill is now
// Slate-only in every engagement state; stall-alert.tsx owns the page's one
// Signal. See stall-alert.tsx's header comment for the full audit.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EngagementSignal } from "@/lib/plans/engagement";
import { ForecastNudge } from "@/app/admin/workspaces/[id]/forecast-nudge";

afterEach(() => {
  cleanup();
});

function makeSignal(overrides: Partial<EngagementSignal> & Pick<EngagementSignal, "state">): EngagementSignal {
  return {
    lastActivityAt: null,
    daysSinceLastActivity: null,
    openBuyerStepCount: 0,
    ...overrides,
  };
}

describe.each([
  ["active", makeSignal({ state: "active", daysSinceLastActivity: 2 })],
  ["waiting", makeSignal({ state: "waiting" })],
  ["stalled", makeSignal({ state: "stalled", openBuyerStepCount: 3 })],
] as const)("ForecastNudge — %s state", (_stateName, signal) => {
  it("carries no Signal-classed element, in any engagement state", () => {
    const { container } = render(<ForecastNudge signal={signal} />);

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tone="signal"]')).toHaveLength(0);
  });

  it("renders a dot next to the text label", () => {
    const { container } = render(<ForecastNudge signal={signal} />);

    expect(container.querySelector(".cfs-nudge-dot")).not.toBeNull();
    expect(container.querySelector(".cfs-nudge")).toHaveTextContent(/.+/);
  });
});

describe("ForecastNudge — labels", () => {
  it("describes a stalled buyer with the open buyer step count", () => {
    render(<ForecastNudge signal={makeSignal({ state: "stalled", openBuyerStepCount: 3 })} />);
    expect(screen.getByText(/Buyer's gone quiet — 3 open buyer steps waiting on them\./)).toBeInTheDocument();
  });

  it("describes an active buyer with recency", () => {
    render(<ForecastNudge signal={makeSignal({ state: "active", daysSinceLastActivity: 0 })} />);
    expect(screen.getByText(/Buyer's engaged — active today\./)).toBeInTheDocument();
  });
});
