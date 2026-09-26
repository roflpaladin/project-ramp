// Sprint 12, Ticket 60 — who owns the workspace page's ONE Signal?
// (app/admin/workspaces/[id]/workspace-signal-budget.ts)
//
// Pure and DB-free. The design system's hardest colour rule is "exactly one
// Signal element per decision scope", and T60 adds a second candidate to the
// seller dashboard: the deal-limit wall's upgrade CTA, alongside the stall
// alert's "Review plan". Rather than each component guessing, the page
// resolves ownership once, here, and hands each component a boolean.
//
// The stale-page case is the subtle one: the wall can also appear AFTER a
// click, when the server refuses a go-live the page believed was allowed.
// The page cannot predict that, so `canChecklistUseSignal` is deliberately
// false whenever the stall alert is already showing its own CTA — the
// late-arriving wall still renders, still links somewhere useful, just plain.

import { describe, expect, it } from "vitest";

import type { ActivationState } from "@/lib/plans/activation";
import type { EngagementState } from "@/lib/plans/engagement";
import type { DealLimitState } from "@/app/admin/workspaces/[id]/deal-limit-state";
import {
  isDealLimitWallVisible,
  resolveWorkspaceSignalOwners,
} from "@/app/admin/workspaces/[id]/workspace-signal-budget";

const AT_LIMIT: DealLimitState = Object.freeze({
  activeCount: 1,
  maxActiveDeals: 1,
  isAtLimit: true,
  isBlockedFromNewDeals: false,
  isUnknown: false,
});

const PAST_DUE: DealLimitState = Object.freeze({
  activeCount: 0,
  maxActiveDeals: 3,
  isAtLimit: false,
  isBlockedFromNewDeals: true,
  isUnknown: false,
});

const UNKNOWN: DealLimitState = Object.freeze({
  activeCount: null,
  maxActiveDeals: null,
  isAtLimit: false,
  isBlockedFromNewDeals: false,
  isUnknown: true,
});

const WITHIN_LIMIT: DealLimitState = Object.freeze({
  activeCount: 0,
  maxActiveDeals: 3,
  isAtLimit: false,
  isBlockedFromNewDeals: false,
  isUnknown: false,
});

function activation(overrides: Partial<ActivationState["steps"]> = {}): ActivationState {
  const steps = { populated: true, invited: true, live: false, ...overrides };
  return { steps, isComplete: steps.populated && steps.invited && steps.live };
}

interface InputOverrides {
  readonly isChecklistDismissed?: boolean;
  readonly activation?: ActivationState;
  readonly dealLimit?: DealLimitState;
  readonly engagementState?: EngagementState;
}

function makeInput(overrides: InputOverrides = {}) {
  return {
    isChecklistDismissed: false,
    activation: activation(),
    dealLimit: AT_LIMIT,
    engagementState: "waiting" as EngagementState,
    ...overrides,
  };
}

describe("isDealLimitWallVisible", () => {
  it("is visible for a tenant at their cap, on a live checklist card", () => {
    expect(isDealLimitWallVisible(makeInput({ dealLimit: AT_LIMIT }))).toBe(true);
  });

  it("is visible for a past-due tenant", () => {
    expect(isDealLimitWallVisible(makeInput({ dealLimit: PAST_DUE }))).toBe(true);
  });

  it("is NOT visible when billing could not be checked — that notice carries no CTA", () => {
    expect(isDealLimitWallVisible(makeInput({ dealLimit: UNKNOWN }))).toBe(false);
  });

  it("is NOT visible for a tenant with room", () => {
    expect(isDealLimitWallVisible(makeInput({ dealLimit: WITHIN_LIMIT }))).toBe(false);
  });

  it("is NOT visible once the checklist card has been dismissed — the button it replaces is gone too", () => {
    expect(isDealLimitWallVisible(makeInput({ isChecklistDismissed: true }))).toBe(false);
  });

  it("is NOT visible once every activation step is done — the card auto-hides", () => {
    expect(isDealLimitWallVisible(makeInput({ activation: activation({ live: true }) }))).toBe(false);
  });

  it("is NOT visible when the plan is already live — there is no go-live button to replace", () => {
    const almostComplete = { steps: { populated: true, invited: false, live: true }, isComplete: false };

    expect(isDealLimitWallVisible(makeInput({ activation: almostComplete }))).toBe(false);
  });
});

