// Sprint 9, Ticket 47 (phase 1) — real-Supabase companion to
// tests/api/waitlist.spec.ts (which is deliberately DB-free — see that
// file's header for why). The founder has now applied
// supabase/migrations/0008_waitlist.sql to the dev project, so
// waitlist_signups exists there and this file's assertions are real.
//
// Same style as tests/api/send-token.spec.ts / track.spec.ts: calls the
// route's exported POST handler directly with a plain Request rather than
// going through a live `next start` server — app/api/waitlist/route.ts
// touches no next/headers or next/navigation API that would throw outside a
// real request context (it reads x-forwarded-for straight off the Request),
// so a built server buys nothing extra here.
//
// Also proves RLS default-deny for waitlist_signups directly at the
// PostgREST layer with a real anon-key client, the same way
// tests/security/tenant-isolation-matrix.spec.ts's "portal_access_tokens —
// RLS enabled, NO policy at all" section does for that table: SELECT with
// zero policies comes back as an empty result with error === null (RLS
// filters silently, it does not error), while INSERT with zero policies
// raises "new row violates row-level security policy" (an actual error) —
// two different shapes of "denied," both asserted explicitly rather than
// assumed.
//
// Shared-DB discipline (dev Supabase is shared with another session and
// CI): every row this file creates is tagged with a per-run UUID
// (t47-live-<label>-<runId>@example.test) and every row id is captured into
// createdRowIds as soon as it's known — including rows a "blocked" write
// might unexpectedly have let through — then deleted by id in afterAll.
// Never a table-wide delete or truncate, never a filter that could catch a
// row this file didn't create itself.

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetRateLimiterForTests } from "@/lib/rate-limit";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false },
});

/** Never signed in — the "anonymous visitor" control, same role the
 * unauthenticated /api/waitlist caller itself is subject to. */
const anonClient = createClient(env.supabaseUrl, env.anonKey, {
  auth: { persistSession: false },
});

const { POST } = await import("@/app/api/waitlist/route");

const runId = randomUUID();
// Fixed TEST-NET-3 address (RFC 5737) for every route call in this file —
// all calls here stay well under WAITLIST_RATE_LIMIT's budget, and a fixed
// key keeps this file's own runs isolated from the mocked rate-limit spec
// (which uses its own distinct addresses) without needing to reason about
// vitest's per-file module isolation.
const CALLER_IP = "203.0.113.147";

const createdRowIds: string[] = [];

function uniqueEmail(label: string): string {
  return `t47-live-${label}-${runId}@example.test`;
}

function postJson(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": CALLER_IP },
      body: JSON.stringify(body),
    }),
  );
}

async function findRowIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await admin
    .from("waitlist_signups")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`waitlist-live lookup failed: ${error.message}`);
  return data?.id ?? null;
}

async function countRowsByEmail(email: string): Promise<number> {
  const { data, error } = await admin.from("waitlist_signups").select("id").eq("email", email.toLowerCase());
  if (error) throw new Error(`waitlist-live count failed: ${error.message}`);
  return data.length;
}

beforeAll(() => {
  resetRateLimiterForTests();
});

afterAll(async () => {
  if (createdRowIds.length === 0) return;
  const { error } = await admin.from("waitlist_signups").delete().in("id", createdRowIds);
  if (error) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
    console.error("waitlist-live cleanup failed:", error.message);
  }
});

describe("POST /api/waitlist — real DB happy path", () => {
  it("inserts exactly the row the request describes", async () => {
    const email = uniqueEmail("happy");

    const response = await postJson({ email, companyName: "Acme Live Co" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const id = await findRowIdByEmail(email);
    expect(id).not.toBeNull();
    if (id) createdRowIds.push(id);

    const { data: row, error } = await admin
      .from("waitlist_signups")
      .select("email, company_name, source, created_at")
      .eq("id", id as string)
      .single();

    expect(error).toBeNull();
    expect(row?.email).toBe(email.toLowerCase());
    expect(row?.company_name).toBe("Acme Live Co");
    expect(row?.source).toBeNull();
    expect(row?.created_at).toBeTruthy();
  });
});

describe("POST /api/waitlist — real DB duplicate email (case-insensitive)", () => {
  it("a case-variant duplicate gets the identical 200 {ok:true} and creates no second row", async () => {
    const baseEmail = uniqueEmail("dup");
    const variantEmail = baseEmail.toUpperCase(); // e.g. Foo@X.com vs foo@x.com

    const first = await postJson({ email: baseEmail });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({ ok: true });

    const id = await findRowIdByEmail(baseEmail);
    expect(id).not.toBeNull();
    if (id) createdRowIds.push(id);

    const second = await postJson({ email: variantEmail });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);

    // The unique index is on lower(email) -- confirm at the DB, not just
    // the response shape, that the case-variant collided into the SAME row
    // rather than the app happening to answer identically for two rows.
    expect(await countRowsByEmail(baseEmail)).toBe(1);
  });
});

describe("waitlist_signups — RLS default-deny holds for the anon role", () => {
  it("anon SELECT comes back empty (filtered, not errored) for a row that verifiably exists", async () => {
    const email = uniqueEmail("rls-select");
    const { data: inserted, error: insertError } = await admin
      .from("waitlist_signups")
      .insert({ email })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(inserted?.id).toBeTruthy();
    if (inserted?.id) createdRowIds.push(inserted.id);

    const { data, error } = await anonClient
      .from("waitlist_signups")
      .select("id")
      .eq("id", inserted?.id as string);

    // Zero policies on this table means RLS silently filters every row for
    // the anon role -- this is NOT itself a query error (see file header).
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anon INSERT is rejected by RLS and persists nothing", async () => {
    const email = uniqueEmail("rls-insert");

    const { error } = await anonClient.from("waitlist_signups").insert({ email });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level security/i);

    // Defensive, matching tenant-isolation-matrix.spec.ts's
    // assertWriteBlocked discipline: verify at the DB that nothing landed,
    // rather than trusting the error alone -- and still capture the id for
    // cleanup if it somehow did.
    const id = await findRowIdByEmail(email);
    if (id) createdRowIds.push(id);
    expect(id).toBeNull();
  });
});
