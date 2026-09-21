"use client";

// Sprint 12, Ticket 60 — "Close deal".
//
// Founder ruling (2026-09-21): won and lost behave identically. Closing
// deletes nothing, keeps the plan visible to the seller read-only with its
// outcome, and frees an active-deal seat. That makes this a small, quiet,
// reversible-sounding control — not a destructive one — so it is a
// disclosure the seller opens deliberately, never a button sitting in the
// page's main flow.
//
// ZERO Signal here (`data-signal="true"` never appears in this file). The
// plan builder's one Signal is the live step's wash + rail (step-row.tsx),
// and closing a deal is not the page's next move — it is a decision the
// seller brings with them.
//
// The confirm step is IN the disclosure, never window.confirm(): a native
// dialog is unstyleable, unthemeable (it would ignore both our themes), and
// says nothing about what closing actually does. Here the confirmation is
// the explanation.
//
// closePlanAction returns a result union rather than throwing (T28-10's
// contract), but the Server Action round trip itself can still reject before
// the body runs — both paths land in the same quiet inline message.

import { useEffect, useRef, useState, useTransition } from "react";

import type { ClosedPlanStatus } from "@/lib/plans/closed-plans";
import { isClosedPlanStatus } from "@/lib/plans/closed-plans";
import type { PlanStatus } from "@/lib/plans/types";
import { describePlanError } from "./error-messages";
import { closePlanAction } from "./plan-actions";
import "./close-deal-controls.css";

export interface CloseDealControlsProps {
  readonly workspaceId: string;
  readonly planId: string;
  readonly planStatus: PlanStatus;
}

interface OutcomeCopy {
  /** The first-step button: the word the seller picks. */
  readonly choiceLabel: string;
  /** The confirm button — keeps that same word, per the design system's button rule. */
  readonly confirmLabel: string;
  readonly confirmBody: string;
}

const OUTCOME_COPY: Record<ClosedPlanStatus, OutcomeCopy> = {
  won: {
    choiceLabel: "Won",
    confirmLabel: "Close as won",
    confirmBody:
      "Closing as won makes this plan read-only and frees a slot on your plan. Nothing is deleted — you and your buyer keep everything you built.",
  },
  lost: {
    choiceLabel: "Lost",
    confirmLabel: "Close as lost",
    confirmBody:
      "Closing as lost makes this plan read-only and frees a slot on your plan. Nothing is deleted — you and your buyer keep everything you built.",
  },
};

const OUTCOMES: readonly ClosedPlanStatus[] = ["won", "lost"];

/** No PlanErrorCode describes a dropped connection, so this one sentence isn't describePlanError's. */
const TRANSPORT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function CloseDealControls({ workspaceId, planId, planStatus }: CloseDealControlsProps) {
  const [outcome, setOutcome] = useState<ClosedPlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const choiceRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const hasRenderedRef = useRef(false);

  // Keyboard focus follows the step the seller just moved to, rather than
  // being dropped on <body> when the buttons around it unmount. Skipped on
  // first render so opening the page never steals focus.
  useEffect(() => {
    if (!hasRenderedRef.current) {
      hasRenderedRef.current = true;
      return;
    }
    const target = outcome === null ? choiceRef.current : confirmRef.current;
    target?.focus();
  }, [outcome]);

  function handleConfirm() {
    if (!outcome) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await closePlanAction(workspaceId, planId, outcome);
        if (!result.ok) setError(describePlanError(result.code));
      } catch {
        setError(TRANSPORT_ERROR_MESSAGE);
      }
    });
  }

  // An already-closed deal has nothing to close. The server refuses it too
  // (closed-plans.ts's ensurePlanIsOpen) — this is the quiet half of that
  // same rule, not the boundary itself.
  if (isClosedPlanStatus(planStatus)) return null;

  return (
    <details className="cdc-disclosure" data-surface="close-deal" data-testid="close-deal-controls">
      <summary className="cdc-summary">Close this deal</summary>

      <div className="cdc-body">
        {outcome === null ? (
          <>
            <p className="cdc-prompt">How did this deal end?</p>
            <div className="cdc-choices">
              {OUTCOMES.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  className="cdc-btn"
                  ref={index === 0 ? choiceRef : undefined}
                  onClick={() => setOutcome(value)}
                >
                  {OUTCOME_COPY[value].choiceLabel}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="cdc-prompt">{OUTCOME_COPY[outcome].confirmBody}</p>
            <div className="cdc-choices">
              <button
                type="button"
                className="cdc-btn"
                ref={confirmRef}
                onClick={handleConfirm}
                disabled={isPending}
                aria-busy={isPending}
              >
                {isPending ? "Closing…" : OUTCOME_COPY[outcome].confirmLabel}
              </button>
              <button type="button" className="cdc-btn" onClick={() => setOutcome(null)} disabled={isPending}>
                Back
              </button>
            </div>
          </>
        )}

        {isPending ? (
          <p className="cdc-pending" role="status">
            Closing this deal…
          </p>
        ) : null}

        {error ? (
          <p className="cdc-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
