// Sprint 11, Ticket 55 — security-review follow-up. instance_url from the
// token response is persisted and later used as the base URL for
// Bearer-authenticated API calls, so a non-Salesforce value must be rejected
// at parse time (a poisoned value would be a durable SSRF primitive shipping
// the tenant's access token to an arbitrary host). Covers the validator
// directly plus the exchange-level behavior: a token response carrying a
// hostile instance_url fails the whole exchange.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeCodeForTokens,
  isValidSalesforceInstanceUrl,
  SalesforceOAuthError,
} from "@/lib/salesforce/token-exchange";

beforeEach(() => {
  vi.stubEnv("SALESFORCE_CLIENT_ID", "test-client-id");
  vi.stubEnv("SALESFORCE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("isValidSalesforceInstanceUrl", () => {
  it.each([
    "https://my-dev-org.my.salesforce.com",
    "https://na139.salesforce.com",
    "https://salesforce.com",
    "https://brava.develop.my.salesforce.com",
    "https://custom-domain.force.com",
  ])("accepts documented Salesforce instance host %s", (url) => {
    expect(isValidSalesforceInstanceUrl(url)).toBe(true);
  });

  it.each([
    "http://my-dev-org.my.salesforce.com", // https only
    "https://attacker.example",
    "https://salesforce.com.evil.example", // suffix spoof
    "https://xsalesforce.com", // no label boundary
    "https://evilforce.com", // no label boundary on force.com either
    "not-a-url",
    "",
  ])("rejects non-Salesforce or non-https value %s", (url) => {
    expect(isValidSalesforceInstanceUrl(url)).toBe(false);
  });
});

describe("exchangeCodeForTokens with a hostile instance_url", () => {
  it("throws SalesforceOAuthError instead of returning a token set", async () => {
    const fetchImpl = fakeFetch(
      jsonResponse({
        access_token: "access-123",
        refresh_token: "refresh-456",
        instance_url: "https://attacker.example",
        token_type: "Bearer",
        expires_in: 7200,
      }),
    );

    await expect(exchangeCodeForTokens("auth-code", "the-code-verifier", fetchImpl)).rejects.toBeInstanceOf(
      SalesforceOAuthError,
    );
  });
});
