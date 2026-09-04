// Sprint 11, Ticket 55 — server-side rate limiting on the Salesforce OAuth
// start + callback routes. Mirrors tests/hubspot/hubspot-oauth-routes-rate-limit.spec.ts's
// DB-free convention (requireSeller mocked to a fixed seller identity;
// exchangeCodeForTokens and saveTenantTokens mocked; signOAuthState/
// verifyOAuthState are real, pure functions). CRM_OAUTH_RATE_LIMIT
// (lib/rate-limit.ts) is the SAME shared budget HubSpot's routes use — see
// that constant's own header for why it was renamed/shared (T55). Budgets
// are keyed per seller userId, so each test uses its own unique userId to
// keep windows isolated from the other tests in this file (and from
// HubSpot's own rate-limit spec, which uses different userIds again).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { PKCE_COOKIE_NAME } from "@/lib/salesforce/pkce";
import type { SellerSession } from "@/lib/plans/require-seller";

const { currentSession, exchangeCodeForTokens, saveTenantTokens } = vi.hoisted(() => ({
  currentSession: { value: null as SellerSession | null },
  exchangeCodeForTokens: vi.fn(),
  saveTenantTokens: vi.fn(),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSession.value),
}));
vi.mock("@/lib/salesforce/token-exchange", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
}));
vi.mock("@/lib/crm-connections/token-store", () => ({
  saveTenantTokens: (...args: unknown[]) => saveTenantTokens(...args),
}));

const { GET: startGET } = await import("@/app/api/integrations/salesforce/oauth/start/route");
const { GET: callbackGET } = await import("@/app/api/integrations/salesforce/oauth/callback/route");
const { signOAuthState } = await import("@/lib/salesforce/oauth-state");

const APP_ENCRYPTION_KEY = "f".repeat(64);

function makeSession(userId: string): SellerSession {
  return {
    client: {} as SellerSession["client"],
    userId,
    email: null,
    tenantId: "7e550000-0000-4000-8000-000000000055",
  };
}

function locationErrorCode(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams.get("error");
}

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", APP_ENCRYPTION_KEY);
  vi.stubEnv("SALESFORCE_CLIENT_ID", "test-client-id");
  vi.stubEnv("SALESFORCE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://getbrava.tech");
  exchangeCodeForTokens.mockReset();
  saveTenantTokens.mockReset();
});

