"use client";

// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". The seller-dashboard
// card that turns the three founder-approved activation steps
// (lib/plans/activation.ts's computeActivationState — populated / invited /
// live) into something the seller can actually act on from this one page.
//
// This component owns its OWN visibility rule ("show only when !dismissedAt
// && !isComplete && plan isn't closed", the last clause added by T60's HIGH
// fix below), rather than the caller deciding whether to mount it at all —
// the alternative (page.tsx conditionally rendering
// `{shouldShow ? <ActivationChecklist .../> : null}`) would move that
// decision out of the one place a test can exercise it directly. `isDismissed`
// and `activation.isComplete` are both plain booleans handed down from
// page.tsx's own reads; this file makes no Supabase call of its own.
//
// Signal budget. Every CTA this file owns directly — the two nav links and
// the "Make it live" button — is plain/secondary styling, never a fifth loud
// colour, exactly as it was in T58. Sprint 12, Ticket 60 adds ONE conditional
// exception: when the tenant is walled, DealLimitNotice takes the go-live
// button's place and its upgrade CTA may carry the page's Signal. It only
// does so when `canUseSignal` says the page has handed it over — see
// workspace-signal-budget.ts, which resolves that once for the whole page so
// this card and StallAlert can never both shout.
//
// The wall locks the go-live button and NOTHING else (founder ruling,
// 2026-09-21): a seller at their limit still builds, invites, edits and
// reads everything.
//
// Both dismissActivationChecklist and markPlanLiveAction return a result
// union rather than throwing (T28-10's contract) — this component still
// wraps each call in try/catch, because a Server Action's network round trip
// itself can reject (e.g. a dropped connection) before the action body ever
// runs. Either failure mode surfaces as the same quiet inline message, never
// an uncaught rejection or a thrown error.

import { useEffect, useRef, useState, useTransition } from "react";
import type { ActivationState, ActivationSteps } from "@/lib/plans/activation";
import { isClosedPlanStatus } from "@/lib/plans/closed-plans";
import type { PlanErrorCode } from "@/lib/plans/mutations";
import type { PlanStatus } from "@/lib/plans/types";
import { dismissActivationChecklist } from "./checklist-actions";
import { DealLimitNotice } from "./deal-limit-notice";
import {
  dealLimitReasonForErrorCode,
  dealLimitReasonForState,
  type DealLimitReason,
  type DealLimitState,
} from "./deal-limit-state";
import { describePlanError } from "./plan/error-messages";
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
  /** T60. Where the tenant stands on active deals — built in page.tsx by deal-limit-state.ts. */
  readonly dealLimit: DealLimitState;
  /** T60. False when another element on this page already holds its one Signal. */
  readonly canUseSignal: boolean;
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

/**
 * A Server Action's network round trip can reject before the action body
 * ever runs, so there is no PlanErrorCode to describe — this is the only
 * message in the card that isn't describePlanError's.
 */
const TRANSPORT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function ActivationChecklist({
  workspaceId,
  plan,
  activation,
  isDismissed,
  planHref,
  dealLimit,
  canUseSignal,
}: ActivationChecklistProps) {
  const [isDismissPending, startDismissTransition] = useTransition();
  const [dismissError, setDismissError] = useState<string | null>(null);

  // T60 HIGH fix. "Make it live" doesn't unmount synchronously with its own
  // click resolving — it unmounts LATER, when the page revalidates and hands
  // this card a new `activation` prop (steps.live: true), which is also the
  // render where renderRowCta's live branch stops returning the button.
  // Watching that prop transition (rather than the local pending state)
  // catches the exact render that would otherwise drop focus to <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasLiveRef = useRef(activation.steps.live);
  useEffect(() => {
    if (!wasLiveRef.current && activation.steps.live) {
      headingRef.current?.focus();
    }
    wasLiveRef.current = activation.steps.live;
  }, [activation.steps.live]);

  const [isMarkLivePending, startMarkLiveTransition] = useTransition();
  const [markLiveError, setMarkLiveError] = useState<string | null>(null);
  // Set only when the SERVER refuses a go-live this page believed was
  // allowed — the page was rendered before another tab took the last seat.
  const [refusedReason, setRefusedReason] = useState<DealLimitReason | null>(null);

  const canMarkLive = plan !== null && plan.status === "draft";

  // The server's answer outranks the page's own read: it is newer.
  const dealLimitReason = refusedReason ?? dealLimitReasonForState(dealLimit);
  const isWalled = dealLimitReason === "limit" || dealLimitReason === "past-due";

  function handleDismiss() {
    setDismissError(null);
    startDismissTransition(async () => {
      try {
        const result = await dismissActivationChecklist(workspaceId);
        if (!result.ok) setDismissError(describePlanError(result.code));
      } catch {
        setDismissError(TRANSPORT_ERROR_MESSAGE);
      }
    });
  }

  /** A billing refusal becomes the notice; everything else stays an inline line. */
  function applyMarkLiveFailure(code: PlanErrorCode) {
    const reason = dealLimitReasonForErrorCode(code);
    setRefusedReason(reason);
    setMarkLiveError(reason === null ? describePlanError(code) : null);
  }

  function handleMarkLive() {
    if (!plan) return;
    setMarkLiveError(null);
    setRefusedReason(null);
    startMarkLiveTransition(async () => {
      try {
        const result = await markPlanLiveAction(workspaceId, plan.id);
        if (!result.ok) applyMarkLiveFailure(result.code);
      } catch {
        setMarkLiveError(TRANSPORT_ERROR_MESSAGE);
      }
    });
  }

  // T60 HIGH fix: a won/lost plan has nothing left to activate — without
  // this, a closed deal kept a permanent, disabled "Make it live" row
  // forever (isComplete can never become true once the plan can no longer
  // go live from here).
  const isClosedPlan = plan !== null && isClosedPlanStatus(plan.status);

  // Auto-hide rule (T58): once dismissed, once every step is satisfied, or
  // once the plan is closed, this card renders nothing at all — hooks above
  // still ran, so their order never changes between renders.
  if (isDismissed || activation.isComplete || isClosedPlan) return null;

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
      // data-walled lets the row give the notice its full width instead of
      // squeezing a paragraph into the button's slot — see the CSS.
      <div className="ac-live-cta" data-walled={isWalled}>
        {isWalled ? null : (
          <button
            type="button"
            className="ac-btn"
            onClick={handleMarkLive}
            disabled={!canMarkLive || isMarkLivePending}
            aria-busy={isMarkLivePending}
          >
            {isMarkLivePending ? "Making it live…" : "Make it live"}
          </button>
        )}
        {dealLimitReason ? (
          <DealLimitNotice
            reason={dealLimitReason}
            activeCount={dealLimit.activeCount}
            maxActiveDeals={dealLimit.maxActiveDeals}
            canUseSignal={canUseSignal}
          />
        ) : null}
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
        {/* tabIndex={-1}: not a tab stop, only a programmatic focus target
            (T60 HIGH fix, see the headingRef effect above). */}
        <h2 ref={headingRef} tabIndex={-1} className="ac-title">
          Get this deal room moving
        </h2>
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
