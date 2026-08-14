// T35-1..T35-4 (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7). Route
// tests for POST /api/steps/[id]/complete's own branch matrix.
//
// The three Tier 2 assertions this ticket also owns (403 with zero side
// effects for a seller-owned step, cross-workspace 404, anon 401) live in
// tests/security/buyer-boundary.spec.ts and are QA's to flip from skipped to
// live (T35-8) -- this file does not touch them. What's covered here instead:
// the happy path, the idempotent-replay-of-an-already-done-step branch, the
// blocked-step rejection branch, resolution-order-before-auth for a
// nonexistent step, and that the response itself never carries a
// seller-private field (this endpoint is the one other place a plan step is
// ever serialized back to a buyer, alongside toBuyerPayload).
//
// Runs through a real `next start` server (support/live-server.ts), same as
// buyer-boundary.spec.ts, because the route handler calls next/headers's
// cookies(), which throws outside a live request context.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import {
  BUYER_STEP_PRIVATE_NOTE,
  TEST_APPROVED_EMAIL,
  TEST_BLOCKED_STEP_ID,
  TEST_BUYER_STEP_ID,
  TEST_DONE_STEP_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import { startLiveServer, type LiveServer } from "./support/live-server";

let seeded: LeakyWorkspace;
let server: LiveServer;

function sessionCookieHeader(workspaceId: string, email: string): string {
  const { value } = createPortalSessionValue(workspaceId, email);
  return `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}`;
}

async function completeStep(stepId: string, cookie?: string): Promise<Response> {
  return fetch(`${server.baseUrl}/api/steps/${stepId}/complete`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

async function countStepCompleteRows(stepId: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("workspace_analytics")
    .select("id")
    .eq("step_id", stepId)
    .eq("action_type", "step_complete");
  return data?.length ?? 0;
}

beforeAll(async () => {
  seeded = await seedLeakyWorkspace();
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  // Cleanup must never depend on the tests above having passed -- each step
  // runs independently of whether the other threw (mirrors buyer-boundary.spec.ts).
  try {
    await server?.stop();
  } finally {
    await teardownLeakyWorkspace();
  }
}, 60_000);

describe("POST /api/steps/[id]/complete", () => {
  it("happy path: a buyer completing their own open step gets 200, the row updates, and analytics is written exactly once", async () => {
    const before = await countStepCompleteRows(TEST_BUYER_STEP_ID);

    const response = await completeStep(
      TEST_BUYER_STEP_ID,
      sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL),
    );
    expect(response.status).toBe(200);

    const json = (await response.json()) as { data: Record<string, unknown> };
    expect(json.data.id).toBe(TEST_BUYER_STEP_ID);
    expect(json.data.status).toBe("done");
    expect(json.data.completed_at).toBeTruthy();

    // The buyer boundary applies here too: even a BUYER-owned step carries a
    // seller-private private_note (0005 -- the column has no owner_side
    // condition), and this response must never carry it, owner_email, or
    // completed_by_email -- the same allowlist as toBuyerPayload's BuyerStep,
    // reused rather than re-derived.
    expect(json.data).not.toHaveProperty("private_note");
    expect(JSON.stringify(json.data)).not.toContain(BUYER_STEP_PRIVATE_NOTE);
    expect(json.data).not.toHaveProperty("owner_email");
    expect(json.data).not.toHaveProperty("completed_by_email");

    const db = createAdminClient();
    const { data: row } = await db
      .from("plan_steps")
      .select("status, completed_at, completed_by_email")
      .eq("id", TEST_BUYER_STEP_ID)
      .single();
    expect(row?.status).toBe("done");
    // completed_by_email comes from the verified session, never a request
    // body -- this endpoint's whole guarantee (T35-1).
    expect(row?.completed_by_email).toBe(TEST_APPROVED_EMAIL);

    const after = await countStepCompleteRows(TEST_BUYER_STEP_ID);
    expect(after).toBe(before + 1);
  });

  it("idempotent replay: POSTing to an already-done step returns 200 with the EXISTING row and writes no new analytics", async () => {
    const db = createAdminClient();
    const { data: seededRow } = await db
      .from("plan_steps")
      .select("completed_at")
      .eq("id", TEST_DONE_STEP_ID)
      .single();
    const before = await countStepCompleteRows(TEST_DONE_STEP_ID);

    const response = await completeStep(
      TEST_DONE_STEP_ID,
      sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL),
    );
    expect(response.status).toBe(200);

    const json = (await response.json()) as { data: { completed_at: string } };
    // Equal to the row's PRE-EXISTING value, not a freshly generated one --
    // proves the conditional update's WHERE (status = 'open') never matched
    // and this is the "already done" branch, not a silent re-completion.
    expect(json.data.completed_at).toBe(seededRow?.completed_at);

    const after = await countStepCompleteRows(TEST_DONE_STEP_ID);
    expect(after).toBe(before);
  });

  it("blocked step: POSTing is rejected with 409 and never falls into the 'already handled' 200 branch", async () => {
    const response = await completeStep(
      TEST_BLOCKED_STEP_ID,
      sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL),
    );
    expect(response.status).toBe(409);

    const db = createAdminClient();
    const { data: row } = await db
      .from("plan_steps")
      .select("status, completed_at")
      .eq("id", TEST_BLOCKED_STEP_ID)
      .single();
    expect(row?.status).toBe("blocked");
    expect(row?.completed_at).toBeNull();

    const after = await countStepCompleteRows(TEST_BLOCKED_STEP_ID);
    expect(after).toBe(0);
  });

  it("a nonexistent step id returns 404 even with zero cookies on the request", async () => {
    // No cookie at all AND a step that doesn't exist -- proves the route
    // resolves the step (and 404s) BEFORE it ever gets to an auth check,
    // matching T35-2's mandated order (resolve from the step, THEN read the
    // cookie). If auth ran first this would be 401, not 404.
    const response = await completeStep(crypto.randomUUID());
    expect(response.status).toBe(404);
  });
});
