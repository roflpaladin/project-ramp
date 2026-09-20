// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Coverage for
// lib/billing/paddle-server-env.ts. The founder's standing rule for
// anything Paddle-shaped is that the environment is NEVER silently
// defaulted (we must never run against the wrong Paddle account), so the
// assertion that matters most here is the negative one: an unset
// NEXT_PUBLIC_PADDLE_ENV yields no API host at all rather than a guess.

import { describe, expect, it, vi } from "vitest";

import { getPaddleApiBaseUrl, getPaddleApiKey, getPaddleWebhookSecret } from "@/lib/billing/paddle-server-env";

function envWith(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("getPaddleWebhookSecret", () => {
  it("returns the configured destination secret", () => {
    expect(getPaddleWebhookSecret(envWith({ PADDLE_WEBHOOK_SECRET: "pdl_ntfset_abc" }))).toBe("pdl_ntfset_abc");
  });

  it("returns null when unset, so the route can fail closed", () => {
    expect(getPaddleWebhookSecret(envWith({}))).toBeNull();
  });

  it("treats a blank value as unset", () => {
    expect(getPaddleWebhookSecret(envWith({ PADDLE_WEBHOOK_SECRET: "   " }))).toBeNull();
  });
});

describe("getPaddleApiKey", () => {
  it("returns the configured key", () => {
    expect(getPaddleApiKey(envWith({ PADDLE_API_KEY: "pdl_live_abc" }))).toBe("pdl_live_abc");
  });

  it("returns null when unset", () => {
    expect(getPaddleApiKey(envWith({}))).toBeNull();
  });
});

describe("getPaddleApiBaseUrl", () => {
  it("derives the sandbox host from NEXT_PUBLIC_PADDLE_ENV", () => {
    expect(getPaddleApiBaseUrl(envWith({ NEXT_PUBLIC_PADDLE_ENV: "sandbox" }))).toBe("https://sandbox-api.paddle.com");
  });

  it("derives the production host from NEXT_PUBLIC_PADDLE_ENV", () => {
    expect(getPaddleApiBaseUrl(envWith({ NEXT_PUBLIC_PADDLE_ENV: "production" }))).toBe("https://api.paddle.com");
  });

  it("returns null — never a default host — when the environment is unset", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleApiBaseUrl(envWith({}))).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("returns null for an environment value Paddle does not have", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleApiBaseUrl(envWith({ NEXT_PUBLIC_PADDLE_ENV: "staging" }))).toBeNull();

    errorSpy.mockRestore();
  });
});
