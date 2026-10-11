"use client";

// Founder ruling (2026-10-11): "Close deal" also lives at the TOP of the
// deal's main page, not only at the foot of the plan builder.
//
// This is a thin client wrapper so the Server Component page can reuse
// CloseDealControls and its Server Action unchanged. It owns only two things
// the page cannot: the visibility rule and the post-close focus hand-off.
//
// Visibility copies plan-builder.tsx exactly: shown for any plan that is not
// closed (CloseDealControls itself returns null for won/lost), and nothing
// when the workspace has no plan. A closed deal's state is already stated by
// the page's StatusBadge, so no dead button is rendered here.
//
// ZERO Signal: closing a deal is not the page's next move. The page's one
// Signal is resolved by workspace-signal-budget.ts and never lands here.

import type { PlanStatus } from "@/lib/plans/types";
import { isClosedPlanStatus } from "@/lib/plans/closed-plans";
import { CloseDealControls } from "./plan/close-deal-controls";

import { CLOSE_DEAL_ANCHOR_ID, WORKSPACE_TITLE_ID } from "./workspace-close-deal-ids";

export interface WorkspaceCloseDealProps {
  readonly workspaceId: string;
  readonly plan: { readonly id: string; readonly status: PlanStatus } | null;
}

export function WorkspaceCloseDeal({ workspaceId, plan }: WorkspaceCloseDealProps) {
  if (!plan || isClosedPlanStatus(plan.status)) return null;

  // T60 HIGH-fix mirror: the confirm button unmounts once the page
  // re-renders as closed, so focus goes to the title, which renders in
  // every state.
  return (
    <div className="wsl-close-deal">
      <CloseDealControls
        workspaceId={workspaceId}
        planId={plan.id}
        planStatus={plan.status}
        summaryId={CLOSE_DEAL_ANCHOR_ID}
        onClosed={() => document.getElementById(WORKSPACE_TITLE_ID)?.focus()}
      />
    </div>
  );
}
