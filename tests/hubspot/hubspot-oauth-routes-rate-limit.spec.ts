// Sprint 10, Ticket 52 code-review fix (MEDIUM) — server-side rate limiting
// on the HubSpot OAuth start + callback routes. DB-FREE, matching
// tests/security/onboarding-rate-limit.spec.ts's and
// tests/security/waitlist-rate-limit.spec.ts's convention: requireSeller is
// mocked to a fixed seller identity, and every downstream dependency that
// would otherwise touch the network or the DB (signOAuthState/
// verifyOAuthState are real — pure functions, no I/O — exchangeCodeForTokens
// and saveTenantTokens are mocked) so only the checkRateLimit branch inside
// each route is actually under test. The limiter itself (lib/rate-limit.ts)
// is NOT mocked — it's a real in-memory fixed window in this same process.
// Budgets are keyed per seller userId, so each test uses its own unique
// userId to keep windows isolated from the other tests in this file.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { HUBSPOT_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";
import type { SellerSession } from "@/lib/plans/require-seller";

const { currentSession, exchangeCodeForTokens, saveTenantTokens } = vi.hoisted(() => ({
  currentSession: { value: null as SellerSession | null },
  exchangeCodeForTokens: vi.fn(),
  saveTenantTokens: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSession.value),
}));
vi.mock("@/lib/hubspot/token-exchange", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
}));
vi.mock("@/lib/hubspot/token-store", () => ({
  saveTenantTokens: (...args: unknown[]) => saveTenantTokens(...args),
}));

const { GET: startGET } = await import("@/app/api/integrations/hubspot/oauth/start/route");
const { GET: callbackGET } = await import("@/app/api/integrations/hubspot/oauth/callback/route");
const { signOAuthState } = await import("@/lib/hubspot/oauth-state");

const APP_ENCRYPTION_KEY = "d".repeat(64);

function makeSession(userId: string): SellerSession {
  return {
    client: {} as SellerSession["client"],
    userId,
    email: null,
    tenantId: "7e520000-0000-4000-8000-000000000052",
  };
}

function locationErrorCode(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams.get("error");
}

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", APP_ENCRYPTION_KEY);
  vi.stubEnv("HUBSPOT_CLIENT_ID", "test-client-id");
  vi.stubEnv("HUBSPOT_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://getbrava.tech");
  exchangeCodeForTokens.mockReset();
  saveTenantTokens.mockReset();
});

describe("GET /api/integrations/hubspot/oauth/start — per-seller rate limiting (T52 code review)", () => {
  it("allows the budgeted calls, then redirects with ?error=rate_limited", async () => {
    currentSession.value = makeSession("rate-limit-oauth-start-user");

    for (let call = 0; call < HUBSPOT_OAUTH_RATE_LIMIT.limit; call += 1) {
      const response = await startGET(new Request("https://getbrava.tech/api/integrations/hubspot/oauth/start"));
      expect(response.headers.get("location")).toContain("app.hubspot.com/oauth/authorize");
    }

    const overBudget = await startGET(
      new Request("https://getbrava.tech/api/integrations/hubspot/oauth/start"),
    );
    expect(locationErrorCode(overBudget)).toBe("rate_limited");
  });

  it("budgets are per seller: one seller at the cap does not throttle another", async () => {
    currentSession.value = makeSession("rate-limit-oauth-start-capped");
    for (let call = 0; call < HUBSPOT_OAUTH_RATE_LIMIT.limit; call += 1) {
      await startGET(new Request("https://getbrava.tech/api/integrations/hubspot/oauth/start"));
    }
    const cappedOverBudget = await startGET(
      new Request("https://getbrava.tech/api/integrations/hubspot/oauth/start"),
    );
    expect(locationErrorCode(cappedOverBudget)).toBe("rate_limited");

    currentSession.value = makeSession("rate-limit-oauth-start-other");
    const otherResponse = await startGET(
      new Request("https://getbrava.tech/api/integrations/hubspot/oauth/start"),
    );
    expect(otherResponse.headers.get("location")).toContain("app.hubspot.com/oauth/authorize");
  });
});

describe("GET /api/integrations/hubspot/oauth/callback — per-seller rate limiting (T52 code review)", () => {
  function callbackRequest(seller: SellerSession): Request {
    const state = signOAuthState(seller.tenantId!);
    const url = new URL("https://getbrava.tech/api/integrations/hubspot/oauth/callback");
    url.searchParams.set("state", state);
    url.searchParams.set("code", "auth-code");
    return new Request(url);
  }

  it("allows the budgeted calls, then redirects with ?error=rate_limited before exchanging the code", async () => {
    const seller = makeSession("rate-limit-oauth-callback-user");
    currentSession.value = seller;
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 1800,
    });
    saveTenantTokens.mockResolvedValue(undefined);

    for (let call = 0; call < HUBSPOT_OAUTH_RATE_LIMIT.limit; call += 1) {
      const response = await callbackGET(callbackRequest(seller));
      expect(response.headers.get("location")).toContain("connected=1");
    }
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(HUBSPOT_OAUTH_RATE_LIMIT.limit);

    const overBudget = await callbackGET(callbackRequest(seller));
    expect(locationErrorCode(overBudget)).toBe("rate_limited");
    // The refusal happens before the token exchange — no extra call burned.
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(HUBSPOT_OAUTH_RATE_LIMIT.limit);
  });
});
