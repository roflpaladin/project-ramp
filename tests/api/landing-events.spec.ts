// Sprint 9, Ticket 48 — landing-page headline variant impression
// instrumentation.
//
// DB-FREE by design, matching tests/api/waitlist.spec.ts's convention
// exactly (see that file's header for the full rationale): this ticket's
// migration (0009_landing_events.sql) has not been applied to the shared dev
// Supabase project yet, and @/lib/supabase/admin is mocked with a minimal
// chainable query builder rather than requiring a live table. Table identity
// is irrelevant (there is exactly one table this route ever touches), only
// the configured insert result (success / DB error) decides the response.
//
// checkRateLimit is the REAL in-memory limiter (not mocked) — its own
// behaviour, and this route's call site, is
// tests/security/landing-events-rate-limit.spec.ts's job, not this file's.
// resetRateLimiterForTests() runs in beforeEach purely so this file's own
// assertions don't accidentally trip LANDING_EVENT_RATE_LIMIT and fail for
// the wrong reason.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiterForTests } from "@/lib/rate-limit";

interface TableResult {
  readonly data: unknown;
  readonly error: { readonly code: string; readonly message: string } | null;
}

const { insertCalls, nextResult } = vi.hoisted(() => ({
  insertCalls: [] as unknown[],
  nextResult: { value: { data: null, error: null } as TableResult },
}));

/** Minimal stand-in for the Supabase query builder — this route only ever
 * calls `.from("landing_events").insert(row)` and awaits the result
 * directly (no `.select()`/`.single()` chained), so the object `insert()`
 * returns needs to itself be thenable. */
function makeQueryBuilder(): Record<string, unknown> {
  return {
    insert: (row: unknown) => {
      insertCalls.push(row);
      const result = nextResult.value;
      return { then: (resolve: (value: TableResult) => void) => resolve(result) };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => makeQueryBuilder() }),
}));

const { POST } = await import("@/app/api/landing-events/route");

const ROUTE_URL = "http://localhost/api/landing-events";

function postJson(body: unknown, ip = "203.0.113.10"): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** Like postJson, but with an explicit (possibly lying) Content-Length
 * header -- a constructed Request never sets one on its own, matching
 * tests/api/waitlist.spec.ts's postJsonWithContentLength helper. */
function postJsonWithContentLength(
  body: unknown,
  contentLength: string,
  ip = "203.0.113.10",
): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        "content-length": contentLength,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function setInsertResult(result: TableResult): void {
  nextResult.value = result;
}

beforeEach(() => {
  resetRateLimiterForTests();
  insertCalls.length = 0;
  setInsertResult({ data: null, error: null });
});

describe("POST /api/landing-events — happy path", () => {
  it("a valid impression for the control variant gets a generic 200 and is inserted", async () => {
    const response = await postJson({ event: "impression", variant: "control" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual({ variant: "control", event_type: "impression" });
  });

  it("a valid impression for the with-not-at variant gets a generic 200 and is inserted", async () => {
    const response = await postJson({ event: "impression", variant: "with-not-at" });

    expect(response.status).toBe(200);
    expect(insertCalls[0]).toEqual({ variant: "with-not-at", event_type: "impression" });
  });

  it("duplicate impression calls (no uniqueness constraint) are both accepted", async () => {
    const first = await postJson({ event: "impression", variant: "control" }, "203.0.113.30");
    const second = await postJson({ event: "impression", variant: "control" }, "203.0.113.30");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]).toEqual(insertCalls[1]);
  });
});

describe("POST /api/landing-events — validation", () => {
  it("rejects malformed JSON with 400 and never calls insert", async () => {
    const response = await postJson("not json");
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a non-object body (array) with 400 and never calls insert", async () => {
    const response = await postJson(["impression", "control"]);
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a request with an unexpected extra field with 400", async () => {
    const response = await postJson({ event: "impression", variant: "control", ip: "1.2.3.4" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects an unknown/free-text variant with 400 and never calls insert", async () => {
    const response = await postJson({ event: "impression", variant: "founder-favorite" });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a non-'impression' event with 400 and never calls insert", async () => {
    const response = await postJson({ event: "click", variant: "control" });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a missing variant with 400", async () => {
    const response = await postJson({ event: "impression" });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("POST /api/landing-events — Content-Length pre-parse size gate", () => {
  it("rejects a declared Content-Length over the 1KB cap with 400 and never calls insert or parses the body", async () => {
    const response = await postJsonWithContentLength(
      { event: "impression", variant: "control" },
      "5000",
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(insertCalls).toHaveLength(0);
  });

  it("a valid, in-budget Content-Length does not regress the happy path", async () => {
    const response = await postJsonWithContentLength(
      { event: "impression", variant: "control" },
      "64",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(insertCalls).toHaveLength(1);
  });

  it("a missing Content-Length header does not regress the happy path", async () => {
    const response = await postJson({ event: "impression", variant: "control" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(insertCalls).toHaveLength(1);
  });
});

describe("POST /api/landing-events — DB errors", () => {
  it("returns a generic 500 and never leaks the raw DB error message", async () => {
    setInsertResult({ data: null, error: { code: "57014", message: "statement timeout" } });

    const response = await postJson({ event: "impression", variant: "control" });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain("statement timeout");
  });
});
