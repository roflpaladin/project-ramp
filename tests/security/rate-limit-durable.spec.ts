// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". Unit coverage for
// lib/rate-limit-durable.ts: the shared-store limiter that replaces the
// per-instance in-memory one on public, unauthenticated surfaces.
//
// DB-free: "@/lib/supabase/admin" is mocked, so this pins the TypeScript side
// only — what is sent to the check_rate_limit function, how its answer is
// mapped, and above all what happens when the store is unreachable. The SQL
// function's own atomicity/window behaviour is pinned live in
// tests/security/rate-limit-durable-live.spec.ts.

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiterForTests, type RateLimitBudget } from "@/lib/rate-limit";

const BUDGET: RateLimitBudget = { limit: 3, windowMs: 15 * 60_000 };
const KEY = "send-token:203.0.113.7";

interface RpcAnswer {
  readonly data: unknown;
  readonly error: { code?: string; message: string } | null;
}

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc })),
}));

const { checkDurableRateLimit } = await import("@/lib/rate-limit-durable");

function answer(value: RpcAnswer): void {
  rpc.mockResolvedValue(value);
}

beforeEach(() => {
  rpc.mockReset();
  resetRateLimiterForTests();
  vi.stubEnv("RATE_LIMIT_STORE", "database");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("checkDurableRateLimit — shared store", () => {
  it("asks the store with a HASHED key, the limit, and the window in seconds", async () => {
    answer({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

    await checkDurableRateLimit(KEY, BUDGET);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("check_rate_limit");
    expect(args).toEqual({
      p_key_hash: createHash("sha256").update(KEY).digest("hex"),
      p_limit: 3,
      p_window_seconds: 900,
    });
  });

  it("never sends the raw key (an IP or an email) to be stored", async () => {
    answer({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

    await checkDurableRateLimit("password-reset:email:seller@example.com", BUDGET);

    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain("seller@example.com");
  });

  it("maps an allowed answer", async () => {
    answer({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

    expect(await checkDurableRateLimit(KEY, BUDGET)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("maps a refused answer, with at least one second to wait", async () => {
    answer({ data: [{ allowed: false, retry_after_seconds: 0 }], error: null });

    expect(await checkDurableRateLimit(KEY, BUDGET)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("accepts a single-object answer as well as a one-row array", async () => {
    answer({ data: { allowed: false, retry_after_seconds: 412 }, error: null });

    expect(await checkDurableRateLimit(KEY, BUDGET)).toEqual({ allowed: false, retryAfterSeconds: 412 });
  });
});

describe("checkDurableRateLimit — store unreachable", () => {
  // Neither "fail open" (no limit at all — the hole this ticket closes) nor
  // "fail closed" (a database blip locks every buyer out of their deal room):
  // it degrades to the in-memory limiter, i.e. exactly the pre-T62 behaviour.
  it("falls back to the in-memory limiter when the function is missing (migration not applied yet)", async () => {
    answer({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });

    const results = [];
    for (let attempt = 0; attempt < BUDGET.limit + 1; attempt += 1) {
      results.push((await checkDurableRateLimit(KEY, BUDGET)).allowed);
    }

    expect(results).toEqual([true, true, true, false]);
  });

  it("falls back when the client throws", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"));

    expect(await checkDurableRateLimit(KEY, BUDGET)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("falls back when the answer has an unexpected shape", async () => {
    answer({ data: [{ nope: true }], error: null });

    expect((await checkDurableRateLimit(KEY, BUDGET)).allowed).toBe(true);
  });

  it("logs the failure without the key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    answer({ data: null, error: { code: "57014", message: "canceling statement" } });

    await checkDurableRateLimit("password-reset:email:seller@example.com", BUDGET);

    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("57014");
    expect(logged).not.toContain("seller@example.com");
  });
});

describe("checkDurableRateLimit — memory mode", () => {
  it("never touches the store when RATE_LIMIT_STORE=memory (tests, e2e, kill switch)", async () => {
    vi.stubEnv("RATE_LIMIT_STORE", "memory");

    const results = [];
    for (let attempt = 0; attempt < BUDGET.limit + 1; attempt += 1) {
      results.push((await checkDurableRateLimit(KEY, BUDGET)).allowed);
    }

    expect(results).toEqual([true, true, true, false]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
