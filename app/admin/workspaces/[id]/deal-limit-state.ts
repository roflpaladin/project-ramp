// Sprint 12, Ticket 60 — where does this tenant stand on active deals, and
// which notice (if any) belongs where the go-live button is?
//
// PURE. No DB, no React, no clock. app/admin/workspaces/[id]/page.tsx does
// the two reads (getTenantEntitlement, countActiveDealsForTenant), catches
// each one on its own, and hands whatever survived to buildDealLimitState —
// so a Supabase hiccup degrades this page instead of 500-ing it.
//
// THE RULE THIS FILE EXISTS TO PROTECT: an infrastructure failure never
// renders as the upgrade wall. "We could not check your plan" and "you are
// using every deal your plan includes" are different sentences with
// different next steps, and only one of them is about money. Guessing the
// wrong one either paywalls a paying customer or quietly lets a tenant past
// their cap — so this module answers `isUnknown` instead of guessing, and
// the server (lib/plans/go-live.ts) stays the authority either way.

import type { Entitlement } from "@/lib/billing/entitlement";
import type { PlanErrorCode } from "@/lib/plans/errors";

export interface DealLimitState {
  /** Active, non-sample deals across the whole tenant. Null when the count could not be read. */
  readonly activeCount: number | null;
  /** The tier's cap. Null means unlimited — or unknown, which `isUnknown` tells apart. */
  readonly maxActiveDeals: number | null;
  /** At the tier's cap. Fix: close a deal, or upgrade. */
  readonly isAtLimit: boolean;
  /** Past due beyond the 7-day grace. Fix: update payment details. Never the same notice as the cap. */
  readonly isBlockedFromNewDeals: boolean;
  /** We could not work this out. Show the honest copy, offer no CTA, leave the button enabled. */
  readonly isUnknown: boolean;
}

/** The three notices the seller can be shown where the go-live button lives. */
export type DealLimitReason = "limit" | "past-due" | "unknown";

function frozen(state: DealLimitState): DealLimitState {
  return Object.freeze(state);
}

export const UNKNOWN_DEAL_LIMIT_STATE: DealLimitState = frozen({
  activeCount: null,
  maxActiveDeals: null,
  isAtLimit: false,
  isBlockedFromNewDeals: false,
  isUnknown: true,
});

/**
 * `entitlement === null` means the billing read failed; `activeCount ===
 * null` means the count read failed. They fail independently and are handled
 * independently.
 */
export function buildDealLimitState(entitlement: Entitlement | null, activeCount: number | null): DealLimitState {
  if (!entitlement) return UNKNOWN_DEAL_LIMIT_STATE;

  // Invoiced customers (a hand-written manual entitlement) are never walled
  // and never counted against a cap, whatever tier the override happens to
  // name — founder ruling, and the same rule lib/billing/entitlement.ts
  // encodes when it puts the manual branch first.
  if (entitlement.source === "manual") {
    return frozen({
      activeCount,
      maxActiveDeals: null,
      isAtLimit: false,
      isBlockedFromNewDeals: false,
      isUnknown: false,
    });
  }

  // Past due beyond grace outranks the count, and is knowable without one.
  if (entitlement.isBlockedFromNewDeals) {
    return frozen({
      activeCount,
      maxActiveDeals: entitlement.maxActiveDeals,
      isAtLimit: false,
      isBlockedFromNewDeals: true,
      isUnknown: false,
    });
  }

  if (entitlement.maxActiveDeals === null) {
    return frozen({
      activeCount,
      maxActiveDeals: null,
      isAtLimit: false,
      isBlockedFromNewDeals: false,
      isUnknown: false,
    });
  }

  // A cap exists but nothing could be counted: "are they at it?" is exactly
  // the question we cannot answer, so we say so rather than guess either way.
  if (activeCount === null) return UNKNOWN_DEAL_LIMIT_STATE;

  return frozen({
    activeCount,
    maxActiveDeals: entitlement.maxActiveDeals,
    isAtLimit: !entitlement.canStartNewDeal(activeCount),
    isBlockedFromNewDeals: false,
    isUnknown: false,
  });
}

/** Null means "no notice at all" — the ordinary case for a tenant with room. */
export function dealLimitReasonForState(state: DealLimitState): DealLimitReason | null {
  if (state.isBlockedFromNewDeals) return "past-due";
  if (state.isAtLimit) return "limit";
  if (state.isUnknown) return "unknown";
  return null;
}

/**
 * The same three notices, reached the other way round: the page was stale,
 * the seller pressed "Make it live" anyway, and the server refused. Every
 * other PlanErrorCode keeps its ordinary inline message (error-messages.ts).
 */
export function dealLimitReasonForErrorCode(code: PlanErrorCode): DealLimitReason | null {
  switch (code) {
    case "DEAL_LIMIT_REACHED":
      return "limit";
    case "BILLING_PAST_DUE":
      return "past-due";
    case "BILLING_CHECK_FAILED":
      return "unknown";
    default:
      return null;
  }
}
