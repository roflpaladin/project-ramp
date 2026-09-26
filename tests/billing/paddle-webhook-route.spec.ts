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

import { PADDLE_WEBHOOK_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const {
  mockFindByPaddleSubscriptionId,
  mockFindByTenantId,
  mockUpsertFromState,
  mockRecordEvent,
  mockMarkEventOutcome,
  mockConsumeCheckoutRef,
  mockRpc,
} = vi.hoisted(() => ({
  mockFindByPaddleSubscriptionId: vi.fn(),
  mockFindByTenantId: vi.fn(),
  mockUpsertFromState: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockMarkEventOutcome: vi.fn(),
  mockConsumeCheckoutRef: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/lib/billing/subscription-repository", () => ({
  findByPaddleSubscriptionId: mockFindByPaddleSubscriptionId,
  findByTenantId: mockFindByTenantId,
  upsertFromState: mockUpsertFromState,
  recordEvent: mockRecordEvent,
  markEventOutcome: mockMarkEventOutcome,
  consumeCheckoutRef: mockConsumeCheckoutRef,
}));

// Only lib/rate-limit-durable.ts's own askStore() calls this — every other
// Supabase access in the request path goes through the fully-mocked
// subscription-repository above. RATE_LIMIT_STORE stays "memory"
// (vitest.config.ts's default) for every test except the fallback one
// below, so this mock is inert everywhere else.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
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

function post(
  body: string,
  headers: Record<string, string> = signedHeaders(body),
  ip?: string,
): Promise<Response> {
  // process.env.VERCEL is unset in this test run, so clientIp() (lib/client-ip.ts)
  // reads the plain x-forwarded-for fallback, not the platform header.
  const requestHeaders = ip ? { ...headers, "x-forwarded-for": ip } : headers;
  return POST(new Request(ROUTE_URL, { method: "POST", headers: requestHeaders, body }));
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
  resetRateLimiterForTests();
  mockRpc.mockReset();
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
  mockFindByTenantId.mockResolvedValue(null);
  // The conditional write reports what the DATABASE decided: 'written',
  // 'stale' (its ordering guard refused) or 'subscription_conflict' (the
  // tenant already has a different live subscription).
  mockUpsertFromState.mockResolvedValue("written");
  mockRecordEvent.mockResolvedValue("recorded");
  mockMarkEventOutcome.mockResolvedValue(undefined);
  mockConsumeCheckoutRef.mockResolvedValue({ tenantId: TENANT_ID, userId: "user-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockFindByPaddleSubscriptionId.mockReset();
  mockFindByTenantId.mockReset();
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

  it("fails closed when PADDLE_WEBHOOK_SECRET is not configured, without telling the caller why", async () => {
    // Arrange
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Act
    const response = await post(rawBody());

    // Assert — externally indistinguishable from a bad signature (a probe
    // must not learn that our billing webhook is misconfigured); the real
    // reason is logged server-side.
    expect(response.status).toBe(401);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(mockUpsertFromState).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().map(String).join(" ")).toMatch(/PADDLE_WEBHOOK_SECRET/);
  });
});

// T62 follow-up (R7 tail). This route had no rate limit at all. Keyed per
// caller IP via lib/client-ip.ts, and deliberately generous
// (PADDLE_WEBHOOK_RATE_LIMIT = 300/min): Paddle itself is the real caller,
// retrying on its own schedule, and a 429 here must never be the reason a
// legitimate retry is lost.
describe("POST /api/billing/paddle/webhook — rate limiting", () => {
  it("processes every request under budget exactly as before (signature verification unaffected)", async () => {
    // Act — comfortably below the budget, using a fresh IP so this test
    // cannot be affected by any other test's calls.
    const response = await post(rawBody(), signedHeaders(rawBody()), "203.0.113.10");

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).toHaveBeenCalledTimes(1);
  });

  it("refuses a caller once its budget is spent, with a 429 and a Retry-After header, before verifying anything", async () => {
    // Arrange
    const ip = "203.0.113.20";
    for (let call = 0; call < PADDLE_WEBHOOK_RATE_LIMIT.limit; call += 1) {
      const body = rawBody({ event_id: `evt_budget_${call}` });
      const response = await post(body, signedHeaders(body), ip);
      expect(response.status).toBe(200);
    }

    // Act — an otherwise perfectly valid, genuinely signed request.
    const overBudgetBody = rawBody({ event_id: "evt_over_budget" });
    const overBudget = await post(overBudgetBody, signedHeaders(overBudgetBody), ip);

    // Assert
    expect(overBudget.status).toBe(429);
    expect(overBudget.headers.get("Retry-After")).not.toBeNull();
    const payload = await overBudget.json();
    expect(payload.ok).toBe(false);
    expect(mockRecordEvent).toHaveBeenCalledTimes(PADDLE_WEBHOOK_RATE_LIMIT.limit);
  });

  it("budgets are per caller IP: one IP at the cap does not throttle another", async () => {
    // Arrange
    const cappedIp = "203.0.113.30";
    for (let call = 0; call < PADDLE_WEBHOOK_RATE_LIMIT.limit; call += 1) {
      const body = rawBody({ event_id: `evt_cap_${call}` });
      await post(body, signedHeaders(body), cappedIp);
    }
    const overBudgetBody = rawBody({ event_id: "evt_cap_over" });
    const cappedOverBudget = await post(overBudgetBody, signedHeaders(overBudgetBody), cappedIp);
    expect(cappedOverBudget.status).toBe(429);

    // Act — a different IP, same instant.
    const otherIp = "203.0.113.31";
    const otherBody = rawBody({ event_id: "evt_other_ip" });
    const otherResponse = await post(otherBody, signedHeaders(otherBody), otherIp);

    // Assert
    expect(otherResponse.status).toBe(200);
  });

  it("falls back to the in-memory limiter (and still processes the event) when the shared store is unreachable", async () => {
    // Arrange — the store this test's OWN IP has never touched before, with
    // RATE_LIMIT_STORE switched away from the test default so
    // checkDurableRateLimit actually asks lib/supabase/admin, which this
    // file mocks to reject exactly like a database outage would.
    vi.stubEnv("RATE_LIMIT_STORE", "database");
    mockRpc.mockRejectedValue(new Error("fetch failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Act — neither fails open (unlimited) nor closed (every webhook
    // blocked by our own outage): a single request under the fallback's own
    // budget must still be processed normally.
    const response = await post(rawBody(), signedHeaders(rawBody()), "203.0.113.40");

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.flat().map(String).join(" ")).toMatch(/shared store unavailable/);
  });
});

describe("POST /api/billing/paddle/webhook — body size limit", () => {
  it("refuses an oversized body declared in Content-Length before reading it", async () => {
    // Arrange
    const body = rawBody();

    // Act
    const response = await post(body, { ...signedHeaders(body), "content-length": String(64 * 1024 + 1) });

    // Assert
    expect(response.status).toBe(413);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("refuses an oversized body even when Content-Length lies or is absent", async () => {
    // Arrange — the real bound is the bytes actually read.
    const padded = JSON.stringify({
      event_id: "evt_big",
      event_type: "subscription.created",
      occurred_at: "2026-09-20T10:00:00.000Z",
      filler: "x".repeat(64 * 1024),
    });

    // Act
    const response = await post(padded, signedHeaders(padded));

    // Assert
    expect(response.status).toBe(413);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("accepts a normal-sized body", async () => {
    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
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

  it("is a no-op for an event_id that was already processed to completion", async () => {
    // Arrange
    mockRecordEvent.mockResolvedValue("duplicate");

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("REPROCESSES a redelivered event whose previous attempt never completed", async () => {
    // Arrange — C1: the event row is inserted before the work is done, so a
    // crash mid-processing leaves it 'received'/'failed'. Treating Paddle's
    // retry as a duplicate would mean a paying customer is never
    // provisioned, permanently.
    mockRecordEvent.mockResolvedValue("reprocess");

    // Act
    const response = await post(rawBody());

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).toHaveBeenCalledTimes(1);
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "applied", null);
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

  it("returns 2xx without recording an event type it does not handle at all", async () => {
    // Act — "payout.created" is neither a subscription.* type nor one of
    // the T59-slice-2 record-only types (transaction.completed/customer.*).
    const response = await post(rawBody({ event_type: "payout.created" }));

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

// T59 slice 2 — transaction.completed/customer.created/customer.updated are
// recorded through the same idempotent gate, but must NEVER touch
// tenant_subscriptions, never throw, and always answer 2xx once the
// signature has verified (even when persisting the record itself fails —
// these carry no entitlement, so there is no unprovisioned customer at
// risk, unlike a subscription.* event).
describe("POST /api/billing/paddle/webhook — record-only events", () => {
  function recordOnlyBody(eventType: string, eventId = "evt_record_1") {
    return JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      occurred_at: "2026-09-20T10:00:00.000Z",
      data: { id: "ctm_1", email: "buyer@example.com" },
    });
  }

  it.each(["transaction.completed", "customer.created", "customer.updated"])(
    "records %s through the idempotent gate with outcome ignored/recorded_only, never touching tenant_subscriptions",
    async (eventType) => {
      // Act
      const response = await post(recordOnlyBody(eventType));

      // Assert
      expect(response.status).toBe(200);
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "evt_record_1", eventType }),
      );
      expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_record_1", "ignored", "recorded_only");
      expect(mockUpsertFromState).not.toHaveBeenCalled();
      expect(mockFindByPaddleSubscriptionId).not.toHaveBeenCalled();
      expect(mockFindByTenantId).not.toHaveBeenCalled();
    },
  );

  it("is a no-op (never re-marks the outcome) for a record-only event already processed to completion", async () => {
    // Arrange
    mockRecordEvent.mockResolvedValue("duplicate");

    // Act
    const response = await post(recordOnlyBody("transaction.completed"));

    // Assert
    expect(response.status).toBe(200);
    expect(mockMarkEventOutcome).not.toHaveBeenCalled();
  });

  it("still answers 200 when recording a record-only event fails — never a 500, never a retry storm", async () => {
    // Arrange
    mockRecordEvent.mockRejectedValue(new Error("db down"));

    // Act
    const response = await post(recordOnlyBody("customer.updated"));

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("logs a failure to record without throwing, and without touching entitlement", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockMarkEventOutcome.mockRejectedValueOnce(new Error("db down"));

    // Act
    const response = await post(recordOnlyBody("customer.created"));

    // Assert
    expect(response.status).toBe(200);
    expect(errorSpy.mock.calls.flat().map(String).join(" ")).toMatch(/failed to record/i);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/paddle/webhook — tenant resolution", () => {
  it("resolves the tenant from the server-issued checkout ref on a first event, binding it to this subscription", async () => {
    // Act
    await post(rawBody());

    // Assert
    expect(mockConsumeCheckoutRef).toHaveBeenCalledWith("ref_abc", "sub_1");
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

  it("never overwrites a tenant's LIVE subscription with a second one (H1)", async () => {
    // Arrange — the tenant already pays for sub_live; a second checkout
    // produces sub_2. Looking up only by paddle_subscription_id would find
    // nothing, and an upsert keyed on tenant_id would silently replace the
    // paid row (and its ordering anchor).
    mockFindByPaddleSubscriptionId.mockResolvedValue(null);
    mockFindByTenantId.mockResolvedValue({ ...STORED_SUBSCRIPTION, paddleSubscriptionId: "sub_live" });

    // Act
    const response = await post(rawBody({}, { id: "sub_2" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "ignored", "duplicate_subscription");
  });

  it("logs the refused second subscription without any customer detail", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindByTenantId.mockResolvedValue({ ...STORED_SUBSCRIPTION, paddleSubscriptionId: "sub_live" });

    // Act
    await post(rawBody({}, { id: "sub_2" }));

    // Assert
    const logged = errorSpy.mock.calls.flat().map((entry) => JSON.stringify(entry)).join(" ");
    expect(logged).toContain("duplicate_subscription");
    expect(logged).not.toContain("ctm_1");
  });

  it("does not let a LATE event for an old subscription clobber the live one (H1)", async () => {
    // Arrange — sub_old was replaced by sub_live; its trailing 'canceled'
    // arrives afterwards, carrying the original checkout ref.
    mockFindByPaddleSubscriptionId.mockResolvedValue(null);
    mockFindByTenantId.mockResolvedValue({ ...STORED_SUBSCRIPTION, paddleSubscriptionId: "sub_live" });

    // Act
    const response = await post(
      rawBody({ event_type: "subscription.canceled" }, { id: "sub_old", status: "canceled" }),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).not.toHaveBeenCalled();
  });

  it("DOES replace a genuinely canceled subscription when the tenant subscribes again", async () => {
    // Arrange
    mockFindByPaddleSubscriptionId.mockResolvedValue(null);
    mockFindByTenantId.mockResolvedValue({
      ...STORED_SUBSCRIPTION,
      paddleSubscriptionId: "sub_old",
      status: "canceled",
    });

    // Act
    const response = await post(rawBody({}, { id: "sub_2" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockUpsertFromState).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, paddleSubscriptionId: "sub_2", status: "active" }),
    );
  });

  it("carries a manual entitlement across that replacement — an invoice-paying tenant never loses it", async () => {
    // Arrange
    mockFindByPaddleSubscriptionId.mockResolvedValue(null);
    mockFindByTenantId.mockResolvedValue({
      ...STORED_SUBSCRIPTION,
      paddleSubscriptionId: "sub_old",
      status: "canceled",
      manualEntitlementTier: "enterprise",
      manualEntitlementNote: "Invoiced annually",
    });

    // Act
    await post(rawBody({}, { id: "sub_2" }));

    // Assert
    expect(mockUpsertFromState).toHaveBeenCalledWith(
      expect.objectContaining({ manualEntitlementTier: "enterprise", manualEntitlementNote: "Invoiced annually" }),
    );
  });

  it("does not look up by tenant when the subscription is already known", async () => {
    // Arrange
    mockFindByPaddleSubscriptionId.mockResolvedValue(STORED_SUBSCRIPTION);

    // Act
    await post(rawBody({ event_type: "subscription.updated" }));

    // Assert
    expect(mockFindByTenantId).not.toHaveBeenCalled();
    expect(mockUpsertFromState).toHaveBeenCalledTimes(1);
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

describe("POST /api/billing/paddle/webhook — the database's own ordering guard", () => {
  it("reports an event the database refused as out-of-order as stale, never applied", async () => {
    // Arrange — H2: two concurrent deliveries can both pass the in-memory
    // staleness check, so the final word belongs to the conditional write.
    mockFindByPaddleSubscriptionId.mockResolvedValue(STORED_SUBSCRIPTION);
    mockUpsertFromState.mockResolvedValue("stale");

    // Act
    const response = await post(rawBody({ event_id: "evt_late", event_type: "subscription.updated" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_late", "stale", "rejected_by_ordering_guard");
  });

  it("reports an accepted write as applied", async () => {
    // Arrange
    mockFindByPaddleSubscriptionId.mockResolvedValue(STORED_SUBSCRIPTION);
    mockUpsertFromState.mockResolvedValue("written");

    // Act
    await post(rawBody({ event_id: "evt_ok", event_type: "subscription.updated" }));

    // Assert
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_ok", "applied", null);
  });

  it("records a conflict the DATABASE caught as ignored/duplicate_subscription", async () => {
    // Arrange — the app-level guard passed (no row existed when it looked),
    // but a concurrent first event for another subscription got there
    // first. The write is refused inside the same statement, and this event
    // must not be recorded as applied.
    mockUpsertFromState.mockResolvedValue("subscription_conflict");

    // Act
    const response = await post(rawBody({ event_id: "evt_race" }));

    // Assert
    expect(response.status).toBe(200);
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_race", "ignored", "duplicate_subscription");
  });

  it("logs a database-caught conflict at error level, with no customer detail", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpsertFromState.mockResolvedValue("subscription_conflict");

    // Act
    await post(rawBody({ event_id: "evt_race" }));

    // Assert
    const logged = errorSpy.mock.calls.flat().map((entry) => JSON.stringify(entry)).join(" ");
    expect(logged).toContain("duplicate_subscription");
    expect(logged).not.toContain("ctm_1");
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

  it("marks the event failed so Paddle's retry is reprocessed rather than deduped away", async () => {
    // Arrange
    mockUpsertFromState.mockRejectedValue(new Error("db down"));

    // Act
    await post(rawBody());

    // Assert
    expect(mockMarkEventOutcome).toHaveBeenCalledWith("evt_1", "failed", expect.any(String));
  });

  it("still answers 500 when even marking the event failed does not work", async () => {
    // Arrange — best-effort bookkeeping must never swallow the 5xx that
    // makes Paddle retry.
    mockUpsertFromState.mockRejectedValue(new Error("db down"));
    mockMarkEventOutcome.mockRejectedValue(new Error("db down too"));

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
