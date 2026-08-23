// Sprint 9, Ticket 47 (phase 1) — public waitlist capture.
//
// DB-FREE by design, unlike tests/api/send-token.spec.ts and
// tests/api/track.spec.ts (both real-Supabase integration tests): this
// ticket's migration (0008_waitlist.sql) has not been applied to the shared
// dev Supabase project yet (this project's migration workflow is "paste
// into the SQL Editor," a manual human step — see that file's header), and
// tests/security/onboarding-rate-limit.spec.ts / portal-session-cookie.spec.ts
// already establish the precedent of mocking @/lib/supabase/admin with a
// minimal chainable query builder rather than requiring a live table. That
// precedent is followed here: table identity is irrelevant (there is exactly
// one table this route ever touches), only the configured insert result
// (success / unique-violation / other DB error) decides the response.
//
// checkRateLimit is the REAL in-memory limiter (not mocked) — its own
// behaviour is tests/security/waitlist-rate-limit.spec.ts's job, not this
// file's. resetRateLimiterForTests() runs in beforeEach purely so this
// file's own assertions don't accidentally trip WAITLIST_RATE_LIMIT and fail
// for the wrong reason.

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
 * calls `.from("waitlist_signups").insert(row)` and awaits the result
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

const { POST } = await import("@/app/api/waitlist/route");

const ROUTE_URL = "http://localhost/api/waitlist";

function postJson(body: unknown, ip = "203.0.113.10"): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function setInsertResult(result: TableResult): void {
  nextResult.value = result;
}

const UNIQUE_VIOLATION: TableResult = {
  data: null,
  error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_waitlist_signups_email_lower"' },
};

beforeEach(() => {
  resetRateLimiterForTests();
  insertCalls.length = 0;
  setInsertResult({ data: null, error: null });
});

describe("POST /api/waitlist — happy path", () => {
  it("a new email gets a generic 200 success and is inserted lowercased/trimmed", async () => {
    const response = await postJson({ email: "  New.Signup@Example.com  " });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual({
      email: "new.signup@example.com",
      company_name: null,
      source: null,
    });
  });

  it("accepts optional companyName and source and inserts them trimmed", async () => {
    const response = await postJson({
      email: "founder@acme.test",
      companyName: "  Acme Inc  ",
      source: "  landing-variant-b  ",
    });

    expect(response.status).toBe(200);
    expect(insertCalls[0]).toEqual({
      email: "founder@acme.test",
      company_name: "Acme Inc",
      source: "landing-variant-b",
    });
  });
});

describe("POST /api/waitlist — idempotency / no enumeration", () => {
  it("a duplicate email (unique-violation) gets the SAME 200 response as a new one", async () => {
    const freshResponse = await postJson({ email: "unique@example.com" }, "203.0.113.20");
    const freshBody = await freshResponse.json();

    setInsertResult(UNIQUE_VIOLATION);
    const duplicateResponse = await postJson({ email: "unique@example.com" }, "203.0.113.20");
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(freshResponse.status);
    expect(duplicateBody).toEqual(freshBody);
    expect(duplicateBody).toEqual({ ok: true });
  });

  it("never reveals the unique-violation error code/message in the response body", async () => {
    setInsertResult(UNIQUE_VIOLATION);
    const response = await postJson({ email: "already-there@example.com" });
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain("23505");
    expect(JSON.stringify(body)).not.toContain("duplicate key");
  });
});

describe("POST /api/waitlist — validation", () => {
  it("rejects malformed JSON with 400 and never calls insert", async () => {
    const response = await postJson("not json");
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a missing email with 400", async () => {
    const response = await postJson({});
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects an invalid email format with 400", async () => {
    const response = await postJson({ email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects an email over the length cap with 400", async () => {
    const tooLong = `${"a".repeat(250)}@example.com`;
    const response = await postJson({ email: tooLong });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a companyName of the wrong type with 400", async () => {
    const response = await postJson({ email: "ok@example.com", companyName: 12345 });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a request body with an unexpected extra field (no silent junk)", async () => {
    const response = await postJson({ email: "ok@example.com", password: "sneaky" });
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("POST /api/waitlist — non-unique-violation DB errors", () => {
  it("returns a generic 500 and never leaks the raw DB error message", async () => {
    setInsertResult({ data: null, error: { code: "57014", message: "statement timeout" } });

    const response = await postJson({ email: "boom@example.com" });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain("statement timeout");
  });
});
