// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Unit
// coverage for app/settings/billing/billing-status.ts: pure, React-free
// derivation of the plan name, status dot+label, and date formatting the
// billing page renders. Only meaningful for non-manual tenants —
// describeBillingStatus is never called for entitlement.source === "manual"
// (page.tsx renders a wholly different card for that case).

import { describe, expect, it } from "vitest";

import { resolveEntitlement } from "@/lib/billing/entitlement";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";
import { describeBillingStatus, formatBillingDate, planDisplayName } from "@/app/settings/billing/billing-status";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    paddleCustomerId: "ctm_1",
    paddleSubscriptionId: "sub_1",
    tierId: "pro",
    billingCycle: "month",
    status: "active",
    currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
    scheduledChange: null,
    pastDueSince: null,
    lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
    manualEntitlementTier: null,
    manualEntitlementNote: null,
    ...overrides,
  };
}

describe("planDisplayName", () => {
  it("returns the tier's own display name for a live subscription", () => {
    const entitlement = resolveEntitlement(subscription({ tierId: "pro" }), NOW);
    expect(planDisplayName(entitlement)).toBe("Pro");
  });

  it("returns 'Free' for a tenant with no subscription at all", () => {
    const entitlement = resolveEntitlement(null, NOW);
    expect(planDisplayName(entitlement)).toBe("Free");
  });

  it("returns 'Free' for a canceled subscription (resolveEntitlement already collapsed it)", () => {
    const entitlement = resolveEntitlement(subscription({ status: "canceled" }), NOW);
    expect(planDisplayName(entitlement)).toBe("Free");
  });
});

describe("formatBillingDate", () => {
  it("formats a full ISO timestamp as a short human date", () => {
    expect(formatBillingDate("2026-10-20T00:00:00.000Z")).toBe("Oct 20, 2026");
  });

  it("falls back to an em dash for null", () => {
    expect(formatBillingDate(null)).toBe("—");
  });

  it("falls back to an em dash for an unparsable value, never 'Invalid Date'", () => {
    expect(formatBillingDate("whenever")).toBe("—");
  });
});

describe("describeBillingStatus — no subscription at all", () => {
  it("is Free / wait, with no help text", () => {
    const entitlement = resolveEntitlement(null, NOW);
    const status = describeBillingStatus(null, entitlement);

    expect(status).toEqual({ tone: "wait", label: "Free", helpText: null });
  });
});

describe("describeBillingStatus — trialing", () => {
  it("is Trial / wait", () => {
    const sub = subscription({ status: "trialing" });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status).toEqual({ tone: "wait", label: "Trial", helpText: null });
  });
});

describe("describeBillingStatus — active", () => {
  it("is Active / done when there is no scheduled cancellation", () => {
    const sub = subscription({ status: "active", scheduledChange: null });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status).toEqual({ tone: "done", label: "Active", helpText: null });
  });

  it("shows 'Cancels on <date>' / wait, with reassurance help text, for a scheduled cancellation", () => {
    const sub = subscription({
      status: "active",
      scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" },
    });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status.tone).toBe("wait");
    expect(status.label).toBe("Cancels on Oct 20, 2026");
    expect(status.helpText).toMatch(/stays active/i);
  });

  it("falls back to currentPeriodEndsAt when a scheduled cancellation has no effective_at", () => {
    const sub = subscription({
      status: "active",
      currentPeriodEndsAt: "2026-11-01T00:00:00.000Z",
      scheduledChange: { action: "cancel", effectiveAt: null },
    });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status.label).toBe("Cancels on Nov 1, 2026");
  });

  it("does not treat a non-cancel scheduled change (e.g. a downgrade) as a cancellation", () => {
    const sub = subscription({
      status: "active",
      scheduledChange: { action: "downgrade", effectiveAt: "2026-10-20T00:00:00.000Z" },
    });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status.label).toBe("Active");
  });
});

describe("describeBillingStatus — past_due", () => {
  it("shows 'Payment failed — fix by <date>' / risk while in the 7-day grace", () => {
    const sub = subscription({ status: "past_due", pastDueSince: "2026-09-20T10:00:00.000Z" });
    const now = new Date("2026-09-21T10:00:00.000Z"); // 1 day into the 7-day grace
    const status = describeBillingStatus(sub, resolveEntitlement(sub, now));

    expect(status.tone).toBe("risk");
    expect(status.label).toMatch(/^Payment failed — fix by /);
    expect(status.helpText).toBeNull();
  });

  it("shows 'Payment overdue — new deals are paused' / risk once the grace has ended, reassuring that existing deals keep working", () => {
    const sub = subscription({ status: "past_due", pastDueSince: "2026-09-01T00:00:00.000Z" });
    const now = new Date("2026-09-21T00:00:00.000Z"); // well past the 7-day grace
    const status = describeBillingStatus(sub, resolveEntitlement(sub, now));

    expect(status).toEqual({
      tone: "risk",
      label: "Payment overdue — new deals are paused",
      helpText: "Existing deals and buyers keep working.",
    });
  });
});

describe("describeBillingStatus — paused and canceled", () => {
  it("is Paused / wait", () => {
    const sub = subscription({ status: "paused" });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status).toEqual({ tone: "wait", label: "Paused", helpText: null });
  });

  it("is Canceled / wait", () => {
    const sub = subscription({ status: "canceled" });
    const status = describeBillingStatus(sub, resolveEntitlement(sub, NOW));

    expect(status).toEqual({ tone: "wait", label: "Canceled", helpText: null });
  });
});
