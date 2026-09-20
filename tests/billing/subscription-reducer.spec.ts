// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Unit coverage for
// lib/billing/subscription-reducer.ts, the pure core that turns a verified
// Paddle webhook event into the next tenant_subscriptions state. No DB, no
// network, no env: every test injects its own tier resolver so an env-var
// price ID can never decide an assertion here.
//
// Paddle sends ONE catch-all subscription.updated for upgrade, downgrade,
// renewal and scheduled change — so the reducer diffs the payload rather
// than branching per event type, and these tests pin that behaviour
// (upgrade changes only the tier, a scheduled cancel changes only
// scheduled_change, etc).

import { describe, expect, it } from "vitest";

import { applyBillingEvent, type SubscriptionState } from "@/lib/billing/subscription-reducer";
import type { PaddleSubscriptionEvent, PaddleSubscriptionPayload } from "@/lib/billing/paddle-event";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const PRICE_TO_TIER: Readonly<Record<string, { tierId: string; billingCycle: "month" | "year" }>> = {
  pri_starter_month: { tierId: "starter", billingCycle: "month" },
  pri_pro_month: { tierId: "pro", billingCycle: "month" },
  pri_pro_year: { tierId: "pro", billingCycle: "year" },
  pri_advanced_month: { tierId: "advanced", billingCycle: "month" },
};

function resolveTier(priceId: string) {
  return PRICE_TO_TIER[priceId] ?? null;
}

function subscriptionPayload(overrides: Partial<PaddleSubscriptionPayload> = {}): PaddleSubscriptionPayload {
  return {
    id: "sub_1",
    status: "active",
    customerId: "ctm_1",
    priceIds: ["pri_starter_month"],
    currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
    scheduledChange: null,
    checkoutRef: null,
    ...overrides,
  };
}

function event(overrides: Partial<PaddleSubscriptionEvent> = {}): PaddleSubscriptionEvent {
  return {
    eventId: "evt_1",
    eventType: "subscription.created",
    occurredAt: "2026-09-20T10:00:00.000Z",
    subscription: subscriptionPayload(),
    ...overrides,
  };
}

function apply(state: SubscriptionState | null, nextEvent: PaddleSubscriptionEvent) {
  return applyBillingEvent(state, nextEvent, { tenantId: TENANT_ID, resolveTier });
}

function activeStarterState(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  const seeded = apply(null, event());
  return { ...(seeded.state as SubscriptionState), ...overrides };
}

describe("applyBillingEvent — first event for a tenant", () => {
  it("creates state from a subscription.created payload", () => {
    // Arrange
    const created = event();

    // Act
    const result = apply(null, created);

    // Assert
    expect(result.outcome).toBe("applied");
    expect(result.state).toEqual({
      tenantId: TENANT_ID,
      paddleCustomerId: "ctm_1",
      paddleSubscriptionId: "sub_1",
      tierId: "starter",
      billingCycle: "month",
      status: "active",
      currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
      scheduledChange: null,
      pastDueSince: null,
      lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
      manualEntitlementTier: null,
      manualEntitlementNote: null,
    });
  });

  it("never mutates the state it was given", () => {
    // Arrange
    const before = activeStarterState();
    const snapshot = { ...before };

    // Act
    apply(before, event({ eventId: "evt_2", occurredAt: "2026-09-21T10:00:00.000Z" }));

    // Assert
    expect(before).toEqual(snapshot);
  });
});

