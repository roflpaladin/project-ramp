// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Unit
// coverage for lib/billing/paddle-portal.ts, the one place that calls
// Paddle's Customer Portal API. Fetch is injected (no network), mirroring
// tests/hubspot/get-client.spec.ts's own convention for
// lib/hubspot/token-exchange.ts. Never calls the real Paddle API.

import { describe, expect, it } from "vitest";

import { createBillingPortalSession, PaddlePortalError } from "@/lib/billing/paddle-portal";

const API_BASE_URL = "https://sandbox-api.paddle.com";
const API_KEY = "pdl_sandbox_apikey_secret_value";
const CUSTOMER_ID = "ctm_1";
const SUBSCRIPTION_ID = "sub_1";
const PORTAL_URL = "https://customer-portal.paddle.com/cpl_abc?token=pga_secrettoken";

function input(overrides: Partial<Parameters<typeof createBillingPortalSession>[0]> = {}) {
  return {
    apiBaseUrl: API_BASE_URL,
    apiKey: API_KEY,
    customerId: CUSTOMER_ID,
    subscriptionId: SUBSCRIPTION_ID,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function portalBody(overview: string = PORTAL_URL) {
  return { data: { id: "cpls_1", customer_id: CUSTOMER_ID, urls: { general: { overview } } } };
}

describe("createBillingPortalSession — happy path", () => {
  it("POSTs the subscription_ids array and returns the overview URL", async () => {
    // Arrange
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, portalBody());
    }) as typeof fetch;

    // Act
    const url = await createBillingPortalSession(input(), fetchImpl);

    // Assert
    expect(url).toBe(PORTAL_URL);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_BASE_URL}/customers/${CUSTOMER_ID}/portal-sessions`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ subscription_ids: [SUBSCRIPTION_ID] });
  });

  it("omits subscription_ids entirely when subscriptionId is null (a canceled subscription's general/invoices view — code review fix, MEDIUM)", async () => {
    // Arrange
    const calls: { init: RequestInit }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push({ init });
      return jsonResponse(200, portalBody());
    }) as typeof fetch;

    // Act
    await createBillingPortalSession(input({ subscriptionId: null }), fetchImpl);

    // Assert
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty("subscription_ids");
    expect(body).toEqual({});
  });

  it("sends the API key as a Bearer token, never anywhere else", async () => {
    // Arrange
    let sentHeaders: HeadersInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentHeaders = init.headers;
      return jsonResponse(200, portalBody());
    }) as typeof fetch;

    // Act
    await createBillingPortalSession(input(), fetchImpl);

    // Assert
    expect((sentHeaders as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
  });
});

describe("createBillingPortalSession — failure paths never leak the API key or the portal URL", () => {
  it("throws on a non-2xx response, with a fixed message (never the response body)", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("internal details", { status: 500 })) as typeof fetch;

    // Act + Assert
    await expect(createBillingPortalSession(input(), fetchImpl)).rejects.toThrow(PaddlePortalError);
    await expect(createBillingPortalSession(input(), fetchImpl)).rejects.toThrow(/status 500/);
  });

  it("throws on a response that is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as typeof fetch;

    // Act + Assert
    await expect(createBillingPortalSession(input(), fetchImpl)).rejects.toThrow(PaddlePortalError);
  });

  it("throws when the overview URL is missing from an otherwise well-formed response", async () => {
    // Arrange
    const fetchImpl = (async () => jsonResponse(200, { data: { urls: { general: {} } } })) as typeof fetch;

    // Act + Assert
    const error = await createBillingPortalSession(input(), fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(PaddlePortalError);
    expect(String(error.message)).not.toContain(API_KEY);
  });

  it("throws when the returned URL is not https", async () => {
    // Arrange
    const fetchImpl = (async () => jsonResponse(200, portalBody("http://customer-portal.paddle.com/cpl_abc"))) as typeof fetch;

    // Act + Assert
    await expect(createBillingPortalSession(input(), fetchImpl)).rejects.toThrow(PaddlePortalError);
  });

  it("throws when the returned host merely ends with the substring 'paddle.com' (e.g. notpaddle.com)", async () => {
    // Arrange — the exact pitfall a naive `.endsWith("paddle.com")` check would miss.
    const fetchImpl = (async () => jsonResponse(200, portalBody("https://notpaddle.com/cpl_abc"))) as typeof fetch;

    // Act + Assert
    await expect(createBillingPortalSession(input(), fetchImpl)).rejects.toThrow(PaddlePortalError);
  });

  it("accepts a genuine paddle.com subdomain host", async () => {
    // Arrange
    const fetchImpl = (async () => jsonResponse(200, portalBody("https://customer-portal.paddle.com/cpl_abc"))) as typeof fetch;

    // Act
    const url = await createBillingPortalSession(input(), fetchImpl);

    // Assert
    expect(url).toBe("https://customer-portal.paddle.com/cpl_abc");
  });

  it("throws a safe, fixed message on a network error/timeout, never the raw error's own detail leaking a secret", async () => {
    // Arrange — represents AbortSignal.timeout() firing: fetch rejects with a DOMException.
    const fetchImpl = (async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as typeof fetch;

    // Act
    const error = (await createBillingPortalSession(input(), fetchImpl).catch((e) => e)) as PaddlePortalError;

    // Assert
    expect(error).toBeInstanceOf(PaddlePortalError);
    expect(error.message).toMatch(/couldn't reach paddle/i);
    expect(error.message).not.toContain(API_KEY);
  });

  it("never includes the API key in any thrown message", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("", { status: 401 })) as typeof fetch;

    // Act
    const error = (await createBillingPortalSession(input(), fetchImpl).catch((e) => e)) as PaddlePortalError;

    // Assert
    expect(error.message).not.toContain(API_KEY);
  });
});
