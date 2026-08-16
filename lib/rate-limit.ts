// Interim fixed-window rate limiter (Sprint 8, Ticket 39 — pulled forward
// from R7 per the planning-poker ruling: the public signup surface ships
// with its guard, not nine weeks later in the hardening pass). Deliberately
// in-memory and per-instance: on a multi-instance deployment each instance
// keeps its own budget, so the effective global limit is (instances × limit).
// That is accepted interim scope; distributed limiting is Ticket 62 (R7).

interface WindowEntry {
  readonly count: number;
  readonly windowStart: number;
}

const MS_PER_SECOND = 1000;

const windows = new Map<string, WindowEntry>();

export interface RateLimitBudget {
  readonly limit: number;
  readonly windowMs: number;
}

// Named budgets so call sites carry policy, not magic numbers.
export const REGISTRATION_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };
export const SEND_TOKEN_RATE_LIMIT: RateLimitBudget = { limit: 8, windowMs: 15 * 60_000 };

export interface RateLimitResult {
  readonly allowed: boolean;
  /** 0 when allowed; otherwise whole seconds until the window reopens. */
  readonly retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < limit) {
    windows.set(key, { count: entry.count + 1, windowStart: entry.windowStart });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.ceil((entry.windowStart + windowMs - now) / MS_PER_SECOND);
  return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
}

/** Test-only: clears all windows so specs are order-independent. */
export function resetRateLimiterForTests(): void {
  windows.clear();
}
