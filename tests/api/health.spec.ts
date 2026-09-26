// Sprint 12, Ticket 63 — "Prod readiness": GET /api/health, the target for
// the uptime monitor. DB-free: the admin client and the durable limiter are
// mocked; this pins that the response carries nothing but {ok}, that a
// missing required env var or a failing DB read turns it 503, that the
// reasons reach the server log only, and that callers are rate limited per IP.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { RateLimitBudget, RateLimitResult } from "@/lib/rate-limit";

const { checkDurableRateLimit, dbResult } = vi.hoisted(() => ({
  checkDurableRateLimit: vi.fn<(key: string, budget: RateLimitBudget) => Promise<RateLimitResult>>(),
  dbResult: { value: { error: null } as { error: { code?: string; message: string } | null } },
}));

vi.mock("@/lib/rate-limit-durable", () => ({ checkDurableRateLimit }));

const fromSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      fromSpy(table);
      const query = {
        select: () => query,
        limit: () => query,
        abortSignal: () => Promise.resolve(dbResult.value),
      };
      return query;
    },
  }),
}));

const { GET } = await import("@/app/api/health/route");
const { HEALTH_RATE_LIMIT, REQUIRED_PROD_ENV } = await import("@/lib/health");

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

function request(ip = "203.0.113.7"): Request {
  return new Request("https://www.getbrava.tech/api/health", { headers: { "x-forwarded-for": ip } });
}

function stubAllRequiredEnv(): void {
  for (const name of REQUIRED_PROD_ENV) vi.stubEnv(name, `value-for-${name}`);
}

let errorLog: MockInstance<typeof console.error>;

beforeEach(() => {
  stubAllRequiredEnv();
  checkDurableRateLimit.mockReset();
  checkDurableRateLimit.mockResolvedValue(ALLOWED);
  dbResult.value = { error: null };
  fromSpy.mockClear();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 {ok:true}, uncached, when env and database are healthy", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("returns 503 {ok:false} and logs the missing names (never values) when a required env var is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "   ");

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("RESEND_API_KEY");
    expect(logged).toContain("PADDLE_WEBHOOK_SECRET");
    expect(logged).not.toContain("value-for-");
  });

  it("returns 503 {ok:false} without touching the database when env is incomplete", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns 503 {ok:false} and logs the error code when the database read fails", async () => {
    dbResult.value = { error: { code: "PGRST301", message: "connection refused to db.internal:5432" } };

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("PGRST301");
    expect(logged).not.toContain("db.internal");
  });

  it("returns 429 {ok:false} with Retry-After once the caller's IP is over budget, and skips the checks", async () => {
    checkDurableRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false });
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("keys the rate limit by caller IP on the health budget", async () => {
    await GET(request("198.51.100.23"));

    expect(checkDurableRateLimit).toHaveBeenCalledWith("health:198.51.100.23", HEALTH_RATE_LIMIT);
  });
});

describe("HEALTH_RATE_LIMIT", () => {
  it("leaves room for a 1-minute uptime monitor plus a person checking by hand", () => {
    const monitorChecksPerWindow = HEALTH_RATE_LIMIT.windowMs / 60_000;

    expect(HEALTH_RATE_LIMIT.limit).toBeGreaterThan(monitorChecksPerWindow);
  });
});
