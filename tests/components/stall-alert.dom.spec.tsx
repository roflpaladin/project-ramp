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
//
// Sprint 12, Ticket 60 adds two things to this same alert rather than a
// second banner: the quiet-deal line (a buyer who hasn't opened the room in
// QUIET_DEAL_DAYS, plus a plain link to where "Close deal" lives), and
// `isSignalSuppressed` — the prop the workspace page sets when the
// deal-limit wall above has taken the page's one Signal.

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

describe("StallAlert — handing the Signal to the deal-limit wall (T60)", () => {
  it("renders 'Review plan' as a plain link, still linked, when the Signal is suppressed", () => {
    // Arrange / Act
    const { container } = render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 1 })}
        planHref={PLAN_HREF}
        isSignalSuppressed
      />,
    );

    // Assert
    const cta = screen.getByRole("link", { name: "Review plan" });
    expect(cta).toHaveAttribute("href", PLAN_HREF);
    expect(cta).not.toHaveAttribute("data-signal");
    expect(signalMarkedElements(container)).toHaveLength(0);
  });

  it("keeps its Signal by default, so nothing changes for a page with no wall", () => {
    const { container } = render(
      <StallAlert signal={makeSignal({ state: "stalled", openBuyerStepCount: 1 })} planHref={PLAN_HREF} />,
    );

    expect(signalMarkedElements(container)).toHaveLength(1);
  });
});

describe("StallAlert — the quiet-deal line (T60)", () => {
  it("adds a plain line naming the buyer's silence in days, with a link to where the deal is closed", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 1, daysSinceLastActivity: 21 })}
        planHref={PLAN_HREF}
      />,
    );

    const note = screen.getByTestId("quiet-deal-note");
    expect(note).toHaveTextContent(
      "Your buyer hasn't opened this in 21 days. If the deal is finished, close it to free a slot.",
    );

    const link = screen.getByRole("link", { name: "Close this deal" });
    expect(link).toHaveAttribute("href", PLAN_HREF);
    expect(link).not.toHaveAttribute("data-signal");
  });

  it("adds the same line in the waiting state — it is buyer silence, not open buyer steps, that triggers it", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "waiting", daysSinceLastActivity: 30 })}
        planHref={PLAN_HREF}
      />,
    );

    expect(screen.getByTestId("quiet-deal-note")).toHaveTextContent("hasn't opened this in 30 days");
  });

  it("stays silent below the threshold", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 1, daysSinceLastActivity: 13 })}
        planHref={PLAN_HREF}
      />,
    );

    expect(screen.queryByTestId("quiet-deal-note")).not.toBeInTheDocument();
  });

  it("stays silent for a buyer who has never opened the room — there is no 'in N days' to state", () => {
    render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 2, daysSinceLastActivity: null })}
        planHref={PLAN_HREF}
      />,
    );

    expect(screen.queryByTestId("quiet-deal-note")).not.toBeInTheDocument();
    // The ordinary stall copy still carries the state.
    expect(screen.getByText(/Buyer's gone quiet — 2 open buyer steps waiting on them\./)).toBeInTheDocument();
  });

  it("never adds a second Signal alongside 'Review plan'", () => {
    const { container } = render(
      <StallAlert
        signal={makeSignal({ state: "stalled", openBuyerStepCount: 1, daysSinceLastActivity: 40 })}
        planHref={PLAN_HREF}
      />,
    );

    expect(signalMarkedElements(container)).toHaveLength(1);
  });
});

describe("StallAlert — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/workspaces/[id]/stall-alert.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