describe("applyBillingEvent — out-of-order and replayed events", () => {
  it("treats an event older than the last applied one as stale and changes nothing", () => {
    // Arrange
    const current = activeStarterState({ lastEventOccurredAt: "2026-09-20T12:00:00.000Z" });
    const older = event({
      eventId: "evt_old",
      eventType: "subscription.updated",
      occurredAt: "2026-09-20T11:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_month"] }),
    });

    // Act
    const result = apply(current, older);

    // Assert
    expect(result.outcome).toBe("stale");
    expect(result.state).toBe(current);
  });

  it("treats an event with the same occurred_at as the last applied one as stale", () => {
    // Arrange
    const current = activeStarterState({ lastEventOccurredAt: "2026-09-20T12:00:00.000Z" });
    const sameInstant = event({
      eventId: "evt_same",
      eventType: "subscription.updated",
      occurredAt: "2026-09-20T12:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_month"] }),
    });

    // Act
    const result = apply(current, sameInstant);

    // Assert
    expect(result.outcome).toBe("stale");
    expect(result.state).toBe(current);
  });

  it("lands on the same state whether an out-of-order pair arrives in order or reversed", () => {
    // Arrange
    const upgrade = event({
      eventId: "evt_upgrade",
      eventType: "subscription.updated",
      occurredAt: "2026-09-20T11:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_month"] }),
    });
    const renewal = event({
      eventId: "evt_renewal",
      eventType: "subscription.updated",
      occurredAt: "2026-09-20T12:00:00.000Z",
      subscription: subscriptionPayload({
        priceIds: ["pri_pro_month"],
        currentPeriodEndsAt: "2026-11-20T00:00:00.000Z",
      }),
    });
    const seeded = activeStarterState();

    // Act
    const inOrder = apply(apply(seeded, upgrade).state, renewal).state;
    const reversed = apply(apply(seeded, renewal).state, upgrade).state;

    // Assert
    expect(reversed).toEqual(inOrder);
    expect(inOrder?.currentPeriodEndsAt).toBe("2026-11-20T00:00:00.000Z");
  });
});

