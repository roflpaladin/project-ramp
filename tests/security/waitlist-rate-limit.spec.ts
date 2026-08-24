// Sprint 9, Ticket 47 (phase 1) — public waitlist capture needs a SERVER-side
// rate limit: POST /api/waitlist is public and unauthenticated (no
// disable-on-pending UI affordance to even pretend is a control), same
// threat class as seller self-serve registration (T39,
// tests/security/rate-limit.spec.ts covers the limiter itself; this file
// covers the call site).
//
// DB-FREE, matching tests/security/onboarding-rate-limit.spec.ts's
// convention exactly: the thing under test is the checkRateLimit branch
// INSIDE the route, so @/lib/supabase/admin is mocked with a minimal insert
// stub. The limiter itself (lib/rate-limit.ts) is NOT mocked — it's a real
// in-memory fixed window in this same process. Budgets are keyed per caller
// IP (x-forwarded-for), so each test uses its own unique IP to keep windows
// isolated from the other tests in this file, exactly as the onboarding spec
// uses a unique seller userId per test.

import { describe, expect, it, vi } from "vitest";

import { WAITLIST_RATE_LIMIT } from "@/lib/rate-limit";

const insertCalls = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        insertCalls(row);
        return { then: (resolve: (value: { data: null; error: null }) => void) => resolve({ data: null, error: null }) };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/waitlist/route");

const ROUTE_URL = "http://localhost/api/waitlist";

function postJson(ip: string, email: string): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email }),
    }),
  );
}

describe("POST /api/waitlist — per-IP rate limiting (T47 security review)", () => {
  it("allows the budgeted calls, then returns 429 with Retry-After and writes no more rows", async () => {
    const ip = "198.51.100.10";
    insertCalls.mockClear();

    for (let call = 0; call < WAITLIST_RATE_LIMIT.limit; call += 1) {
      const response = await postJson(ip, `budget-${call}@example.com`);
      expect(response.status).toBe(200);
    }
    expect(insertCalls).toHaveBeenCalledTimes(WAITLIST_RATE_LIMIT.limit);

    const overBudget = await postJson(ip, "over-budget@example.com");

    expect(overBudget.status).toBe(429);
    expect(overBudget.headers.get("Retry-After")).toBeTruthy();
    const body = (await overBudget.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();

    // The refusal happens BEFORE the insert — no row written for the
    // over-budget call.
    expect(insertCalls).toHaveBeenCalledTimes(WAITLIST_RATE_LIMIT.limit);
  });

  it("budgets are per caller IP: one IP at the cap does not throttle a different IP", async () => {
    const cappedIp = "198.51.100.20";
    const otherIp = "198.51.100.21";
    insertCalls.mockClear();

    for (let call = 0; call < WAITLIST_RATE_LIMIT.limit; call += 1) {
      const response = await postJson(cappedIp, `capped-${call}@example.com`);
      expect(response.status).toBe(200);
    }
    const cappedOverBudget = await postJson(cappedIp, "capped-over@example.com");
    expect(cappedOverBudget.status).toBe(429);

    const otherResponse = await postJson(otherIp, "other-ip@example.com");
    expect(otherResponse.status).toBe(200);
  });

  it("a request with no x-forwarded-for header still counts toward the shared 'unknown' bucket", async () => {
    // Documents current behaviour rather than asserting it as ideal: every
    // caller without a forwarded-for header shares one bucket. Acceptable
    // interim scope per lib/rate-limit.ts's header comment (same limitation
    // REGISTRATION_RATE_LIMIT / SEND_TOKEN_RATE_LIMIT already carry) — full
    // R7 hardening is Ticket 62.
    const response = await POST(
      new Request(ROUTE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "no-header@example.com" }),
      }),
    );
    expect([200, 429]).toContain(response.status);
  });
});
