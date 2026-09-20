// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Integration-shaped
// coverage for app/api/billing/paddle/webhook/route.ts with the repository
// (the only thing in the request path that touches Supabase) mocked — so
// this file is DB-free and network-free like every other spec in
// tests/billing.
//
// What this route is: the ONLY unauthenticated POST in the app that can
// change what a tenant is entitled to. It must fail closed on a bad or
// absent signature, be idempotent on event_id, and never take a tenant id
// from the payload — only from a server-issued checkout ref or from the
// Paddle subscription id we already stored.

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const {
  mockFindByPaddleSubscriptionId,
  mockUpsertFromState,
  mockRecordEvent,
  mockMarkEventOutcome,
  mockConsumeCheckoutRef,
} = vi.hoisted(() => ({
  mockFindByPaddleSubscriptionId: vi.fn(),
  mockUpsertFromState: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockMarkEventOutcome: vi.fn(),
  mockConsumeCheckoutRef: vi.fn(),
}));

vi.mock("@/lib/billing/subscription-repository", () => ({
  findByPaddleSubscriptionId: mockFindByPaddleSubscriptionId,
  upsertFromState: mockUpsertFromState,
  recordEvent: mockRecordEvent,
  markEventOutcome: mockMarkEventOutcome,
  consumeCheckoutRef: mockConsumeCheckoutRef,
}));

const { POST } = await import("@/app/api/billing/paddle/webhook/route");

const SECRET = "pdl_ntfset_test_secret_key";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222";
const ROUTE_URL = "http://localhost/api/billing/paddle/webhook";
const PRICE_ID = "pri_pro_month";

function rawBody(overrides: Record<string, unknown> = {}, dataOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: "evt_1",
    event_type: "subscription.created",
    occurred_at: "2026-09-20T10:00:00.000Z",
    data: {
      id: "sub_1",
      status: "active",
      customer_id: "ctm_1",
      current_billing_period: { ends_at: "2026-10-20T00:00:00Z" },
      items: [{ price: { id: PRICE_ID }, quantity: 1 }],
      custom_data: { checkoutRef: "ref_abc" },
      ...dataOverrides,
    },
    ...overrides,
  });
}

function signedHeaders(body: string, secret = SECRET): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  return { "content-type": "application/json", "Paddle-Signature": `ts=${ts};h1=${digest}` };
}

function post(body: string, headers: Record<string, string> = signedHeaders(body)): Promise<Response> {
  return POST(new Request(ROUTE_URL, { method: "POST", headers, body }));
}

const STORED_SUBSCRIPTION: SubscriptionState = {
  tenantId: TENANT_ID,
  paddleCustomerId: "ctm_1",
  paddleSubscriptionId: "sub_1",
  tierId: "starter",
  billingCycle: "month",
  status: "active",
  currentPeriodEndsAt: "2026-10-20T00:00:00Z",
  scheduledChange: null,
  pastDueSince: null,
  lastEventOccurredAt: "2026-09-19T10:00:00.000Z",
  manualEntitlementTier: null,
  manualEntitlementNote: null,
};

