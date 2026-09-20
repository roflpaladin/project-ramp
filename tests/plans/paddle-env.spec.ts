// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Unit coverage for lib/billing/paddle-env.ts: the client-side
// Paddle environment/token pair the /pricing page's checkout overlay is
// initialized with. Same env-injectable, never-throws shape as
// tests/plans/stall-threshold.spec.ts, but with a deliberately different
// failure posture on the "unset" case — the founder's explicit instruction
// is "never silently default the environment", so unlike stall-threshold's
// numeric default, an unset NEXT_PUBLIC_PADDLE_ENV has NO fallback: it
// resolves to null (never a guessed 'sandbox'), logged loudly so a missing
// var is never mistaken for a working config in server logs.

import { describe, expect, it, vi } from "vitest";

import { getPaddleClientConfig } from "@/lib/billing/paddle-env";

function envWith(paddleEnv: string | undefined, clientToken: string | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXT_PUBLIC_PADDLE_ENV: paddleEnv,
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: clientToken,
  } as NodeJS.ProcessEnv;
}

describe("getPaddleClientConfig", () => {
  it("returns the config when the sandbox environment pairs with a test_ token", () => {
    const config = getPaddleClientConfig(envWith("sandbox", "test_abc123"));
    expect(config).toEqual({ environment: "sandbox", clientToken: "test_abc123" });
  });

  it("returns the config when the production environment pairs with a live_ token", () => {
    const config = getPaddleClientConfig(envWith("production", "live_abc123"));
    expect(config).toEqual({ environment: "production", clientToken: "live_abc123" });
  });

  it("returns a frozen (immutable) object", () => {
    const config = getPaddleClientConfig(envWith("sandbox", "test_abc123"));
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("returns null and logs, never defaulting, when NEXT_PUBLIC_PADDLE_ENV is unset", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith(undefined, "test_abc123"))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("returns null and logs for an unrecognised environment value", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith("staging", "test_abc123"))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("returns null and logs when the client token is unset", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith("sandbox", undefined))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("returns null and logs when the client token is blank", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith("sandbox", "  "))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("refuses a live_ token against the sandbox environment (wrong Paddle account)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith("sandbox", "live_abc123"))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("refuses a test_ token against the production environment (wrong Paddle account)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getPaddleClientConfig(envWith("production", "test_abc123"))).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("never throws for any combination of malformed input", () => {
    expect(() => getPaddleClientConfig(envWith("", ""))).not.toThrow();
    expect(() => getPaddleClientConfig(envWith("PRODUCTION", "live_x"))).not.toThrow();
  });

  it("defaults to reading process.env when no env object is injected", () => {
    const originalEnv = process.env.NEXT_PUBLIC_PADDLE_ENV;
    const originalToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    process.env.NEXT_PUBLIC_PADDLE_ENV = "sandbox";
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = "test_xyz";

    expect(getPaddleClientConfig()).toEqual({ environment: "sandbox", clientToken: "test_xyz" });

    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_PADDLE_ENV;
    else process.env.NEXT_PUBLIC_PADDLE_ENV = originalEnv;
    if (originalToken === undefined) delete process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    else process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = originalToken;
  });
});
