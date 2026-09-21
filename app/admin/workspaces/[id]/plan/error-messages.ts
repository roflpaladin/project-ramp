// UI-facing copy for lib/plans/errors.ts's PlanErrorCode (Ticket 29). Owned
// by the plan builder, not lib/plans — mapping a code to a sentence is
// presentation, not the data-layer contract. Every sentence follows the
// product voice: what happened, what to do next, sentence case, no raw
// exception text, no hype, no emoji, no "!".

import type { PlanErrorCode } from "@/lib/plans/errors";

const MESSAGES: Record<PlanErrorCode, string> = {
  UNAUTHENTICATED: "Your session has expired. Sign in again to keep editing this plan.",
  NOT_FOUND: "That item is no longer here. Refresh the page to see the current plan.",
  PLAN_ALREADY_LIVE: "This workspace already has a live plan. Archive it before starting a new one.",
  // Sprint 12, Ticket 60. Closing a deal frees a seat and hides nothing: the
  // plan stays visible with its outcome, read-only.
  PLAN_CLOSED: "This deal is closed, so its plan is read-only. Start a new plan for this workspace to keep going.",
  // The upgrade wall. Never shown for an infrastructure failure — that is
  // BILLING_CHECK_FAILED below.
  DEAL_LIMIT_REACHED:
    "You are using all the active deals your plan includes. Close a deal or upgrade your plan to start another.",
  // Not a paywall: upgrading changes nothing here. The way forward is a real
  // deal, so that is what the sentence offers.
  SAMPLE_DEAL_LOCKED:
    "The sample deal is for practice, so it can't go live. Create a real deal when you're ready to go live with a buyer.",
  BILLING_PAST_DUE:
    "Your last payment did not go through, so new deals are paused. Existing deals keep working — update your payment details to start another.",
  BILLING_CHECK_FAILED: "We could not check your plan just now. Try again in a moment.",
  GO_LIVE_NOT_PERMITTED: "A plan can only go live from the go-live button. Refresh the page and try that.",
  INVALID_DATE_RANGE: "The target date is before the start date. Adjust the dates and try again.",
  INCOHERENT_COMPLETION: "That step could not be saved. Refresh the page and try again.",
  REORDER_SET_MISMATCH: "The plan changed elsewhere. Refresh the page to see the current order.",
  VALIDATION_ERROR: "Check the highlighted fields and try again.",
  UNKNOWN_ERROR: "Something went wrong saving that change. Try again in a moment.",
};

export function describePlanError(code: PlanErrorCode): string {
  return MESSAGES[code];
}