beforeEach(() => {
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  // The route resolves a tier from the price ID via the plans config, which
  // reads these env vars — set here so no assertion depends on the
  // developer's own .env.local.
  vi.stubEnv("PADDLE_PRICE_STARTER_MONTH", "pri_starter_month");
  vi.stubEnv("PADDLE_PRICE_PRO_MONTH", PRICE_ID);
  vi.stubEnv("PADDLE_PRICE_ADVANCED_MONTH", "pri_advanced_month");
  vi.stubEnv("PADDLE_PRICE_STARTER_YEAR", "");
  vi.stubEnv("PADDLE_PRICE_PRO_YEAR", "");
  vi.stubEnv("PADDLE_PRICE_ADVANCED_YEAR", "");

  mockFindByPaddleSubscriptionId.mockResolvedValue(null);
  mockUpsertFromState.mockResolvedValue(undefined);
  mockRecordEvent.mockResolvedValue("recorded");
  mockMarkEventOutcome.mockResolvedValue(undefined);
  mockConsumeCheckoutRef.mockResolvedValue({ tenantId: TENANT_ID, userId: "user-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockFindByPaddleSubscriptionId.mockReset();
  mockUpsertFromState.mockReset();
  mockRecordEvent.mockReset();
  mockMarkEventOutcome.mockReset();
  mockConsumeCheckoutRef.mockReset();
});

describe("POST /api/billing/paddle/webhook — signature gate", () => {
  it("accepts a genuinely signed event", async () => {
    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).toHaveBeenCalledTimes(1);
  });

  it("rejects a body altered after signing and processes nothing", async () => {
    // Arrange
    const body = rawBody();
    const headers = signedHeaders(body);

    // Act
    const response = await post(rawBody({ event_id: "evt_forged" }), headers);

    // Assert
    expect(response.status).toBe(401);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("rejects a request with no Paddle-Signature header", async () => {
    // Act
    const response = await post(rawBody(), { "content-type": "application/json" });

    // Assert
    expect(response.status).toBe(401);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("rejects a signature made with the wrong secret", async () => {
    // Arrange
    const body = rawBody();

    // Act
    const response = await post(body, signedHeaders(body, "pdl_ntfset_someone_elses_key"));

    // Assert
    expect(response.status).toBe(401);
  });

  it("rejects a stale (replayed) timestamp", async () => {
    // Arrange
    const body = rawBody();
    const staleTs = Math.floor(Date.now() / 1000) - 60 * 60;
    const digest = createHmac("sha256", SECRET).update(`${staleTs}:${body}`).digest("hex");

    // Act
    const response = await post(body, {
      "content-type": "application/json",
      "Paddle-Signature": `ts=${staleTs};h1=${digest}`,
    });

    // Assert
    expect(response.status).toBe(401);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("fails closed with a 500 when PADDLE_WEBHOOK_SECRET is not configured", async () => {
    // Arrange
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(500);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/paddle/webhook — idempotency and ordering", () => {
  it("records the event before doing any work", async () => {
    // Act
    await post(rawBody());

    // Assert
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt_1", eventType: "subscription.created" }),
    );
  });

  it("is a no-op for an event_id it has already seen", async () => {
    // Arrange
    mockRecordEvent.mockResolvedValue("duplicate");

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("never regresses state on an event older than the stored one", async () => {
    // Arrange
    mockFindByPaddleSubscriptionId.mockResolvedValue({
      ...STORED_SUBSCRIPTION,
      tierId: "pro",
      lastEventOccurredAt: "2026-09-21T10:00:00.000Z",
    });

    // Act
    const response = await post(rawBody({ event_type: "subscription.updated" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "stale", null);
  });

  it("returns 2xx without recording an event type it does not handle", async () => {
    // Act
    const response = await post(rawBody({ event_type: "transaction.completed" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid body with a 400", async () => {
    // Act
    const response = await post(JSON.stringify({ event_type: "subscription.created" }));

    // Assert
    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON at all with a 400", async () => {
    // Act
    const response = await post("not-json");

    // Assert
    expect(response.status).toBe(400);
  });
});

describe("POST /api/billing/paddle/webhook — tenant resolution", () => {
  it("resolves the tenant from the server-issued checkout ref on a first event", async () => {
    // Act
    await post(rawBody());

    // Assert
    expect(mockConsumeCheckoutRef).toHaveBeenCalledWith("ref_abc");
    expect(mockUpsertFromState).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, tierId: "pro", status: "active" }),
    );
  });

  it("grants nothing when the checkout ref is unknown, expired or already invalid", async () => {
    // Arrange — the repository is the single authority on "is this ref usable".
    mockConsumeCheckoutRef.mockResolvedValue(null);

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "ignored", "unresolved_tenant");
  });

  it("grants nothing when custom_data carries no checkout ref at all", async () => {
    // Act
    const response = await post(rawBody({}, { custom_data: {} }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockConsumeCheckoutRef).not.toHaveBeenCalled();
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("never trusts a raw tenantId in custom_data", async () => {
    // Arrange — exactly what a signed-in user could tamper with pre-T59.
    const body = rawBody({}, { custom_data: { tenantId: OTHER_TENANT_ID } });

    // Act
    const response = await post(body);

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("ignores the checkout ref's tenant when the Paddle subscription is already known", async () => {
    // Arrange — a later event on a stored subscription resolves from the row,
    // so a stolen/replayed ref cannot move a subscription to another tenant.
    mockFindByPaddleSubscriptionId.mockResolvedValue(STORED_SUBSCRIPTION);
    mockConsumeCheckoutRef.mockResolvedValue({ tenantId: OTHER_TENANT_ID, userId: "attacker" });

    // Act
    await post(rawBody({ event_id: "evt_2", event_type: "subscription.updated" }));

    // Assert
    expect(mockConsumeCheckoutRef).not.toHaveBeenCalled();
    expect(mockUpsertFromState).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
  });

  it("grants nothing for a price ID that is not in our plans config", async () => {
    // Act
    const response = await post(rawBody({}, { items: [{ price: { id: "pri_someone_elses_product" } }] }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "ignored", "unknown_price_id");
  });
});

describe("POST /api/billing/paddle/webhook — failures", () => {
  it("returns 500 when persisting the new state fails, so Paddle retries", async () => {
    // Arrange
    mockUpsertFromState.mockRejectedValue(new Error("db down"));

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(500);
  });

  it("logs no customer email, amount or payload body", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpsertFromState.mockRejectedValue(new Error("db down"));

    // Act
    await post(rawBody({}, { custom_data: { checkoutRef: "ref_abc" } }));

    // Assert
    const logged = errorSpy.mock.calls.flat().map((entry) => JSON.stringify(entry)).join(" ");
    expect(logged).not.toContain("ctm_1");
    expect(logged).not.toContain("custom_data");
  });

  it("exposes only a POST handler", async () => {
    // Act
    const routeModule = await import("@/app/api/billing/paddle/webhook/route");

    // Assert
    expect(Object.keys(routeModule).filter((key) => ["GET", "PUT", "PATCH", "DELETE"].includes(key))).toEqual([]);
    expect(routeModule.runtime).toBe("nodejs");
  });
});
