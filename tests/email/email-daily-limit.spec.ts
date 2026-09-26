// Sprint 12, Ticket 63 — founder ruling (Sep 26): Resend stays on the FREE
// plan (100 emails/day, 3,000/month), so the global transactional-email
// circuit breaker drops from 25,000 to 90/day and becomes overridable by the
// EMAIL_DAILY_LIMIT env var — upgrading the plan is then a Vercel env change,
// not a code change. DB-free: pins the parsing rules of
// resolveEmailDailyLimit and the default the module loads with.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EMAIL_DAILY_LIMIT,
  GLOBAL_EMAIL_DAILY_LIMIT,
  resolveEmailDailyLimit,
} from "@/lib/rate-limit";

const DAY_MS = 24 * 60 * 60_000;
const RESEND_FREE_DAILY_QUOTA = 100;
const RESEND_FREE_MONTHLY_QUOTA = 3_000;
const DAYS_IN_LONGEST_MONTH = 31;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEmailDailyLimit", () => {
  it("defaults to 90 when the env var is unset", () => {
    expect(resolveEmailDailyLimit(undefined)).toBe(90);
    expect(DEFAULT_EMAIL_DAILY_LIMIT).toBe(90);
  });

  it("defaults silently when the env var is an empty string", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(resolveEmailDailyLimit("")).toBe(DEFAULT_EMAIL_DAILY_LIMIT);
    expect(log).not.toHaveBeenCalled();
  });

  it("uses a valid positive integer, trimming surrounding whitespace", () => {
    expect(resolveEmailDailyLimit("45000")).toBe(45_000);
    expect(resolveEmailDailyLimit(" 1 ")).toBe(1);
  });

  it.each(["0", "-5", "1.5", "abc", "90abc", "1e3", "Infinity", "99999999999999999999"])(
    "falls back to the default and logs when the value is %j",
    (raw) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(resolveEmailDailyLimit(raw)).toBe(DEFAULT_EMAIL_DAILY_LIMIT);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain("EMAIL_DAILY_LIMIT");
    },
  );
});

describe("GLOBAL_EMAIL_DAILY_LIMIT", () => {
  it("loads with the default over a 24-hour window when the env var is unset", () => {
    expect(process.env.EMAIL_DAILY_LIMIT).toBeUndefined();
    expect(GLOBAL_EMAIL_DAILY_LIMIT).toEqual({ limit: DEFAULT_EMAIL_DAILY_LIMIT, windowMs: DAY_MS });
  });

  it("keeps the default under the Resend free plan's daily and monthly quotas", () => {
    expect(DEFAULT_EMAIL_DAILY_LIMIT).toBeLessThan(RESEND_FREE_DAILY_QUOTA);
    expect(DEFAULT_EMAIL_DAILY_LIMIT * DAYS_IN_LONGEST_MONTH).toBeLessThanOrEqual(RESEND_FREE_MONTHLY_QUOTA);
  });
});