describe("resolveWorkspaceSignalOwners — the wall wins", () => {
  it("gives the Signal to the wall and mutes the stall alert's CTA", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: AT_LIMIT, engagementState: "stalled" }));

    expect(owners).toEqual({ canChecklistUseSignal: true, isStallSignalSuppressed: true, canInviteUseSignal: false });
  });
});

describe("resolveWorkspaceSignalOwners — no wall", () => {
  it("leaves the stall alert's Signal alone and refuses the checklist a Signal it could only double up with", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: WITHIN_LIMIT, engagementState: "stalled" }));

    expect(owners).toEqual({
      canChecklistUseSignal: false,
      isStallSignalSuppressed: false,
      canInviteUseSignal: false,
    });
  });

  it("lets the checklist use the Signal when the stall alert has no CTA of its own", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: WITHIN_LIMIT, engagementState: "waiting" }));

    expect(owners).toEqual({ canChecklistUseSignal: true, isStallSignalSuppressed: false, canInviteUseSignal: true });
  });

  it("lets the checklist use the Signal when the buyer is active (the stall alert renders nothing at all)", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: UNKNOWN, engagementState: "active" }));

    expect(owners).toEqual({ canChecklistUseSignal: true, isStallSignalSuppressed: false, canInviteUseSignal: true });
  });
});

// T60 CRITICAL fix — invite-panel.tsx's post-send "Open buyer view" flip is a
// THIRD candidate for this page's one Signal (it renders independently of
// dealLimit/engagement state, purely from the invite form's own client-side
// result). It is the lowest priority of the three: plain whenever the wall
// or the stall alert's CTA could also be on screen.
describe("resolveWorkspaceSignalOwners — the invite flip is the lowest priority", () => {
  it("refuses the invite flip a Signal whenever the wall is visible", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: AT_LIMIT, engagementState: "waiting" }));

    expect(owners.canInviteUseSignal).toBe(false);
  });

  it("refuses the invite flip a Signal whenever the stall alert's CTA is showing, even with no wall", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: WITHIN_LIMIT, engagementState: "stalled" }));

    expect(owners.canInviteUseSignal).toBe(false);
  });

  it("lets the invite flip use the Signal only when neither the wall nor the stall CTA wants it", () => {
    const owners = resolveWorkspaceSignalOwners(makeInput({ dealLimit: WITHIN_LIMIT, engagementState: "waiting" }));

    expect(owners.canInviteUseSignal).toBe(true);
  });
});

describe("resolveWorkspaceSignalOwners — at most one Signal, for every combination", () => {
  const DEAL_LIMITS: readonly DealLimitState[] = [AT_LIMIT, PAST_DUE, UNKNOWN, WITHIN_LIMIT];
  const ENGAGEMENT_STATES: readonly EngagementState[] = ["active", "waiting", "stalled"];

  for (const dealLimit of DEAL_LIMITS) {
    for (const engagementState of ENGAGEMENT_STATES) {
      for (const isChecklistDismissed of [false, true]) {
        const description = `dealLimit=${JSON.stringify(dealLimit.isAtLimit ? "limit" : dealLimit.isBlockedFromNewDeals ? "past-due" : dealLimit.isUnknown ? "unknown" : "ok")} engagement=${engagementState} dismissed=${isChecklistDismissed}`;

        it(`never lets both the wall and the stall alert claim the Signal (${description})`, () => {
          const input = makeInput({ dealLimit, engagementState, isChecklistDismissed });

          const owners = resolveWorkspaceSignalOwners(input);
          const isWallSignal = isDealLimitWallVisible(input) && owners.canChecklistUseSignal;
          const isStallSignal = engagementState === "stalled" && !owners.isStallSignalSuppressed;

          expect(Number(isWallSignal) + Number(isStallSignal)).toBeLessThanOrEqual(1);
        });

        it(`never lets the invite flip claim the Signal alongside the wall or the stall alert (${description})`, () => {
          const input = makeInput({ dealLimit, engagementState, isChecklistDismissed });

          const owners = resolveWorkspaceSignalOwners(input);
          const isWallSignal = isDealLimitWallVisible(input) && owners.canChecklistUseSignal;
          const isStallSignal = engagementState === "stalled" && !owners.isStallSignalSuppressed;
          const isInviteSignal = owners.canInviteUseSignal;

          expect(Number(isWallSignal) + Number(isStallSignal) + Number(isInviteSignal)).toBeLessThanOrEqual(1);
        });
      }
    }
  }
});