describe("applyBillingEvent — plan changes via the catch-all subscription.updated", () => {
  it("changes the tier on an upgrade and leaves every other field alone", () => {
    // Arrange
    const current = activeStarterState();
    const upgrade = event({
      eventId: "evt_upgrade",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_month"] }),
    });

    // Act
    const result = apply(current, upgrade);

    // Assert
    expect(result.outcome).toBe("applied");
    expect(result.state).toEqual({
      ...current,
      tierId: "pro",
      lastEventOccurredAt: "2026-09-21T10:00:00.000Z",
    });
  });

  it("records a switch to yearly billing", () => {
    // Arrange
    const current = activeStarterState();
    const switchToYearly = event({
      eventId: "evt_yearly",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_year"] }),
    });

    // Act
    const result = apply(current, switchToYearly);

    // Assert
    expect(result.state?.billingCycle).toBe("year");
    expect(result.state?.tierId).toBe("pro");
  });

  it("stores a scheduled cancellation without touching the status", () => {
    // Arrange
    const current = activeStarterState();
    const scheduledCancel = event({
      eventId: "evt_sched",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({
        scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" },
      }),
    });

    // Act
    const result = apply(current, scheduledCancel);

    // Assert
    expect(result.state?.status).toBe("active");
    expect(result.state?.scheduledChange).toEqual({ action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" });
  });

  it("clears a scheduled change once Paddle stops sending one", () => {
    // Arrange
    const current = activeStarterState({
      scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" },
    });
    const resumed = event({
      eventId: "evt_unsched",
      eventType: "subscription.updated",
      occurredAt: "2026-09-22T10:00:00.000Z",
      subscription: subscriptionPayload({ scheduledChange: null }),
    });

    // Act
    const result = apply(current, resumed);

    // Assert
    expect(result.state?.scheduledChange).toBeNull();
  });
});

describe("applyBillingEvent — status transitions", () => {
  it("stamps past_due_since the first time the subscription goes past due", () => {
    // Arrange
    const current = activeStarterState();
    const pastDue = event({
      eventId: "evt_pastdue",
      eventType: "subscription.past_due",
      occurredAt: "2026-09-25T10:00:00.000Z",
      subscription: subscriptionPayload({ status: "past_due" }),
    });

    // Act
    const result = apply(current, pastDue);

    // Assert
    expect(result.state?.status).toBe("past_due");
    expect(result.state?.pastDueSince).toBe("2026-09-25T10:00:00.000Z");
  });

  it("keeps the original past_due_since across later past_due events", () => {
    // Arrange
    const current = activeStarterState({ status: "past_due", pastDueSince: "2026-09-25T10:00:00.000Z" });
    const stillPastDue = event({
      eventId: "evt_pastdue_2",
      eventType: "subscription.updated",
      occurredAt: "2026-09-27T10:00:00.000Z",
      subscription: subscriptionPayload({ status: "past_due" }),
    });

    // Act
    const result = apply(current, stillPastDue);

    // Assert
    expect(result.state?.pastDueSince).toBe("2026-09-25T10:00:00.000Z");
  });

  it("clears past_due_since when the subscription recovers", () => {
    // Arrange
    const current = activeStarterState({ status: "past_due", pastDueSince: "2026-09-25T10:00:00.000Z" });
    const recovered = event({
      eventId: "evt_recovered",
      eventType: "subscription.updated",
      occurredAt: "2026-09-28T10:00:00.000Z",
      subscription: subscriptionPayload({ status: "active" }),
    });

    // Act
    const result = apply(current, recovered);

    // Assert
    expect(result.state?.status).toBe("active");
    expect(result.state?.pastDueSince).toBeNull();
  });

  it("applies an immediate cancellation as a canceled status", () => {
    // Arrange
    const current = activeStarterState();
    const canceled = event({
      eventId: "evt_canceled",
      eventType: "subscription.canceled",
      occurredAt: "2026-09-25T10:00:00.000Z",
      subscription: subscriptionPayload({ status: "canceled", scheduledChange: null }),
    });

    // Act
    const result = apply(current, canceled);

    // Assert
    expect(result.state?.status).toBe("canceled");
  });

  it("applies a pause", () => {
    // Arrange
    const current = activeStarterState();
    const paused = event({
      eventId: "evt_paused",
      eventType: "subscription.paused",
      occurredAt: "2026-09-25T10:00:00.000Z",
      subscription: subscriptionPayload({ status: "paused" }),
    });

    // Act
    const result = apply(current, paused);

    // Assert
    expect(result.state?.status).toBe("paused");
  });
});

describe("applyBillingEvent — untrusted payload values", () => {
  it("ignores an event whose price ID maps to no configured tier and grants nothing", () => {
    // Arrange
    const unknownPrice = event({ subscription: subscriptionPayload({ priceIds: ["pri_not_ours"] }) });

    // Act
    const result = apply(null, unknownPrice);

    // Assert
    expect(result.outcome).toBe("ignored");
    expect(result.reason).toBe("unknown_price_id");
    expect(result.state).toBeNull();
  });

  it("leaves an existing paid state untouched when an unknown price ID arrives", () => {
    // Arrange
    const current = activeStarterState();
    const unknownPrice = event({
      eventId: "evt_unknown",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_not_ours"] }),
    });

    // Act
    const result = apply(current, unknownPrice);

    // Assert
    expect(result.outcome).toBe("ignored");
    expect(result.state).toBe(current);
  });

  it("ignores an event carrying no price IDs at all", () => {
    // Arrange
    const noPrices = event({ subscription: subscriptionPayload({ priceIds: [] }) });

    // Act
    const result = apply(null, noPrices);

    // Assert
    expect(result.outcome).toBe("ignored");
    expect(result.state).toBeNull();
  });

  it("ignores an event for a different Paddle subscription than the stored one", () => {
    // Arrange
    const current = activeStarterState();
    const foreign = event({
      eventId: "evt_foreign",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({ id: "sub_someone_else", priceIds: ["pri_advanced_month"] }),
    });

    // Act
    const result = apply(current, foreign);

    // Assert
    expect(result.outcome).toBe("ignored");
    expect(result.reason).toBe("subscription_id_mismatch");
    expect(result.state).toBe(current);
  });

  it("preserves a manual entitlement override across applied events", () => {
    // Arrange
    const current = activeStarterState({
      manualEntitlementTier: "enterprise",
      manualEntitlementNote: "Invoiced annually",
    });
    const upgrade = event({
      eventId: "evt_upgrade",
      eventType: "subscription.updated",
      occurredAt: "2026-09-21T10:00:00.000Z",
      subscription: subscriptionPayload({ priceIds: ["pri_pro_month"] }),
    });

    // Act
    const result = apply(current, upgrade);

    // Assert
    expect(result.state?.manualEntitlementTier).toBe("enterprise");
    expect(result.state?.manualEntitlementNote).toBe("Invoiced annually");
  });
});
