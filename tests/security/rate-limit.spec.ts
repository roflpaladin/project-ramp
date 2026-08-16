// Sprint 8, Ticket 39 — interim rate limiting pulled forward from R7 (poker
// ruling: the public signup surface ships with its guard, not 9 weeks later).
// Unit-level spec for the fixed-window limiter in lib/rate-limit.ts. The full
// R7 hardening audit (distributed limiting, per-route budgets) is Ticket 62;
// this limiter is deliberately in-memory and per-instance — see the lib's
// header comment for the accepted scope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkRateLimit,
  resetRateLimiterForTests,
  REGISTRATION_RATE_LIMIT,
  SEND_TOKEN_RATE_LIMIT,
} from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimiterForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit within one window", () => {
    for (let i = 0; i < 3; i += 1) {
      const result = checkRateLimit("k1", 3, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("denies the request after the limit is exhausted and reports a retry delay", () => {
    for (let i = 0; i < 3; i += 1) {
      checkRateLimit("k1", 3, 60_000);
    }

    const denied = checkRateLimit("k1", 3, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i += 1) {
      checkRateLimit("k1", 3, 60_000);
    }

    expect(checkRateLimit("k1", 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit("k2", 3, 60_000).allowed).toBe(true);
  });

  it("resets the budget once the window has elapsed", () => {
    for (let i = 0; i < 3; i += 1) {
      checkRateLimit("k1", 3, 60_000);
    }
    expect(checkRateLimit("k1", 3, 60_000).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(checkRateLimit("k1", 3, 60_000).allowed).toBe(true);
  });

  it("exports named budgets for the registration and send-token surfaces", () => {
    // The values are policy, not magic numbers scattered at call sites; the
    // spec pins only their shape and sanity, not exact numbers.
    for (const budget of [REGISTRATION_RATE_LIMIT, SEND_TOKEN_RATE_LIMIT]) {
      expect(budget.limit).toBeGreaterThan(0);
      expect(budget.windowMs).toBeGreaterThanOrEqual(60_000);
    }
  });
});