describe("GET /api/integrations/salesforce/oauth/start — per-seller rate limiting", () => {
  it("allows the budgeted calls, then redirects with ?error=sf_rate_limited", async () => {
    currentSession.value = makeSession("rate-limit-sf-start-user");

    for (let call = 0; call < CRM_OAUTH_RATE_LIMIT.limit; call += 1) {
      const response = await startGET(new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"));
      expect(response.headers.get("location")).toContain("login.salesforce.com/services/oauth2/authorize");
    }

    const overBudget = await startGET(
      new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"),
    );
    expect(locationErrorCode(overBudget)).toBe("sf_rate_limited");
  });

  it("budgets are per seller: one seller at the cap does not throttle another", async () => {
    currentSession.value = makeSession("rate-limit-sf-start-capped");
    for (let call = 0; call < CRM_OAUTH_RATE_LIMIT.limit; call += 1) {
      await startGET(new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"));
    }
    const cappedOverBudget = await startGET(
      new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"),
    );
    expect(locationErrorCode(cappedOverBudget)).toBe("sf_rate_limited");

    currentSession.value = makeSession("rate-limit-sf-start-other");
    const otherResponse = await startGET(
      new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"),
    );
    expect(otherResponse.headers.get("location")).toContain("login.salesforce.com/services/oauth2/authorize");
  });

  it("sets a PKCE verifier cookie scoped to the oauth path", async () => {
    currentSession.value = makeSession("rate-limit-sf-start-pkce");
    const response = await startGET(new Request("https://getbrava.tech/api/integrations/salesforce/oauth/start"));

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(PKCE_COOKIE_NAME);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("path=/api/integrations/salesforce/oauth");

    const authorizeUrl = new URL(response.headers.get("location")!);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
  });
});

describe("GET /api/integrations/salesforce/oauth/callback — per-seller rate limiting", () => {
  function callbackRequest(seller: SellerSession): Request {
    const state = signOAuthState(seller.tenantId!);
    const url = new URL("https://getbrava.tech/api/integrations/salesforce/oauth/callback");
    url.searchParams.set("state", state);
    url.searchParams.set("code", "auth-code");
    return new Request(url, { headers: { cookie: `${PKCE_COOKIE_NAME}=test-code-verifier` } });
  }

  it("allows the budgeted calls, then redirects with ?error=sf_rate_limited before exchanging the code", async () => {
    const seller = makeSession("rate-limit-sf-callback-user");
    currentSession.value = seller;
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      instanceUrl: "https://my-dev-org.my.salesforce.com",
      expiresInSeconds: 7200,
    });
    saveTenantTokens.mockResolvedValue(undefined);

    for (let call = 0; call < CRM_OAUTH_RATE_LIMIT.limit; call += 1) {
      const response = await callbackGET(callbackRequest(seller));
      expect(response.headers.get("location")).toContain("connected=salesforce");
    }
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(CRM_OAUTH_RATE_LIMIT.limit);

    const overBudget = await callbackGET(callbackRequest(seller));
    expect(locationErrorCode(overBudget)).toBe("sf_rate_limited");
    // The refusal happens before the token exchange — no extra call burned.
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(CRM_OAUTH_RATE_LIMIT.limit);
  });

  it("passes the PKCE code_verifier read from the cookie to exchangeCodeForTokens", async () => {
    const seller = makeSession("rate-limit-sf-callback-pkce");
    currentSession.value = seller;
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      instanceUrl: "https://my-dev-org.my.salesforce.com",
      expiresInSeconds: 7200,
    });
    saveTenantTokens.mockResolvedValue(undefined);

    await callbackGET(callbackRequest(seller));

    expect(exchangeCodeForTokens).toHaveBeenCalledWith("auth-code", "test-code-verifier");
  });

  it("redirects with ?error=sf_missing_verifier when the PKCE cookie is absent", async () => {
    const seller = makeSession("rate-limit-sf-callback-missing-verifier");
    currentSession.value = seller;
    const state = signOAuthState(seller.tenantId!);
    const url = new URL("https://getbrava.tech/api/integrations/salesforce/oauth/callback");
    url.searchParams.set("state", state);
    url.searchParams.set("code", "auth-code");

    const response = await callbackGET(new Request(url)); // no Cookie header at all

    expect(locationErrorCode(response)).toBe("sf_missing_verifier");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("clears the PKCE cookie on both success and failure redirects", async () => {
    const seller = makeSession("rate-limit-sf-callback-cookie-clear");
    currentSession.value = seller;
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      instanceUrl: "https://my-dev-org.my.salesforce.com",
      expiresInSeconds: 7200,
    });
    saveTenantTokens.mockResolvedValue(undefined);

    const successResponse = await callbackGET(callbackRequest(seller));
    const successSetCookie = successResponse.headers.get("set-cookie") ?? "";
    expect(successSetCookie).toContain(`${PKCE_COOKIE_NAME}=`);
    expect(successSetCookie).toMatch(/max-age=0/i);

    const state = signOAuthState(seller.tenantId!);
    const deniedUrl = new URL("https://getbrava.tech/api/integrations/salesforce/oauth/callback");
    deniedUrl.searchParams.set("error", "access_denied");
    deniedUrl.searchParams.set("state", state);
    const deniedResponse = await callbackGET(
      new Request(deniedUrl, { headers: { cookie: `${PKCE_COOKIE_NAME}=test-code-verifier` } }),
    );
    const deniedSetCookie = deniedResponse.headers.get("set-cookie") ?? "";
    expect(deniedSetCookie).toMatch(/max-age=0/i);
  });
});
