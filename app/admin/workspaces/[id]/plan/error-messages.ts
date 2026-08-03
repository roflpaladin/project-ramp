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
  INVALID_DATE_RANGE: "The target date is before the start date. Adjust the dates and try again.",
  INCOHERENT_COMPLETION: "That step could not be saved. Refresh the page and try again.",
  REORDER_SET_MISMATCH: "The plan changed elsewhere. Refresh the page to see the current order.",
  VALIDATION_ERROR: "Check the highlighted fields and try again.",
  UNKNOWN_ERROR: "Something went wrong saving that change. Try again in a moment.",
};

export function describePlanError(code: PlanErrorCode): string {
  return MESSAGES[code];
}
