// Sprint 11, Ticket 58 — "In-App Onboarding Checklist".
//
// PURE FUNCTION. Zero I/O, no Supabase import, no Next.js import — mirrors
// lib/plans/engagement.ts's contract exactly (data injected, nothing
// resolved internally), for the same reason: this is a pure decision the
// caller's own reads feed, so the tests below can assert every branch
// deterministically without a database.
//
// Founder-approved decisions this module encodes literally, not by inference:
//   - "populated" = a live plan exists AND at least one of its stages has at
//     least one step. A plan record with zero steps is not "populated" —
//     nothing has actually been built into it yet.
//   - "invited"   = at least one buyer invite has ever been SENT for this
//     workspace (lib/plans/invite-status.ts's hasSentInviteForWorkspace).
//     Whether that invite is still valid, expired, or already consumed is
//     irrelevant to this step — "did the seller take the invite action" is
//     the question, not "is a buyer currently signed in".
//   - "live"      = success_plans.status === 'active'. A 'draft' plan (still
//     being built) or a closed 'won'/'lost' plan are both NOT "live" for this
//     checklist's purposes.
//   - isComplete  = all three. The checklist auto-hides on this, per the
//     founder's "auto-hide when complete" ruling — that hide decision itself
//     lives with the caller (a Server Component reading isComplete plus the
//     workspaces.activation_checklist_dismissed_at column), not here.

import type { PlanTree } from "./types";

export interface ActivationSteps {
  readonly populated: boolean;
  readonly invited: boolean;
  readonly live: boolean;
}

export interface ActivationState {
  readonly steps: ActivationSteps;
  readonly isComplete: boolean;
}

export interface ComputeActivationStateInput {
  /** The workspace's live plan tree (lib/plans/queries.ts's getPlanForSeller), or null if none exists yet. */
  readonly plan: PlanTree | null;
  /** Whether a buyer invite has ever been sent for this workspace — see the module header. */
  readonly hasSentInvite: boolean;
}

/** True when at least one stage carries at least one step. */
function hasAnyStep(plan: PlanTree): boolean {
  return plan.stages.some((stage) => stage.steps.length > 0);
}

export function computeActivationState(input: ComputeActivationStateInput): ActivationState {
  const { plan, hasSentInvite } = input;

  const steps: ActivationSteps = {
    populated: plan !== null && hasAnyStep(plan),
    invited: hasSentInvite,
    live: plan?.status === "active",
  };

  const isComplete = steps.populated && steps.invited && steps.live;

  return { steps, isComplete };
}
