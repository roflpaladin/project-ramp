// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Pure,
// React-free presentation logic for app/settings/billing/page.tsx: "given
// the tenant's stored subscription (or null) and the entitlement
// resolveEntitlement already derived from it, what plan name / status dot +
// label / date strings does the page show?" No DB, no clock of its own
// (dates are formatted, never generated, here) — mirrors
// app/admin/workspaces/[id]/plan/status-badge.tsx's tone+label shape and
// app/admin/workspaces/[id]/crm-format.ts's date-formatting convention, but
// scoped to this page rather than imported from either (this codebase's
// established pattern is each domain owning its own formatter, not one
// shared util — see crm-format.ts's own STALE_FALLBACK convention vs.
// components/buyer/plan-selectors.ts's own, separate formatPlanDate).
//
// Only meaningful for a NON-MANUAL tenant — page.tsx renders a wholly
// different, portal-free card for entitlement.source === "manual" and never
// calls describeBillingStatus in that case.

import { FREE_TIER_ID, type Entitlement } from "@/lib/billing/entitlement";
import { tierNameForId } from "@/lib/billing/plans";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

export type BillingStatusTone = "done" | "risk" | "wait";

export interface BillingStatusMeta {
  readonly tone: BillingStatusTone;
  readonly label: string;
  /** An extra explanatory line under the status dot, when one is needed. */
  readonly helpText: string | null;
}

const FREE_LABEL = "Free";
const DATE_FALLBACK = "—"; // em dash, matches crm-format.ts's STALE_FALLBACK convention
const SCHEDULED_CANCEL_ACTION = "cancel";

const BILLING_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * The tenant's plan name as it is entitled RIGHT NOW. resolveEntitlement
 * already collapses a canceled or paused subscription back to the free
 * tier, so this reads "Free" for those too — describeBillingStatus below is
 * what still distinguishes "never subscribed" from "Canceled"/"Paused".
 */
export function planDisplayName(entitlement: Entitlement): string {
  if (entitlement.tier === FREE_TIER_ID) return FREE_LABEL;
  return tierNameForId(entitlement.tier) ?? entitlement.tier;
}

/** Paddle timestamps are full ISO instants, never a date-only string —
 * falls back to an em dash rather than "Invalid Date" for a missing or
 * unparsable value. */
export function formatBillingDate(value: string | null): string {
  if (!value) return DATE_FALLBACK;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? DATE_FALLBACK : BILLING_DATE_FORMATTER.format(parsed);
}

/**
 * Sprint 12, Ticket 60 — "how much of my plan am I actually using?".
 * Complements activeDealsAllowanceLabel (lib/billing/active-deals-label.ts),
 * which says what the plan INCLUDES; this says what is in use. Sample deals
 * are already excluded upstream by countActiveDealsForTenant.
 *
 * `maxActiveDeals === null` is unlimited — there is no "of M" to state, so
 * the word is said outright rather than implied by an absence. The noun
 * follows whichever number governs it, so a Free tenant reads "1 of 1 active
 * deal" rather than the slightly wrong "1 of 1 active deals".
 */
export function activeDealsUsedLabel(activeCount: number, maxActiveDeals: number | null): string {
  if (maxActiveDeals === null) {
    return `${activeCount} active ${activeCount === 1 ? "deal" : "deals"} — unlimited`;
  }
  return `${activeCount} of ${maxActiveDeals} active ${maxActiveDeals === 1 ? "deal" : "deals"}`;
}

function isScheduledCancel(subscription: SubscriptionState): boolean {
  return subscription.scheduledChange?.action === SCHEDULED_CANCEL_ACTION;
}

/** Status is never colour-only — a dot + this label, always (design system
 * MUST). `subscription` is null for a tenant that has never subscribed. */
export function describeBillingStatus(subscription: SubscriptionState | null, entitlement: Entitlement): BillingStatusMeta {
  if (!subscription) {
    return { tone: "wait", label: FREE_LABEL, helpText: null };
  }

  switch (subscription.status) {
    case "trialing":
      return { tone: "wait", label: "Trial", helpText: null };

    case "active": {
      if (!isScheduledCancel(subscription)) {
        return { tone: "done", label: "Active", helpText: null };
      }
      const endsAt = subscription.scheduledChange?.effectiveAt ?? subscription.currentPeriodEndsAt;
      return {
        tone: "wait",
        label: `Cancels on ${formatBillingDate(endsAt)}`,
        helpText: "Your plan stays active until then.",
      };
    }

    case "past_due":
      if (entitlement.isInGrace) {
        return { tone: "risk", label: `Payment failed — fix by ${formatBillingDate(entitlement.graceEndsAt)}`, helpText: null };
      }
      return {
        tone: "risk",
        label: "Payment overdue — new deals are paused",
        helpText: "Existing deals and buyers keep working.",
      };

    case "paused":
      return { tone: "wait", label: "Paused", helpText: null };

    case "canceled":
      return { tone: "wait", label: "Canceled", helpText: null };
  }
}
