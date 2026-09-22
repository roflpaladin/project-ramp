import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, type RateLimitBudget, type RateLimitResult } from "./rate-limit";

// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass" (R7). The shared-store
// limiter lib/rate-limit.ts's header has promised since Sprint 8.
//
// The problem it fixes: lib/rate-limit.ts counts in a module-level Map, so on
// a serverless deployment every warm instance keeps its own budget — the
// effective limit is (instances x limit), and an attacker raises "instances"
// simply by sending requests in parallel. Here the count lives in Postgres
// (supabase/migrations/0016_rate_limit_windows.sql): one row per key, and one
// atomic upsert inside the `check_rate_limit` function decides every request,
// so concurrent callers on any number of instances share one budget.
//
// Same fixed-window semantics, budget constants and result shape as the
// in-memory limiter — deliberately, so a call site moves over by adding
// `await` and nothing else. The synchronous `checkRateLimit` is untouched and
// still exported: authenticated, per-seller call sites (and the billing
// files fenced off during Sprint 12) keep using it until they are moved.
//
// When the store cannot answer (function not deployed yet, database blip,
// malformed reply) this neither fails open — no limit at all is the hole
// this ticket closes — nor fails closed — that would lock every buyer out of
// their deal room on a transient error. It degrades to the in-memory limiter:
// exactly the pre-T62 behaviour. That also makes deploy order forgiving: code
// that lands before 0016 is pasted still rate-limits.
//
// RATE_LIMIT_STORE=memory skips the store entirely. vitest.config.ts and the
// Playwright server set it, because durable state would otherwise leak
// between test runs (a spec that spends a 15-minute budget would fail its
// own re-run); it doubles as a production kill switch.
//
// Keys are SHA-256 hashed before they leave this module: they contain IP
// addresses and email addresses, and the table has no need to hold either.

const MS_PER_SECOND = 1000;
const RPC_NAME = "check_rate_limit";
const MEMORY_STORE = "memory";
const MIN_RETRY_AFTER_SECONDS = 1;

interface StoreAnswer {
  readonly allowed: boolean;
  readonly retry_after_seconds: number;
}

function isStoreAnswer(value: unknown): value is StoreAnswer {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.allowed === "boolean" && typeof row.retry_after_seconds === "number";
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function toResult(answer: StoreAnswer): RateLimitResult {
  if (answer.allowed) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(Math.ceil(answer.retry_after_seconds), MIN_RETRY_AFTER_SECONDS),
  };
}

async function askStore(key: string, budget: RateLimitBudget): Promise<StoreAnswer> {
  const { data, error } = await createAdminClient().rpc(RPC_NAME, {
    p_key_hash: hashKey(key),
    p_limit: budget.limit,
    p_window_seconds: Math.ceil(budget.windowMs / MS_PER_SECOND),
  });
  if (error) throw new Error(`${RPC_NAME} failed (${error.code ?? "no code"})`);

  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isStoreAnswer(row)) throw new Error(`${RPC_NAME} returned an unexpected shape`);
  return row;
}

export async function checkDurableRateLimit(key: string, budget: RateLimitBudget): Promise<RateLimitResult> {
  if (process.env.RATE_LIMIT_STORE === MEMORY_STORE) {
    return checkRateLimit(key, budget.limit, budget.windowMs);
  }

  try {
    return toResult(await askStore(key, budget));
  } catch (error) {
    // Message only — never the key (it may hold an IP or an email address).
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[rate-limit] shared store unavailable; using the in-memory limiter:", detail);
    return checkRateLimit(key, budget.limit, budget.windowMs);
  }
}
