// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Unit coverage for
// lib/billing/subscription-repository.ts against a mocked service-role
// client, following the precedent tests/api/waitlist.spec.ts set (a minimal
// chainable stand-in for the supabase-js query builder rather than a live
// table): 0014_billing.sql has not been applied to the shared dev Supabase
// project yet — this project's migration workflow is a manual "paste into
// the SQL Editor" step — and the rules worth pinning here are ours, not
// Postgres's.
//
// What this file proves: row <-> state mapping in both directions, that a
// redelivered event_id is reported as a duplicate rather than thrown, and
// that an EXPIRED checkout reference resolves to no tenant at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message: string } | null;
}

interface RecordedCall {
  readonly table: string;
  readonly operation: string;
  readonly payload: unknown;
}

const { calls, results } = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  results: { value: [] as QueryResult[] },
}));

/** Pops the next configured result, defaulting to "no row, no error". */
function nextResult(): QueryResult {
  return results.value.shift() ?? { data: null, error: null };
}

/**
 * Every builder method returns the same object, and the object is itself
 * thenable — so any chain this repository uses (.select().eq().maybeSingle(),
 * .update().eq().is(), a bare .insert(), .upsert()) resolves to the next
 * configured result regardless of shape.
 */
function makeQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record = (operation: string) => (payload?: unknown) => {
    calls.push({ table, operation, payload });
    return builder;
  };

  for (const operation of ["select", "insert", "update", "upsert", "delete", "eq", "is"]) {
    builder[operation] = record(operation);
  }
  builder.maybeSingle = () => Promise.resolve(nextResult());
  builder.then = (resolve: (value: QueryResult) => void) => resolve(nextResult());

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => makeQueryBuilder(table) }),
}));

const {
  consumeCheckoutRef,
  createCheckoutRef,
  findByPaddleSubscriptionId,
  findByTenantId,
  markEventOutcome,
  recordEvent,
  upsertFromState,
  CHECKOUT_REF_TTL_MINUTES,
} = await import("@/lib/billing/subscription-repository");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const SUBSCRIPTION_ROW = {
  tenant_id: TENANT_ID,
  paddle_customer_id: "ctm_1",
  paddle_subscription_id: "sub_1",
  tier_id: "pro",
  billing_cycle: "month",
  status: "active",
  current_period_ends_at: "2026-10-20T00:00:00Z",
  scheduled_change: null,
  past_due_since: null,
  last_event_occurred_at: "2026-09-20T10:00:00.000Z",
  manual_entitlement_tier: null,
  manual_entitlement_note: null,
};

function storedState(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: TENANT_ID,
    paddleCustomerId: "ctm_1",
    paddleSubscriptionId: "sub_1",
    tierId: "pro",
    billingCycle: "month",
    status: "active",
    currentPeriodEndsAt: "2026-10-20T00:00:00Z",
    scheduledChange: null,
    pastDueSince: null,
    lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
    manualEntitlementTier: null,
    manualEntitlementNote: null,
    ...overrides,
  };
}

function operationPayload(table: string, operation: string): unknown {
  return calls.find((call) => call.table === table && call.operation === operation)?.payload;
}

