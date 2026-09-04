// Sprint 11, Ticket 55 — unit coverage for lib/salesforce/token-exchange.ts.
// Mirrors tests/hubspot/token-exchange.spec.ts's fake-fetchImpl-DI pattern
// (never a real network call), plus Salesforce-specific coverage this
// ticket's brief calls out: the PKCE code_verifier on the authorization_code
// grant, instance_url capture on both grants, and a missing `expires_in`
// (Salesforce's token response doesn't always include one) falling back to
// `null`, not throwing and not defaulting silently to a wrong number here —
// the actual fallback TTL math lives in lib/salesforce/get-client.ts, not
// this module (see that file's own tests).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeRefreshToken,
  SalesforceOAuthError,
  SalesforceReauthRequiredError,
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

const AUTH_CODE_TOKEN_BODY = {
  access_token: "access-123",
  refresh_token: "refresh-456",
  instance_url: "https://my-dev-org.my.salesforce.com",
  token_type: "Bearer",
  expires_in: 7200,
};

describe("exchangeCodeForTokens", () => {
  it("posts the authorization code + PKCE code_verifier and returns the parsed token set on success", async () => {
    const fetchImpl = fakeFetch(jsonResponse(AUTH_CODE_TOKEN_BODY));
    const result = await exchangeCodeForTokens("auth-code", "the-code-verifier", fetchImpl);

    expect(result).toEqual({
      accessToken: "access-123",
      refreshToken: "refresh-456",
      instanceUrl: "https://my-dev-org.my.salesforce.com",
      expiresInSeconds: 7200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://login.salesforce.com/services/oauth2/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("code=auth-code");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code_verifier=the-code-verifier");
  });

  it("respects SALESFORCE_LOGIN_BASE_URL when set", async () => {
    vi.stubEnv("SALESFORCE_LOGIN_BASE_URL", "https://test.salesforce.com");
    const fetchImpl = fakeFetch(jsonResponse(AUTH_CODE_TOKEN_BODY));
    await exchangeCodeForTokens("auth-code", "verifier", fetchImpl);

    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://test.salesforce.com/services/oauth2/token");
  });

  it("falls back to null (not a number, not a throw) when expires_in is absent", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ ...AUTH_CODE_TOKEN_BODY, expires_in: undefined }));
    const result = await exchangeCodeForTokens("auth-code", "verifier", fetchImpl);
    expect(result.expiresInSeconds).toBeNull();
  });

  it("throws a SalesforceOAuthError with a safe app-authored message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(
      new Response("<html>raw internal html the caller must never see</html>", { status: 400 }),
    );
    await expect(exchangeCodeForTokens("bad-code", "verifier", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SalesforceOAuthError);
      expect((error as SalesforceOAuthError).message).not.toContain("raw internal html");
      return true;
    });
  });

  it("throws a SalesforceOAuthError when the network call itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens("auth-code", "verifier", fetchImpl)).rejects.toBeInstanceOf(
      SalesforceOAuthError,
    );
  });

  it("throws a SalesforceOAuthError on a 2xx response missing refresh_token", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ ...AUTH_CODE_TOKEN_BODY, refresh_token: undefined }));
    await expect(exchangeCodeForTokens("auth-code", "verifier", fetchImpl)).rejects.toBeInstanceOf(
      SalesforceOAuthError,
    );
  });

  it("throws a SalesforceOAuthError on a 2xx response missing instance_url", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ ...AUTH_CODE_TOKEN_BODY, instance_url: undefined }));
    await expect(exchangeCodeForTokens("auth-code", "verifier", fetchImpl)).rejects.toBeInstanceOf(
      SalesforceOAuthError,
    );
  });
});

describe("refreshAccessToken", () => {
  const REFRESH_TOKEN_BODY = {
    access_token: "access-789",
    instance_url: "https://my-dev-org.my.salesforce.com",
    token_type: "Bearer",
    // No refresh_token, no expires_in — Salesforce's typical refresh response shape.
  };

  it("posts the refresh token (no code_verifier) and returns the parsed token set", async () => {
    const fetchImpl = fakeFetch(jsonResponse(REFRESH_TOKEN_BODY));
    const result = await refreshAccessToken("refresh-456", fetchImpl);

    expect(result).toEqual({
      accessToken: "access-789",
      refreshToken: null,
      instanceUrl: "https://my-dev-org.my.salesforce.com",
      expiresInSeconds: null,
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://login.salesforce.com/services/oauth2/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=refresh-456");
    expect(String(init.body)).not.toContain("code_verifier");
  });

  it("captures a rotated refresh_token when Salesforce does return one", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ ...REFRESH_TOKEN_BODY, refresh_token: "rotated-refresh" }));
    const result = await refreshAccessToken("refresh-456", fetchImpl);
    expect(result.refreshToken).toBe("rotated-refresh");
  });

  it("throws SalesforceReauthRequiredError (a distinct, closed error) when Salesforce rejects with invalid_grant", async () => {
    const fetchImpl = fakeFetch(
      jsonResponse({ error: "invalid_grant", error_description: "expired access/refresh token" }, 400),
    );
    await expect(refreshAccessToken("dead-refresh-token", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SalesforceReauthRequiredError);
      expect(error).toBeInstanceOf(SalesforceOAuthError); // subclass, so a generic catch still works
      expect((error as SalesforceReauthRequiredError).message).not.toContain("expired access/refresh token");
      return true;
    });
  });

  it("throws a plain SalesforceOAuthError (not SalesforceReauthRequiredError) on a non-invalid_grant failure", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ error: "server_error" }, 500));
    await expect(refreshAccessToken("refresh-456", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SalesforceOAuthError);
      expect(error).not.toBeInstanceOf(SalesforceReauthRequiredError);
      return true;
    });
  });

  it("throws a plain SalesforceOAuthError when the failure body isn't JSON at all", async () => {
    const fetchImpl = fakeFetch(new Response("not json", { status: 400 }));
    await expect(refreshAccessToken("refresh-456", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SalesforceOAuthError);
      expect(error).not.toBeInstanceOf(SalesforceReauthRequiredError);
      return true;
    });
  });
});

describe("revokeRefreshToken", () => {
  it("POSTs the revoke endpoint with the token param and resolves on a 2xx/204 response", async () => {
    const fetchImpl = fakeFetch(new Response(null, { status: 200 }));
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).resolves.toBeUndefined();

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://login.salesforce.com/services/oauth2/revoke");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe("token=refresh-456");
  });

  it("throws a SalesforceOAuthError with a safe message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(new Response("raw error text", { status: 500 }));
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SalesforceOAuthError);
      expect((error as SalesforceOAuthError).message).not.toContain("raw error text");
      return true;
    });
  });

  it("throws a SalesforceOAuthError when the network call itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).rejects.toBeInstanceOf(SalesforceOAuthError);
  });
});
