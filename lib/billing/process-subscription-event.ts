// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Everything that
// happens to a verified, deduplicated subscription event between "we
// believe Paddle sent this" and "the row is written": decide WHICH tenant
// (and which stored state) the event belongs to, run the pure reducer, and
// persist through the database's own ordering guard.
//
// Extracted from the route so the route stays a thin HTTP shell and this
// logic — the part with the money in it — can be read in one screen.
//
// Three defences live here, in order:
//
//  1. A known paddle_subscription_id settles the tenant outright. A
//     replayed or stolen checkout reference can never move an existing
//     subscription to a different tenant.
//  2. A tenant that ALREADY has a live subscription never gets it replaced
//     by a second one. The row is keyed by tenant, so without this check a
//     second checkout (or a late event from an old subscription) would
//     silently overwrite the paid row — and its ordering anchor with it.
//     Only a terminal (canceled) subscription, or a row that has no Paddle
//     subscription at all, may be replaced.
//  3. The final word belongs to SQL, not to this process. Defence 2 above
//     is a check-then-write: two FIRST events for different subscriptions
//     on one tenant can both read "no row yet" and both pass it. So the
//     same two questions (is this event newer? is this the same
//     subscription, or a canceled one we may replace?) are re-asked inside
//     the single statement that writes — upsertFromState reports which
//     verdict the database reached, and a refused write is recorded as
//     `stale` or `ignored`, never as `applied`.
//
// A manual entitlement (invoice-paying customers) is carried across a
// replacement: those tenants are entitled by a human decision, and a new
// Paddle subscription must not quietly drop it.

import { applyBillingEvent, type SubscriptionState } from "./subscription-reducer";
import type { PaddleSubscriptionEvent } from "./paddle-event";
import {
  consumeCheckoutRef,
  findByPaddleSubscriptionId,
  findByTenantId,
  upsertFromState,
  type EventProcessingOutcome,
} from "./subscription-repository";

export interface ProcessedEvent {
  readonly outcome: EventProcessingOutcome;
  readonly reason: string | null;
}

interface EventTarget {
  readonly kind: "target";
  readonly tenantId: string;
  /** The state to diff against — null when this is a brand-new subscription. */
  readonly state: SubscriptionState | null;
  /** A row being replaced (canceled, or never Paddle-backed); its manual override survives. */
  readonly replaces: SubscriptionState | null;
}

type TargetResolution = EventTarget | { readonly kind: "ignored"; readonly reason: string };

function ignored(reason: string): ProcessedEvent {
  return Object.freeze({ outcome: "ignored" as const, reason });
}

/**
 * Only reached when no row holds this paddle_subscription_id yet, i.e. the
 * first event of a new subscription — the one case where the tenant has to
 * come from a server-issued checkout reference.
 */
async function resolveNewSubscriptionTarget(event: PaddleSubscriptionEvent): Promise<TargetResolution> {
  const { checkoutRef, id: subscriptionId } = event.subscription;
  if (!checkoutRef) return { kind: "ignored", reason: "unresolved_tenant" };

  const owner = await consumeCheckoutRef(checkoutRef, subscriptionId);
  if (!owner) return { kind: "ignored", reason: "unresolved_tenant" };

  const existing = await findByTenantId(owner.tenantId);
  if (!existing || existing.paddleSubscriptionId === subscriptionId) {
    return { kind: "target", tenantId: owner.tenantId, state: existing, replaces: null };
  }

  // A different, still-live subscription already owns this tenant's row.
  if (existing.paddleSubscriptionId !== null && existing.status !== "canceled") {
    return { kind: "ignored", reason: "duplicate_subscription" };
  }

  return { kind: "target", tenantId: owner.tenantId, state: null, replaces: existing };
}

async function resolveTarget(event: PaddleSubscriptionEvent): Promise<TargetResolution> {
  const stored = await findByPaddleSubscriptionId(event.subscription.id);
  if (stored) {
    return { kind: "target", tenantId: stored.tenantId, state: stored, replaces: null };
  }
  return resolveNewSubscriptionTarget(event);
}

function withCarriedManualEntitlement(state: SubscriptionState, replaces: SubscriptionState | null): SubscriptionState {
  if (!replaces?.manualEntitlementTier) return state;
  return Object.freeze({
    ...state,
    manualEntitlementTier: replaces.manualEntitlementTier,
    manualEntitlementNote: replaces.manualEntitlementNote,
  });
}

export async function processSubscriptionEvent(event: PaddleSubscriptionEvent): Promise<ProcessedEvent> {
  const target = await resolveTarget(event);
  if (target.kind === "ignored") return ignored(target.reason);

  const result = applyBillingEvent(target.state, event, { tenantId: target.tenantId });
  if (result.outcome !== "applied" || !result.state) {
    return Object.freeze({ outcome: result.outcome, reason: result.reason });
  }

  const applied = await upsertFromState(withCarriedManualEntitlement(result.state, target.replaces));

  // The database has the last word, and it distinguishes the two ways a
  // write can be refused: an event older than the stored one (stale), and
  // a second live subscription for a tenant that already has one (the same
  // duplicate_subscription verdict the app-level check produces — reached
  // here when two first-events raced each other past it).
  if (applied === "stale") {
    return Object.freeze({ outcome: "stale" as const, reason: "rejected_by_ordering_guard" });
  }
  if (applied === "subscription_conflict") {
    return ignored("duplicate_subscription");
  }
  return Object.freeze({ outcome: "applied" as const, reason: null });
}
