// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Boundary validation
// for the webhook body: lib/billing/paddle-event.ts turns the `unknown` that
// comes off a verified POST into either a typed subscription event, an
// explicitly unhandled event type (2xx, no work), or an outright rejection.
// Hand-rolled guards, not a schema library — this codebase has no such
// dependency (checked package.json), and every sibling route validates its
// body exactly this way (app/api/waitlist/route.ts's own note).

import { describe, expect, it } from "vitest";

import { parsePaddleEvent } from "@/lib/billing/paddle-event";

function rawEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: "evt_1",
    event_type: "subscription.created",
    occurred_at: "2026-09-20T10:00:00.000Z",
    data: {
      id: "sub_1",
      status: "active",
      customer_id: "ctm_1",
      current_billing_period: { starts_at: "2026-09-20T00:00:00Z", ends_at: "2026-10-20T00:00:00Z" },
      scheduled_change: null,
      items: [{ price: { id: "pri_pro_month" }, quantity: 1 }],
      custom_data: { checkoutRef: "ref_abc" },
    },
    ...overrides,
  };
}

describe("parsePaddleEvent — well-formed subscription events", () => {
  it("maps a subscription.created body onto the typed event shape", () => {
    // Act
    const parsed = parsePaddleEvent(rawEvent());

    // Assert
    expect(parsed).toEqual({
      kind: "subscription",
      event: {
        eventId: "evt_1",
        eventType: "subscription.created",
        occurredAt: "2026-09-20T10:00:00.000Z",
        subscription: {
          id: "sub_1",
          status: "active",
          customerId: "ctm_1",
          priceIds: ["pri_pro_month"],
          currentPeriodEndsAt: "2026-10-20T00:00:00Z",
          scheduledChange: null,
          checkoutRef: "ref_abc",
        },
      },
    });
  });

  it("reads a scheduled change when Paddle sends one", () => {
    // Arrange
    const body = rawEvent({
      event_type: "subscription.updated",
      data: {
        ...(rawEvent().data as Record<string, unknown>),
        scheduled_change: { action: "cancel", effective_at: "2026-10-20T00:00:00Z" },
      },
    });

    // Act
    const parsed = parsePaddleEvent(body);

    // Assert
    expect(parsed.kind === "subscription" && parsed.event.subscription.scheduledChange).toEqual({
      action: "cancel",
      effectiveAt: "2026-10-20T00:00:00Z",
    });
  });

  it("collects every item's price ID, in order", () => {
    // Arrange
    const body = rawEvent({
      data: {
        ...(rawEvent().data as Record<string, unknown>),
        items: [{ price: { id: "pri_a" } }, { price: { id: "pri_b" } }],
      },
    });

    // Act
    const parsed = parsePaddleEvent(body);

    // Assert
    expect(parsed.kind === "subscription" && parsed.event.subscription.priceIds).toEqual(["pri_a", "pri_b"]);
  });

  it("treats a non-string checkoutRef in custom_data as absent rather than trusting it", () => {
    // Arrange — custom_data is attacker-influenceable in a tampered checkout.
    const body = rawEvent({
      data: { ...(rawEvent().data as Record<string, unknown>), custom_data: { checkoutRef: { nested: true } } },
    });

    // Act
    const parsed = parsePaddleEvent(body);

    // Assert
    expect(parsed.kind === "subscription" && parsed.event.subscription.checkoutRef).toBeNull();
  });

  it("ignores a raw tenantId in custom_data completely — it is never part of the parsed event", () => {
    // Arrange — the pre-T59 client sent this; it must carry no authority.
    const body = rawEvent({
      data: {
        ...(rawEvent().data as Record<string, unknown>),
        custom_data: { tenantId: "22222222-2222-2222-2222-222222222222" },
      },
    });

    // Act
    const parsed = parsePaddleEvent(body);

    // Assert
    expect(parsed.kind).toBe("subscription");
    expect(JSON.stringify(parsed)).not.toContain("22222222-2222-2222-2222-222222222222");
  });
});

describe("parsePaddleEvent — events we do not handle", () => {
  it("reports a transaction event as unhandled rather than invalid", () => {
    // Act
    const parsed = parsePaddleEvent(rawEvent({ event_type: "transaction.completed" }));

    // Assert
    expect(parsed).toEqual({ kind: "unhandled", eventType: "transaction.completed" });
  });

  it("reports an unknown subscription sub-type as unhandled", () => {
    // Act
    const parsed = parsePaddleEvent(rawEvent({ event_type: "subscription.imported" }));

    // Assert
    expect(parsed.kind).toBe("unhandled");
  });
});

describe("parsePaddleEvent — malformed bodies", () => {
  const CASES: readonly { name: string; body: unknown }[] = [
    { name: "a null body", body: null },
    { name: "an array body", body: [] },
    { name: "a string body", body: "subscription.created" },
    { name: "a missing event_id", body: rawEvent({ event_id: undefined }) },
    { name: "a non-string event_id", body: rawEvent({ event_id: 42 }) },
    { name: "a missing event_type", body: rawEvent({ event_type: undefined }) },
    { name: "a missing occurred_at", body: rawEvent({ occurred_at: undefined }) },
    { name: "an unparseable occurred_at", body: rawEvent({ occurred_at: "whenever" }) },
    { name: "a missing data object", body: rawEvent({ data: undefined }) },
    { name: "a missing subscription id", body: rawEvent({ data: { status: "active", items: [] } }) },
    {
      name: "a status Paddle never sends",
      body: rawEvent({ data: { id: "sub_1", status: "extremely_active", items: [] } }),
    },
  ];

  for (const { name, body } of CASES) {
    it(`rejects ${name}`, () => {
      // Act
      const parsed = parsePaddleEvent(body);

      // Assert
      expect(parsed.kind).toBe("invalid");
    });
  }
});
