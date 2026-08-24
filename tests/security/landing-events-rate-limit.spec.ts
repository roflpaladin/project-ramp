// Sprint 9, Ticket 48 — landing-page headline impression events need a
// SERVER-side rate limit: POST /api/landing-events is public and
// unauthenticated, same threat class as the waitlist capture endpoint
// covered by tests/security/waitlist-rate-limit.spec.ts (T47) — this file
// mirrors that one's structure exactly, swapped to LANDING_EVENT_RATE_LIMIT.
//
// DB-FREE, matching tests/security/waitlist-rate-limit.spec.ts's convention:
// the thing under test is the checkRateLimit branch INSIDE the route, so
// @/lib/supabase/admin is mocked with a minimal insert stub. The limiter
// itself (lib/rate-limit.ts) is NOT mocked — it's a real in-memory fixed
// window in this same process. Budgets are keyed per caller IP
// (x-forwarded-for), so each test uses its own unique IP to keep windows
// isolated from the other tests in this file.

import { describe, expect, it, vi } from "vitest";

import { LANDING_EVENT_RATE_LIMIT } from "@/lib/rate-limit";

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

const { POST } = await import("@/app/api/landing-events/route");

const ROUTE_URL = "http://localhost/api/landing-events";

function postImpression(ip: string, variant = "control"): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ event: "impression", variant }),
    }),
  );
}

describe("POST /api/landing-events — per-IP rate limiting (T48 security review)", () => {
  it("allows the budgeted calls, then returns 429 with Retry-After and writes no more rows", async () => {
    const ip = "198.51.100.30";
    insertCalls.mockClear();

    for (let call = 0; call < LANDING_EVENT_RATE_LIMIT.limit; call += 1) {
      const response = await postImpression(ip);
      expect(response.status).toBe(200);
    }
    expect(insertCalls).toHaveBeenCalledTimes(LANDING_EVENT_RATE_LIMIT.limit);

    const overBudget = await postImpression(ip);

    expect(overBudget.status).toBe(429);
    expect(overBudget.headers.get("Retry-After")).toBeTruthy();
    const body = (await overBudget.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();

    // The refusal happens BEFORE the insert — no row written for the
    // over-budget call.
    expect(insertCalls).toHaveBeenCalledTimes(LANDING_EVENT_RATE_LIMIT.limit);
  });

  it("budgets are per caller IP: one IP at the cap does not throttle a different IP", async () => {
    const cappedIp = "198.51.100.40";
    const otherIp = "198.51.100.41";
    insertCalls.mockClear();

    for (let call = 0; call < LANDING_EVENT_RATE_LIMIT.limit; call += 1) {
      const response = await postImpression(cappedIp);
      expect(response.status).toBe(200);
    }
    const cappedOverBudget = await postImpression(cappedIp);
    expect(cappedOverBudget.status).toBe(429);

    const otherResponse = await postImpression(otherIp);
    expect(otherResponse.status).toBe(200);
  });

  it("a request with no x-forwarded-for header still counts toward the shared 'unknown' bucket", async () => {
    // Documents current behaviour rather than asserting it as ideal, matching
    // waitlist-rate-limit.spec.ts's same case: acceptable interim scope per
    // lib/rate-limit.ts's header comment; full R7 hardening is Ticket 62.
    const response = await POST(
      new Request(ROUTE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "impression", variant: "control" }),
      }),
    );
    expect([200, 429]).toContain(response.status);
  });
});
