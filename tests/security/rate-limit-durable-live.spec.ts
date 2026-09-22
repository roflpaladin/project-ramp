// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". Live-Supabase spec for
// the check_rate_limit function (supabase/migrations/0016_rate_limit_windows.sql).
// A mock cannot prove the three things the shared-store limiter exists for:
//
//   1. One budget across callers: N parallel requests against a limit of L
//      yield EXACTLY L "allowed" — the upsert's row lock serialises them. This
//      is the property the in-memory limiter cannot have across instances.
//   2. The window really reopens, judged by the database's clock.
//   3. Only the service role can run the function or read the table: a buyer
//      or seller session must not be able to reset (or read) a counter.
//
// REQUIRES migration 0016 on the target project. Like the rest of this suite
// it fails loudly rather than skipping when that is missing — "a security
// suite that skips is not a gate" (tests/fixtures/env.ts).
//
// vitest.config.ts defaults RATE_LIMIT_STORE to "memory"; this file opts back
// in to "database". Every key carries a per-run UUID and its row is deleted in
// afterAll, so runs never see each other's counts.

import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RateLimitBudget } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();
const runId = randomUUID();
const usedKeys: string[] = [];

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false } });

const MS_PER_SECOND = 1000;

function uniqueKey(label: string): string {
  const key = `t62-live:${label}:${runId}`;
  usedKeys.push(key);
  return key;
}

function hashOf(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(() => {
  vi.stubEnv("RATE_LIMIT_STORE", "database");
  // A fallback to the in-memory limiter would make every assertion below pass
  // for the wrong reason, so any "store unavailable" log fails the run.
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    throw new Error(`the shared store was not used: ${args.map(String).join(" ")}`);
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await admin.from("rate_limit_windows").delete().in("key_hash", usedKeys.map(hashOf));
});

describe("check_rate_limit (live)", () => {
  it("allows up to the limit, then refuses with a wait inside the window", async () => {
    const key = uniqueKey("sequence");
    const budget: RateLimitBudget = { limit: 3, windowMs: 60 * MS_PER_SECOND };

    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(await checkDurableRateLimit(key, budget));
    }

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3].retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(results[3].retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("gives parallel callers ONE shared budget — exactly `limit` are allowed", async () => {
    const key = uniqueKey("parallel");
    const budget: RateLimitBudget = { limit: 5, windowMs: 60 * MS_PER_SECOND };

    const results = await Promise.all(Array.from({ length: 20 }, () => checkDurableRateLimit(key, budget)));

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
  });

  it("reopens once the window has passed", async () => {
    const key = uniqueKey("window");
    const budget: RateLimitBudget = { limit: 1, windowMs: 2 * MS_PER_SECOND };

    expect((await checkDurableRateLimit(key, budget)).allowed).toBe(true);
    expect((await checkDurableRateLimit(key, budget)).allowed).toBe(false);

    await sleep(2.5 * MS_PER_SECOND);

    expect((await checkDurableRateLimit(key, budget)).allowed).toBe(true);
  });

  it("stores the key only as a hash", async () => {
    const key = uniqueKey("hash");
    await checkDurableRateLimit(key, { limit: 1, windowMs: 60 * MS_PER_SECOND });

    const { data, error } = await admin.from("rate_limit_windows").select("key_hash").eq("key_hash", hashOf(key));

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].key_hash).not.toContain(runId);
  });

  it("keeps a hammering caller's stored count bounded at limit + 1", async () => {
    const key = uniqueKey("bounded");
    const budget: RateLimitBudget = { limit: 2, windowMs: 60 * MS_PER_SECOND };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await checkDurableRateLimit(key, budget);
    }

    const { data } = await admin.from("rate_limit_windows").select("request_count").eq("key_hash", hashOf(key)).single();

    expect(data?.request_count).toBe(3);
  });
});

describe("check_rate_limit — access (live)", () => {
  it("refuses an anonymous caller", async () => {
    const { data, error } = await anon.rpc("check_rate_limit", {
      p_key_hash: hashOf(uniqueKey("anon")),
      p_limit: 1,
      p_window_seconds: 60,
    });

    expect(error).not.toBeNull();
    // Postgres's own permission check, not PostgREST's "function not found".
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("hides the table from an anonymous caller", async () => {
    const key = uniqueKey("anon-read");
    await checkDurableRateLimit(key, { limit: 1, windowMs: 60 * MS_PER_SECOND });

    const { data } = await anon.from("rate_limit_windows").select("key_hash").eq("key_hash", hashOf(key));

    expect(data ?? []).toHaveLength(0);
  });

  it("rejects nonsense arguments instead of silently allowing", async () => {
    const { error } = await admin.rpc("check_rate_limit", {
      p_key_hash: hashOf(uniqueKey("bad-args")),
      p_limit: 0,
      p_window_seconds: 60,
    });

    expect(error).not.toBeNull();
  });
});
