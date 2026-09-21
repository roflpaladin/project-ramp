// Sprint 12, Ticket 60 — the workspace dashboard renders at most ONE Signal.
//
// The design system's hardest colour rule ("exactly one Signal element per
// decision scope") gained a second candidate this ticket: the deal-limit
// wall's upgrade CTA, alongside stall-alert.tsx's "Review plan". This file
// renders the two components TOGETHER, wired exactly as
// app/admin/workspaces/[id]/page.tsx wires them — through
// resolveWorkspaceSignalOwners, the one function that decides ownership —
// and counts `[data-signal="true"]` across the whole tree for every
// combination of deal-limit state and engagement state.
//
// It deliberately does NOT re-implement page.tsx's wiring: the harness below
// calls the same resolver the page does, so a change to that rule is caught
// here rather than silently agreed with. (page.tsx itself is a Server
// Component doing five Supabase reads; the two components it composes are
// what carry Signal, and they are what this file mounts.)
//
// Runs under the "components" Vitest project (happy-dom). DB-free: the two
// "use server" modules the checklist imports are mocked wholesale.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ActivationState } from "@/lib/plans/activation";
import type { EngagementSignal, EngagementState } from "@/lib/plans/engagement";
import type { DealLimitState } from "@/app/admin/workspaces/[id]/deal-limit-state";

const { mockMarkPlanLiveAction } = vi.hoisted(() => ({ mockMarkPlanLiveAction: vi.fn() }));

vi.mock("@/app/admin/workspaces/[id]/checklist-actions", () => ({ dismissActivationChecklist: vi.fn() }));
vi.mock("@/app/admin/workspaces/[id]/plan/plan-actions", () => ({ markPlanLiveAction: mockMarkPlanLiveAction }));

const { ActivationChecklist } = await import("@/app/admin/workspaces/[id]/activation-checklist");
const { StallAlert } = await import("@/app/admin/workspaces/[id]/stall-alert");
const { resolveWorkspaceSignalOwners } = await import("@/app/admin/workspaces/[id]/workspace-signal-budget");

afterEach(() => {
  cleanup();
  mockMarkPlanLiveAction.mockReset();
});

const WORKSPACE_ID = "ws-1";
const PLAN_HREF = `/admin/workspaces/${WORKSPACE_ID}/plan`;

const DEAL_LIMITS: Readonly<Record<string, DealLimitState>> = {
  ok: { activeCount: 0, maxActiveDeals: 3, isAtLimit: false, isBlockedFromNewDeals: false, isUnknown: false },
  limit: { activeCount: 3, maxActiveDeals: 3, isAtLimit: true, isBlockedFromNewDeals: false, isUnknown: false },
  "past-due": { activeCount: 1, maxActiveDeals: 3, isAtLimit: false, isBlockedFromNewDeals: true, isUnknown: false },
  unknown: { activeCount: null, maxActiveDeals: null, isAtLimit: false, isBlockedFromNewDeals: false, isUnknown: true },
};

const ENGAGEMENT_STATES: readonly EngagementState[] = ["active", "waiting", "stalled"];

function makeActivation(overrides: Partial<ActivationState["steps"]> = {}): ActivationState {
  const steps = { populated: true, invited: true, live: false, ...overrides };
  return { steps, isComplete: steps.populated && steps.invited && steps.live };
}

function makeSignal(state: EngagementState): EngagementSignal {
  return {
    state,
    lastActivityAt: null,
    daysSinceLastActivity: state === "active" ? 0 : 30,
    openBuyerStepCount: state === "stalled" ? 1 : 0,
  };
}

interface HarnessProps {
  readonly dealLimit: DealLimitState;
  readonly engagementState: EngagementState;
  readonly activation?: ActivationState;
  readonly isChecklistDismissed?: boolean;
}

/**
 * The two Signal-bearing components of the workspace page, composed and
 * wired the way page.tsx wires them.
 */
function WorkspaceSignalHarness({
  dealLimit,
  engagementState,
  activation = makeActivation(),
  isChecklistDismissed = false,
}: HarnessProps) {
  const owners = resolveWorkspaceSignalOwners({ isChecklistDismissed, activation, dealLimit, engagementState });

  return (
    <>
      <ActivationChecklist
        workspaceId={WORKSPACE_ID}
        plan={{ id: "plan-1", status: "draft" }}
        activation={activation}
        isDismissed={isChecklistDismissed}
        planHref={PLAN_HREF}
        dealLimit={dealLimit}
        canUseSignal={owners.canChecklistUseSignal}
      />
      <StallAlert
        signal={makeSignal(engagementState)}
        planHref={PLAN_HREF}
        isSignalSuppressed={owners.isStallSignalSuppressed}
      />
    </>
  );
}

