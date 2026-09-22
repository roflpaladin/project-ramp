// Sprint 12, Ticket 60 — who owns the workspace page's ONE Signal?
//
// PURE. The design system's hardest colour rule is "exactly one Signal
// element per decision scope" (a page counts as one scope), and T60 adds a
// second candidate to the seller dashboard: the deal-limit wall's upgrade
// CTA in the activation checklist, alongside stall-alert.tsx's long-standing
// "Review plan". Founder/orchestrator ruling: when the wall shows, the wall
// takes the Signal and the stall alert drops to plain.
//
// Resolved here, once, by page.tsx — rather than by each component guessing
// what its siblings are doing. Both components then take a plain boolean,
// which is also what makes the invariant assertable in a component test.
//
// The awkward case this file handles on purpose: the wall can ALSO appear
// after a click, when the server refuses a go-live this page believed was
// allowed (the page was rendered before another tab used the last seat). No
// server render can predict that, so `canChecklistUseSignal` is false
// whenever the stall alert is already showing its own CTA — the
// late-arriving wall still renders and still links somewhere useful, it
// just doesn't shout over a Signal that is already on screen.
//
// Post-launch review (CRITICAL fix): invite-panel.tsx's post-send "Open
// buyer view" flip button is a THIRD candidate — it renders purely from the
// invite form's own client-side result (own-inbox send succeeded), entirely
// independent of dealLimit/engagement state, so it could appear alongside
// either of the other two. It gets the LOWEST priority of the three:
// `canInviteUseSignal` is true only when NEITHER the wall NOR the stall
// alert's CTA could be on screen. The invite panel's ordinary "Send invite"
// button never carries Signal at all any more (see invite-panel.tsx) — only
// the flip is ever conditional.

import type { ActivationState } from "@/lib/plans/activation";
import type { EngagementState } from "@/lib/plans/engagement";
import { dealLimitReasonForState, type DealLimitState } from "./deal-limit-state";

export interface WorkspaceSignalInput {
  /** workspace.activation_checklist_dismissed_at !== null. */
  readonly isChecklistDismissed: boolean;
  readonly activation: ActivationState;
  readonly dealLimit: DealLimitState;
  readonly engagementState: EngagementState;
}

export interface WorkspaceSignalOwners {
  /** The activation checklist's deal-limit notice may render its CTA as Signal. */
  readonly canChecklistUseSignal: boolean;
  /** The stall alert renders "Review plan" as a plain link instead of Signal. */
  readonly isStallSignalSuppressed: boolean;
  /**
   * T60 CRITICAL fix. invite-panel.tsx's post-send "Open buyer view" flip
   * button may render as Signal only when this is true — the lowest
   * priority of the page's three candidates (see this file's header
   * comment).
   */
  readonly canInviteUseSignal: boolean;
}

/**
 * Mirrors activation-checklist.tsx's own render rules — the card hides itself
 * once dismissed or complete, and the "live" row drops its CTA entirely once
 * the plan is live. No button, no wall.
 *
 * The `unknown` reason is not a wall: its notice carries no CTA at all (we
 * could not check, so we have nothing to sell), and the go-live button stays
 * enabled behind it.
 */
export function isDealLimitWallVisible(input: WorkspaceSignalInput): boolean {
  if (input.isChecklistDismissed || input.activation.isComplete) return false;
  if (input.activation.steps.live) return false;

  const reason = dealLimitReasonForState(input.dealLimit);
  return reason === "limit" || reason === "past-due";
}

export function resolveWorkspaceSignalOwners(input: WorkspaceSignalInput): WorkspaceSignalOwners {
  const isWallVisible = isDealLimitWallVisible(input);
  // stall-alert.tsx renders its CTA in the "stalled" state and nowhere else.
  const isStallCtaVisible = input.engagementState === "stalled";

  return Object.freeze({
    canChecklistUseSignal: isWallVisible || !isStallCtaVisible,
    isStallSignalSuppressed: isWallVisible,
    canInviteUseSignal: !isWallVisible && !isStallCtaVisible,
  });
}