beforeEach(() => {
  calls.length = 0;
  results.value = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("findByTenantId", () => {
  it("maps a stored row onto the app's subscription state", async () => {
    // Arrange
    results.value = [{ data: SUBSCRIPTION_ROW, error: null }];

    // Act
    const state = await findByTenantId(TENANT_ID);

    // Assert
    expect(state).toEqual({
      tenantId: TENANT_ID,
      paddleCustomerId: "ctm_1",
      paddleSubscriptionId: "sub_1",
      tierId: "pro",
      billingCycle: "month",
      status: "active",
      currentPeriodEndsAt: "2026-10-20T00:00:00Z",
      scheduledChange: null,
      pastDueSince: null,
      lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
      manualEntitlementTier: null,
      manualEntitlementNote: null,
    });
  });

  it("returns null when the tenant has no subscription row", async () => {
    // Act
    const state = await findByTenantId(TENANT_ID);

    // Assert
    expect(state).toBeNull();
  });

  it("throws on a real query error rather than reporting 'no subscription'", async () => {
    // Arrange
    results.value = [{ data: null, error: { message: "connection reset" } }];

    // Act + Assert
    await expect(findByTenantId(TENANT_ID)).rejects.toThrow(/connection reset/);
  });
});

describe("findByPaddleSubscriptionId", () => {
  it("resolves the stored row (and therefore the settled tenant) for a known subscription", async () => {
    // Arrange
    results.value = [{ data: SUBSCRIPTION_ROW, error: null }];

    // Act
    const state = await findByPaddleSubscriptionId("sub_1");

    // Assert
    expect(state?.tenantId).toBe(TENANT_ID);
  });

  it("returns null for a Paddle subscription we have never stored", async () => {
    // Act + Assert
    expect(await findByPaddleSubscriptionId("sub_unknown")).toBeNull();
  });
});

describe("markEventOutcome", () => {
  it("writes the outcome and reason back onto the logged event", async () => {
    // Act
    await markEventOutcome("evt_1", "ignored", "unknown_price_id");

    // Assert
    expect(operationPayload("paddle_webhook_events", "update")).toEqual({
      processing_outcome: "ignored",
      processing_reason: "unknown_price_id",
    });
  });

  it("throws when the update fails", async () => {
    // Arrange
    results.value = [{ data: null, error: { message: "statement timeout" } }];

    // Act + Assert
    await expect(markEventOutcome("evt_1", "applied", null)).rejects.toThrow(/statement timeout/);
  });
});

describe("upsertFromState", () => {
  it("writes every column back in snake_case, keyed on the tenant", async () => {
    // Arrange
    const state = storedState({
      tierId: "advanced",
      billingCycle: "year",
      status: "past_due",
      scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00Z" },
      pastDueSince: "2026-09-19T00:00:00Z",
    });

    // Act
    await upsertFromState(state);

    // Assert
    expect(operationPayload("tenant_subscriptions", "upsert")).toMatchObject({
      tenant_id: TENANT_ID,
      paddle_subscription_id: "sub_1",
      tier_id: "advanced",
      billing_cycle: "year",
      status: "past_due",
      past_due_since: "2026-09-19T00:00:00Z",
      last_event_occurred_at: "2026-09-20T10:00:00.000Z",
    });
  });

  it("throws when the write fails, so the webhook can answer 500 and be retried", async () => {
    // Arrange
    results.value = [{ data: null, error: { message: "deadlock detected" } }];

    // Act + Assert
    await expect(upsertFromState(storedState())).rejects.toThrow(/deadlock detected/);
  });
});

describe("recordEvent", () => {
  it("reports a first delivery as recorded", async () => {
    // Act
    const result = await recordEvent({
      eventId: "evt_1",
      eventType: "subscription.created",
      occurredAt: "2026-09-20T10:00:00.000Z",
      payload: { anything: true },
    });

    // Assert
    expect(result).toBe("recorded");
    expect(operationPayload("paddle_webhook_events", "insert")).toMatchObject({ event_id: "evt_1" });
  });

  it("reports a redelivery of the same event_id as a duplicate instead of throwing", async () => {
    // Arrange — Postgres unique violation on the primary key.
    results.value = [{ data: null, error: { code: "23505", message: "duplicate key value" } }];

    // Act
    const result = await recordEvent({
      eventId: "evt_1",
      eventType: "subscription.created",
      occurredAt: "2026-09-20T10:00:00.000Z",
      payload: {},
    });

    // Assert
    expect(result).toBe("duplicate");
  });

  it("throws on any other insert error", async () => {
    // Arrange
    results.value = [{ data: null, error: { code: "08006", message: "connection failure" } }];

    // Act + Assert
    await expect(
      recordEvent({ eventId: "evt_1", eventType: "subscription.created", occurredAt: "x", payload: {} }),
    ).rejects.toThrow(/connection failure/);
  });
});

describe("createCheckoutRef", () => {
  it("issues an opaque id that contains nothing about the tenant, with a short expiry", async () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));

    // Act
    const ref = await createCheckoutRef({ tenantId: TENANT_ID, userId: "user-1" });

    // Assert
    expect(ref.id).not.toContain(TENANT_ID);
    expect(ref.id.length).toBeGreaterThanOrEqual(32);
    expect(ref.expiresAt).toBe(
      new Date(Date.parse("2026-09-20T12:00:00.000Z") + CHECKOUT_REF_TTL_MINUTES * 60_000).toISOString(),
    );
    expect(operationPayload("billing_checkout_refs", "insert")).toMatchObject({ tenant_id: TENANT_ID });
  });

  it("issues a different id every time", async () => {
    // Act
    const first = await createCheckoutRef({ tenantId: TENANT_ID, userId: null });
    const second = await createCheckoutRef({ tenantId: TENANT_ID, userId: null });

    // Assert
    expect(first.id).not.toBe(second.id);
  });
});

describe("consumeCheckoutRef", () => {
  it("resolves an unexpired reference to the tenant it was issued for", async () => {
    // Arrange
    results.value = [
      { data: { tenant_id: TENANT_ID, user_id: "user-1", expires_at: futureIso() }, error: null },
      { data: null, error: null },
    ];

    // Act
    const owner = await consumeCheckoutRef("ref_abc");

    // Assert
    expect(owner).toEqual({ tenantId: TENANT_ID, userId: "user-1" });
  });

  it("resolves nothing for a reference that does not exist (tampered or invented)", async () => {
    // Act
    const owner = await consumeCheckoutRef("ref_made_up");

    // Assert
    expect(owner).toBeNull();
  });

  it("resolves nothing for an EXPIRED reference and never stamps it", async () => {
    // Arrange
    results.value = [
      { data: { tenant_id: TENANT_ID, user_id: "user-1", expires_at: pastIso() }, error: null },
    ];

    // Act
    const owner = await consumeCheckoutRef("ref_stale");

    // Assert
    expect(owner).toBeNull();
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("still resolves a reference that was already used, so a second event for one checkout works", async () => {
    // Arrange — consumed_at is a record of first use, not a one-shot lock.
    results.value = [
      { data: { tenant_id: TENANT_ID, user_id: "user-1", expires_at: futureIso() }, error: null },
      { data: null, error: null },
    ];

    // Act
    const owner = await consumeCheckoutRef("ref_abc");

    // Assert
    expect(owner?.tenantId).toBe(TENANT_ID);
  });
});

function futureIso(): string {
  return new Date(Date.now() + 10 * 60_000).toISOString();
}

function pastIso(): string {
  return new Date(Date.now() - 1_000).toISOString();
}