function countSignals(container: HTMLElement): number {
  return container.querySelectorAll('[data-signal="true"]').length;
}

describe("Workspace dashboard — never two Signals at once", () => {
  for (const [name, dealLimit] of Object.entries(DEAL_LIMITS)) {
    for (const engagementState of ENGAGEMENT_STATES) {
      for (const isChecklistDismissed of [false, true]) {
        it(`renders at most one Signal (dealLimit=${name}, engagement=${engagementState}, dismissed=${isChecklistDismissed})`, () => {
          const { container } = render(
            <WorkspaceSignalHarness
              dealLimit={dealLimit}
              engagementState={engagementState}
              isChecklistDismissed={isChecklistDismissed}
            />,
          );

          expect(countSignals(container)).toBeLessThanOrEqual(1);
        });
      }
    }
  }
});

describe("Workspace dashboard — the hand-off itself", () => {
  it("gives the Signal to the wall, not the stall alert, when both want it", () => {
    // Arrange / Act
    const { container } = render(
      <WorkspaceSignalHarness dealLimit={DEAL_LIMITS.limit} engagementState="stalled" />,
    );

    // Assert
    expect(countSignals(container)).toBe(1);
    const signal = container.querySelector('[data-signal="true"]');
    expect(signal).toHaveAttribute("href", "/pricing");
  });

  it("leaves the Signal on the stall alert when there is no wall", () => {
    const { container } = render(<WorkspaceSignalHarness dealLimit={DEAL_LIMITS.ok} engagementState="stalled" />);

    expect(countSignals(container)).toBe(1);
    expect(container.querySelector('[data-signal="true"]')).toHaveAttribute("href", PLAN_HREF);
  });

  it("keeps the stall alert's CTA on the page, plain, while the wall shouts", () => {
    const { container } = render(
      <WorkspaceSignalHarness dealLimit={DEAL_LIMITS["past-due"]} engagementState="stalled" />,
    );

    const reviewPlan = container.querySelector(".wsa-cta");
    expect(reviewPlan).not.toBeNull();
    expect(reviewPlan).not.toHaveAttribute("data-signal");
  });

  it("gives the Signal to nobody when neither has anything to say", () => {
    const { container } = render(<WorkspaceSignalHarness dealLimit={DEAL_LIMITS.ok} engagementState="waiting" />);

    expect(countSignals(container)).toBe(0);
  });

  it("stays at one Signal when a STALE page is refused mid-click and a wall appears late", async () => {
    // The page was rendered while the tenant still had room, so it handed
    // the Signal to the stall alert. Another tab then took the last seat.
    // The wall that arrives with the server's refusal must not shout over a
    // Signal that is already on screen.
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "DEAL_LIMIT_REACHED" });

    const { container } = render(<WorkspaceSignalHarness dealLimit={DEAL_LIMITS.ok} engagementState="stalled" />);
    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    await screen.findByTestId("deal-limit-notice");

    expect(countSignals(container)).toBe(1);
    // The one Signal is still the stall alert's; the wall links plainly.
    expect(container.querySelector('[data-signal="true"]')).toHaveAttribute("href", PLAN_HREF);
    expect(screen.getByRole("link", { name: "See plans" })).not.toHaveAttribute("data-signal");
  });

  it("gives the late wall the Signal when nothing else is holding it", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "DEAL_LIMIT_REACHED" });

    const { container } = render(<WorkspaceSignalHarness dealLimit={DEAL_LIMITS.ok} engagementState="waiting" />);
    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    await screen.findByTestId("deal-limit-notice");

    expect(countSignals(container)).toBe(1);
    expect(container.querySelector('[data-signal="true"]')).toHaveAttribute("href", "/pricing");
  });

  it("raises no wall — and no Signal — once the plan is live", () => {
    const { container } = render(
      <WorkspaceSignalHarness
        dealLimit={DEAL_LIMITS.limit}
        engagementState="stalled"
        activation={makeActivation({ live: true })}
      />,
    );

    expect(countSignals(container)).toBe(1);
    // The complete checklist auto-hides, so the one Signal left is the stall alert's.
    expect(container.querySelector('[data-signal="true"]')).toHaveAttribute("href", PLAN_HREF);
  });
});
