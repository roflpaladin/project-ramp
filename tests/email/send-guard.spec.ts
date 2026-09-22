// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". Unit coverage for
// lib/email/send-guard.ts, the ticket's "abuse guard caps email sending per
// tenant". DB-free: the durable limiter is mocked; this pins WHICH budgets are
// charged under WHICH keys, and that one refusal is enough to stop a send.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBAL_EMAIL_DAILY_LIMIT,
  TENANT_EMAIL_DAILY_LIMIT,
  TENANT_EMAIL_HOURLY_LIMIT,
  type RateLimitBudget,
  type RateLimitResult,
} from "@/lib/rate-limit";

const TENANT_ID = "7e570000-0000-4000-8000-000000006201";
const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
const REFUSED: RateLimitResult = { allowed: false, retryAfterSeconds: 120 };

const { checkDurableRateLimit } = vi.hoisted(() => ({
  checkDurableRateLimit: vi.fn<(key: string, budget: RateLimitBudget) => Promise<RateLimitResult>>(),
}));

vi.mock("@/lib/rate-limit-durable", () => ({ checkDurableRateLimit }));

const { reserveEmailSend } = await import("@/lib/email/send-guard");

function refuseKeyContaining(fragment: string): void {
  checkDurableRateLimit.mockImplementation(async (key) => (key.includes(fragment) ? REFUSED : ALLOWED));
}

beforeEach(() => {
  checkDurableRateLimit.mockReset().mockResolvedValue(ALLOWED);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("reserveEmailSend", () => {
  it("allows a send inside every budget", async () => {
    expect(await reserveEmailSend({ tenantId: TENANT_ID })).toEqual({ allowed: true });
  });

  it("charges the tenant's hourly and daily budgets and the global daily budget", async () => {
    await reserveEmailSend({ tenantId: TENANT_ID });

    expect(checkDurableRateLimit.mock.calls).toEqual([
      [`email-send:tenant-hour:${TENANT_ID}`, TENANT_EMAIL_HOURLY_LIMIT],
      [`email-send:tenant-day:${TENANT_ID}`, TENANT_EMAIL_DAILY_LIMIT],
      ["email-send:global-day", GLOBAL_EMAIL_DAILY_LIMIT],
    ]);
  });

  it.each([
    ["tenant-hour", "tenant_hourly"],
    ["tenant-day", "tenant_daily"],
    ["global-day", "global_daily"],
  ])("refuses when the %s budget is spent, and says which", async (fragment, reason) => {
    refuseKeyContaining(fragment);

    expect(await reserveEmailSend({ tenantId: TENANT_ID })).toEqual({ allowed: false, reason });
  });

  it("stops charging further budgets once one has refused", async () => {
    refuseKeyContaining("tenant-hour");

    await reserveEmailSend({ tenantId: TENANT_ID });

    expect(checkDurableRateLimit).toHaveBeenCalledTimes(1);
  });

  it("charges only the global budget for an email no tenant caused", async () => {
    // e.g. a password reset: the requester is anonymous until the link is used.
    await reserveEmailSend({ tenantId: null });

    expect(checkDurableRateLimit.mock.calls).toEqual([["email-send:global-day", GLOBAL_EMAIL_DAILY_LIMIT]]);
  });

  it("logs a refusal with the reason and tenant id, so a spent budget is visible in the logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    refuseKeyContaining("tenant-day");

    await reserveEmailSend({ tenantId: TENANT_ID });

    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("tenant_daily");
    expect(logged).toContain(TENANT_ID);
  });
});
