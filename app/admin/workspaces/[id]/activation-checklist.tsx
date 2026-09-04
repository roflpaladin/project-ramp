"use client";

// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". The seller-dashboard
// card that turns the three founder-approved activation steps
// (lib/plans/activation.ts's computeActivationState — populated / invited /
// live) into something the seller can actually act on from this one page.
//
// This component owns its OWN visibility rule ("show only when !dismissedAt
// && !isComplete", per the ticket), rather than the caller deciding whether
// to mount it at all — the alternative (page.tsx conditionally rendering
// `{shouldShow ? <ActivationChecklist .../> : null}`) would move that
// decision out of the one place a test can exercise it directly. `isDismissed`
// and `activation.isComplete` are both plain booleans handed down from
// page.tsx's own reads; this file makes no Supabase call of its own.
//
// ZERO Signal here (`data-signal="true"` never appears in this file) — the
// page this mounts on (app/admin/workspaces/[id]/page.tsx) already spends its
// one-Signal-per-scope budget on StallAlert's "Review plan" CTA (only in the
// "stalled" state) and InvitePanel's "Send invite"/"Open buyer view" pair (see
// stall-alert.tsx's own audit comment, which this file extends). Every CTA
// below — the two nav links and the "Make it live" button — is plain/
// secondary styling on purpose, never a fifth loud colour.
//
// Both dismissActivationChecklist and markPlanLiveAction return a result
// union rather than throwing (T28-10's contract) — this component still
// wraps each call in try/catch, because a Server Action's network round trip
// itself can reject (e.g. a dropped connection) before the action body ever
// runs. Either failure mode surfaces as the same quiet inline message, never
// an uncaught rejection or a thrown error.

import { useState, useTransition } from "react";
import type { ActivationState, ActivationSteps } from "@/lib/plans/activation";
import type { PlanErrorCode } from "@/lib/plans/mutations";
import type { PlanStatus } from "@/lib/plans/types";
import { dismissActivationChecklist } from "./checklist-actions";
import { markPlanLiveAction } from "./plan/plan-actions";
import "./activation-checklist.css";

/** The slice of the workspace's live plan this card actually needs — never the full PlanTree. */
export interface ActivationChecklistPlanSummary {
  readonly id: string;
  readonly status: PlanStatus;
}

export interface ActivationChecklistProps {
  readonly workspaceId: string;
  /** Null when the workspace has no plan yet — the "make it live" step then has nothing to flip. */
  readonly plan: ActivationChecklistPlanSummary | null;
  readonly activation: ActivationState;
  /** workspace.activation_checklist_dismissed_at !== null, computed by the caller. */
  readonly isDismissed: boolean;
  /** app/admin/workspaces/[id]/plan — same destination as StallAlert's own CTA. */
  readonly planHref: string;
}

interface ChecklistRowSpec {
  readonly key: keyof ActivationSteps;
  readonly pendingLabel: string;
  readonly doneLabel: string;
}

/**
 * Copy per row, per state — the row's own text names both what the step is
 * AND whether it's done, so the dot's colour is never the only signal (design
 * guideline: status is never colour-only).
 */
const CHECKLIST_ROWS: readonly ChecklistRowSpec[] = [
  { key: "populated", pendingLabel: "Add steps to your plan", doneLabel: "Plan steps added" },
  { key: "invited", pendingLabel: "Invite your buyer", doneLabel: "Buyer invited" },
  { key: "live", pendingLabel: "Make the plan live", doneLabel: "Plan is live" },
];

/** Known result codes get a specific, human sentence; anything else falls back to a generic one. */
function describeChecklistError(code: PlanErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "You need to be signed in to do that — try refreshing the page.";
    case "NOT_FOUND":
      return "Couldn't find this workspace or plan — try refreshing the page.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function ActivationChecklist({ workspaceId, plan, activation, isDismissed, planHref }: ActivationChecklistProps) {
  const [isDismissPending, startDismissTransition] = useTransition();
  const [dismissError, setDismissError] = useState<string | null>(null);

  const [isMarkLivePending, startMarkLiveTransition] = useTransition();
  const [markLiveError, setMarkLiveError] = useState<string | null>(null);

  const canMarkLive = plan !== null && plan.status === "draft";

  function handleDismiss() {
    setDismissError(null);
    startDismissTransition(async () => {
      try {
        const result = await dismissActivationChecklist(workspaceId);
        if (!result.ok) setDismissError(describeChecklistError(result.code));
      } catch {
        setDismissError("Something went wrong. Please try again.");
      }
    });
  }

  function handleMarkLive() {
    if (!plan) return;
    setMarkLiveError(null);
    startMarkLiveTransition(async () => {
      try {
        const result = await markPlanLiveAction(workspaceId, plan.id);
        if (!result.ok) setMarkLiveError(describeChecklistError(result.code));
      } catch {
        setMarkLiveError("Something went wrong. Please try again.");
      }
    });
  }

  // Auto-hide rule (T58): once dismissed, or once every step is satisfied,
  // this card renders nothing at all — hooks above still ran, so their order
  // never changes between renders.
  if (isDismissed || activation.isComplete) return null;

  function renderRowCta(key: keyof ActivationSteps) {
    if (key === "populated") {
      return (
        <a href={planHref} className="ac-link">
          Open plan builder
        </a>
      );
    }
    if (key === "invited") {
      return (
        <a href="#invite-panel" className="ac-link">
          Open invite panel
        </a>
      );
    }
    // key === "live" — once live, no button: the row's own text already says so.
    if (activation.steps.live) return null;
    return (
      <div className="ac-live-cta">
        <button
          type="button"
          className="ac-btn"
          onClick={handleMarkLive}
          disabled={!canMarkLive || isMarkLivePending}
          aria-busy={isMarkLivePending}
        >
          {isMarkLivePending ? "Making it live…" : "Make it live"}
        </button>
        {markLiveError ? (
          <p className="ac-inline-error" role="alert">
            {markLiveError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="ac-card" data-surface="activation-checklist" data-testid="activation-checklist">
      <div className="ac-header">
        <h2 className="ac-title">Get this deal room moving</h2>
        <button
          type="button"
          className="ac-dismiss"
          onClick={handleDismiss}
          disabled={isDismissPending}
          aria-busy={isDismissPending}
        >
          {isDismissPending ? "Dismissing…" : "Dismiss"}
        </button>
      </div>

      <ul className="ac-list">
        {CHECKLIST_ROWS.map((row) => {
          const done = activation.steps[row.key];
          const tone = done ? "done" : "wait";
          const text = done ? row.doneLabel : row.pendingLabel;

          return (
            <li key={row.key} className="ac-row" data-tone={tone} data-testid={`ac-row-${row.key}`}>
              <span className="ac-row-status">
                <span className="ac-dot" data-status-dot="" aria-hidden="true" />
                <span className="ac-row-text">{text}</span>
              </span>
              {renderRowCta(row.key)}
            </li>
          );
        })}
      </ul>

      {dismissError ? (
        <p className="ac-inline-error" role="alert">
          {dismissError}
        </p>
      ) : null}
    </section>
  );
}
