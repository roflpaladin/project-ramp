// Sprint 7 · Ticket 36 — T36-5 (plans/sprint-6-7-replan.md §7).
//
// Component-level DOM assertions for the seller-dashboard stall alert
// (app/admin/workspaces/[id]/stall-alert.tsx). Runs under the "components"
// Vitest project (happy-dom) — see vitest.config.ts.
//
// Covers: the "active" quiet state (renders nothing), "waiting" (Slate dot
// + text, no Signal), "stalled" (Slate dot + text, PLUS exactly one
// Signal-classed call-to-action), and a static grep of this component's own
// CSS file for hardcoded hex colours (design system MUST: tokens only).

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EngagementSignal } from "@/lib/plans/engagement";
import { StallAlert } from "@/app/admin/workspaces/[id]/stall-alert";

afterEach(() => {
  cleanup();
});

const PLAN_HREF = "/admin/workspaces/ws-1/plan";

function makeSignal(overrides: Partial<EngagementSignal> & Pick<EngagementSignal, "state">): EngagementSignal {
  return {
    lastActivityAt: null,
    daysSinceLastActivity: null,
    openBuyerStepCount: 0,
    ...overrides,
  };
}

/** Every element carrying the Signal marker — the same greppable-attribute
 *  idiom tests/components/plan-builder-signal-tripwire.dom.spec.tsx uses
 *  (data-live="true" there; data-signal="true" here, matching
 *  components/buyer/buyer-workspace-view.tsx's own data-signal convention). */
function signalMarkedElements(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-signal="true"]'));
}

describe("StallAlert — active state (quiet, no alert)", () => {
  it("renders nothing when the buyer is actively engaged", () => {
    const { container } = render(
      <StallAlert signal={makeSignal({ state: "active", daysSinceLastActivity: 0 })} planHref={PLAN_HREF} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("stall-alert")).not.toBeInTheDocument();
  });
});

describe("StallAlert — waiting state", () => {
  it("renders a Slate dot + text label and carries no Signal element", () => {
    const { container } = render(<StallAlert signal={makeSignal({ state: "waiting" })} planHref={PLAN_HREF} />);

    const alert = screen.getByTestId("stall-alert");
    expect(alert).toHaveAttribute("data-tone", "waiting");
    expect(alert.querySelector("[data-status-dot]")).not.toBeNull();
    expect(screen.getByText("Waiting on you — no open buyer steps right now.")).toBeInTheDocument();

    // No call-to-action, no Signal marker, in the waiting state.
    expect(screen.queryByRole("link", { name: "Review plan" })).not.toBeInTheDocument();
    expect(signalMarkedElements(container)).toHaveLength(0);
  });
});

describe("StallAlert — stalled state", () => {
  it("renders a Slate dot + text label describing the stall", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 2 })}
        planHref={PLAN_HREF}
      />,
    );

    const alert = screen.getByTestId("stall-alert");
    expect(alert).toHaveAttribute("data-tone", "stalled");
    expect(alert.querySelector("[data-status-dot]")).not.toBeNull();
    expect(screen.getByText(/Buyer's gone quiet — 2 open buyer steps waiting on them\./)).toBeInTheDocument();
  });

  it("singularises 'step' for exactly one open buyer step", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 1 })}
        planHref={PLAN_HREF}
      />,
    );

    expect(screen.getByText(/1 open buyer step waiting on them\./)).toBeInTheDocument();
  });

  it("renders exactly one Signal-classed call-to-action, linking to the plan builder", () => {
    const { container } = render(
      <StallAlert signal={makeSignal({ state: "stalled", openBuyerStepCount: 1 })} planHref={PLAN_HREF} />,
    );

    const marked = signalMarkedElements(container);
    expect(marked).toHaveLength(1);

    const cta = screen.getByRole("link", { name: "Review plan" });
    expect(cta).toHaveAttribute("href", PLAN_HREF);
    expect(cta).toHaveAttribute("data-signal", "true");
  });

  it("never marks the state dot itself as the Signal element", () => {
    const { container } = render(
      <StallAlert signal={makeSignal({ state: "stalled", openBuyerStepCount: 1 })} planHref={PLAN_HREF} />,
    );

    const dot = container.querySelector("[data-status-dot]");
    expect(dot).not.toHaveAttribute("data-signal");
  });
});

describe("StallAlert — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/workspaces/[id]/stall-alert.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
