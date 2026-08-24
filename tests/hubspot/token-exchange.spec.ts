// Sprint 10, Ticket 52 — unit coverage for lib/hubspot/token-exchange.ts.
// A fake fetchImpl is injected (mirrors tests/plans/fetch-plan.spec.ts's
// fakeFetch pattern) so this never makes a real network call to HubSpot.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeCodeForTokens,
  HubSpotOAuthError,
  refreshAccessToken,
  revokeRefreshToken,
} from "@/lib/hubspot/token-exchange";

beforeEach(() => {
  vi.stubEnv("HUBSPOT_CLIENT_ID", "test-client-id");
  vi.stubEnv("HUBSPOT_CLIENT_SECRET", "test-client-secret");
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

const TOKEN_BODY = {
  access_token: "access-123",
  refresh_token: "refresh-456",
  expires_in: 1800,
};

describe("exchangeCodeForTokens", () => {
  it("posts the authorization code and returns the parsed token set on success", async () => {
    const fetchImpl = fakeFetch(jsonResponse(TOKEN_BODY));
    const result = await exchangeCodeForTokens("auth-code", fetchImpl);

    expect(result).toEqual({
      accessToken: "access-123",
      refreshToken: "refresh-456",
      expiresInSeconds: 1800,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("code=auth-code");
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });

  it("throws a HubSpotOAuthError with a safe app-authored message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(
      new Response("<html>raw internal html the caller must never see</html>", { status: 400 }),
    );
    await expect(exchangeCodeForTokens("bad-code", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HubSpotOAuthError);
      const message = (error as HubSpotOAuthError).message;
      expect(message).not.toContain("raw internal html");
      return true;
    });
  });

  it("throws a HubSpotOAuthError when the network call itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens("auth-code", fetchImpl)).rejects.toBeInstanceOf(HubSpotOAuthError);
  });

  it("throws a HubSpotOAuthError on a 2xx response with an unexpected body shape", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ oops: true }));
    await expect(exchangeCodeForTokens("auth-code", fetchImpl)).rejects.toBeInstanceOf(HubSpotOAuthError);
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh token and returns the parsed token set", async () => {
    const fetchImpl = fakeFetch(jsonResponse(TOKEN_BODY));
    const result = await refreshAccessToken("refresh-456", fetchImpl);

    expect(result).toEqual({
      accessToken: "access-123",
      refreshToken: "refresh-456",
      expiresInSeconds: 1800,
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=refresh-456");
  });

  it("throws a HubSpotOAuthError with a safe message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ message: "internal hubspot detail" }, 401));
    await expect(refreshAccessToken("expired-refresh", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HubSpotOAuthError);
      expect((error as HubSpotOAuthError).message).not.toContain("internal hubspot detail");
      return true;
    });
  });
});

describe("revokeRefreshToken", () => {
  it("DELETEs the refresh token endpoint and resolves on a 2xx/204 response", async () => {
    const fetchImpl = fakeFetch(new Response(null, { status: 204 }));
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).resolves.toBeUndefined();

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.hubapi.com/oauth/v1/refresh-tokens/refresh-456");
    expect(init.method).toBe("DELETE");
  });

  it("throws a HubSpotOAuthError with a safe message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(new Response("raw error text", { status: 500 }));
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HubSpotOAuthError);
      expect((error as HubSpotOAuthError).message).not.toContain("raw error text");
      return true;
    });
  });

  it("throws a HubSpotOAuthError when the network call itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(revokeRefreshToken("refresh-456", fetchImpl)).rejects.toBeInstanceOf(HubSpotOAuthError);
  });
});
