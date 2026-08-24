// Sprint 9, Ticket 48 — real-Supabase companion to
// tests/api/landing-events.spec.ts (which is deliberately DB-free — see that
// file's header for why). The founder has now applied
// supabase/migrations/0009_landing_events.sql to the dev project, so
// landing_events exists there and this file's assertions are real.
//
// Same style as tests/api/waitlist-live.spec.ts: calls the route's exported
// POST handler directly with a plain Request rather than going through a
// live `next start` server — app/api/landing-events/route.ts touches no
// next/headers or next/navigation API that would throw outside a real
// request context (it reads x-forwarded-for straight off the Request), so a
// built server buys nothing extra here.
//
// Two extra layers get proven here that the DB-free spec can't reach:
//   1. The check constraints baked into 0009 itself (event_type = 'impression',
//      char_length(variant) <= 64) — asserted with a DIRECT admin-client
//      insert, bypassing the route entirely, so these tests prove the
//      database enforces its own invariant rather than only the app doing so.
//   2. RLS default-deny for landing_events, at the PostgREST layer with a
//      real anon-key client, the same way waitlist-live.spec.ts's
//      "waitlist_signups — RLS default-deny holds for the anon role" section
//      does for that table: SELECT with zero policies comes back as an empty
//      result with error === null (RLS filters silently, it does not error),
//      while INSERT with zero policies raises "new row violates row-level
//      security policy" (an actual error) — two different shapes of
//      "denied," both asserted explicitly rather than assumed.
//
// Shared-DB discipline (dev Supabase is shared with another session and
// CI): landing_events has no caller-supplied unique field to look a row up
// by (unlike waitlist_signups' email) — every row this file creates is
// instead located by (variant, created_at >= a captured "since" timestamp,
// most recent first) immediately after it's written, and every row id is
// captured into createdRowIds as soon as it's known — including rows a
// "blocked"/"rejected" write might unexpectedly have let through — then
// deleted by id in afterAll. Never a table-wide delete or truncate, never a
// filter that could catch a row this file didn't create itself.

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
 * unauthenticated /api/landing-events caller itself is subject to. */
const anonClient = createClient(env.supabaseUrl, env.anonKey, {
  auth: { persistSession: false },
});

const { POST } = await import("@/app/api/landing-events/route");

// Fixed TEST-NET-3 address (RFC 5737), distinct from waitlist-live.spec.ts's
// .147 and from the mocked landing-events rate-limit spec's own addresses —
// this file only ever makes one call through the route (the happy-path
// test below), well under LANDING_EVENT_RATE_LIMIT's budget, but a distinct
// fixed key keeps this file's own run isolated from any other file touching
// the same in-memory limiter without needing to reason about vitest's
// per-file module isolation.
const CALLER_IP = "203.0.113.148";

// Absorbs clock skew between this test process and the database server when
// filtering "rows created since I made this call" — generous on purpose,
// this is a lookup window, not a correctness assertion.
const CLOCK_SKEW_BUFFER_MS = 5000;

const createdRowIds: string[] = [];

function postImpression(variant: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/landing-events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": CALLER_IP },
      body: JSON.stringify({ event: "impression", variant }),
    }),
  );
}

function sinceNow(): string {
  return new Date(Date.now() - CLOCK_SKEW_BUFFER_MS).toISOString();
}

/** Finds the newest landing_events row for a given variant created at/after
 * `sinceIso`. landing_events has no caller-supplied unique key (unlike
 * waitlist_signups' email), so recency + variant is this file's closest
 * equivalent lookup. */
async function findLatestRowId(variant: string, sinceIso: string): Promise<string | null> {
  const { data, error } = await admin
    .from("landing_events")
    .select("id")
    .eq("variant", variant)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`landing-events-live lookup failed: ${error.message}`);
  return data?.id ?? null;
}

beforeAll(() => {
  resetRateLimiterForTests();
});

afterAll(async () => {
  if (createdRowIds.length === 0) return;
  const { error } = await admin.from("landing_events").delete().in("id", createdRowIds);
  if (error) {
    // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
    console.error("landing-events-live cleanup failed:", error.message);
  }
});

describe("POST /api/landing-events — real DB happy path", () => {
  it("inserts exactly the row the request describes, with a server-set created_at", async () => {
    const since = sinceNow();

    const response = await postImpression("control");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const id = await findLatestRowId("control", since);
    expect(id).not.toBeNull();
    if (id) createdRowIds.push(id);

    const { data: row, error } = await admin
      .from("landing_events")
      .select("variant, event_type, created_at")
      .eq("id", id as string)
      .single();

    expect(error).toBeNull();
    expect(row?.variant).toBe("control");
    expect(row?.event_type).toBe("impression");
    expect(row?.created_at).toBeTruthy();
  });
});

describe("landing_events — DB check constraints (direct admin insert, bypassing the route)", () => {
  it("rejects a non-'impression' event_type at the database layer", async () => {
    const since = sinceNow();
    // Unique marker instead of "control": the sinceNow() window deliberately
    // reaches CLOCK_SKEW_BUFFER_MS into the past, so a shared variant value
    // would (and, before this marker, did) catch the happy-path test's
    // legitimate row and fail the "nothing landed" check below. A variant
    // only this test ever writes makes the lookup collision-proof — the
    // check constraint under test here is on event_type, not variant, so any
    // <=64-char variant exercises it identically.
    const markerVariant = `t48-live-${randomUUID()}`;

    const { error } = await admin
      .from("landing_events")
      .insert({ variant: markerVariant, event_type: "click" });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/check constraint/i);

    // Defensive, matching waitlist-live's discipline: a constraint violation
    // means the whole statement was rejected (nothing lands), but verify at
    // the DB rather than trusting the error alone, and still capture the id
    // for cleanup if it somehow did.
    const id = await findLatestRowId(markerVariant, since);
    if (id) createdRowIds.push(id);
    expect(id).toBeNull();
  });

  it("rejects a variant over the 64-character cap at the database layer", async () => {
    const since = sinceNow();
    const overLongVariant = "x".repeat(65);

    const { error } = await admin
      .from("landing_events")
      .insert({ variant: overLongVariant, event_type: "impression" });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/check constraint/i);

    const id = await findLatestRowId(overLongVariant, since);
    if (id) createdRowIds.push(id);
    expect(id).toBeNull();
  });
});

describe("landing_events — RLS default-deny holds for the anon role", () => {
  it("anon SELECT comes back empty (filtered, not errored) for a row that verifiably exists", async () => {
    const { data: inserted, error: insertError } = await admin
      .from("landing_events")
      .insert({ variant: "control", event_type: "impression" })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(inserted?.id).toBeTruthy();
    if (inserted?.id) createdRowIds.push(inserted.id);

    const { data, error } = await anonClient
      .from("landing_events")
      .select("id")
      .eq("id", inserted?.id as string);

    // Zero policies on this table means RLS silently filters every row for
    // the anon role -- this is NOT itself a query error (see file header).
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anon INSERT is rejected by RLS and persists nothing", async () => {
    const since = sinceNow();

    const { error } = await anonClient
      .from("landing_events")
      .insert({ variant: "with-not-at", event_type: "impression" });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level security/i);

    // Defensive, matching waitlist-live.spec.ts's assertWriteBlocked
    // discipline: verify at the DB that nothing landed, rather than trusting
    // the error alone, and still capture the id for cleanup if it somehow did.
    const id = await findLatestRowId("with-not-at", since);
    if (id) createdRowIds.push(id);
    expect(id).toBeNull();
  });
});
