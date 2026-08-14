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
  TEST_STAGE_TWO_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import { startLiveServer, type LiveServer } from "./support/live-server";

// T35-6/T35-7 (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7 — QA).
// Three additional buyer-owned, OPEN steps dedicated to this file's own
// body-is-ignored and replay-semantics tests, kept separate from
// TEST_BUYER_STEP_ID (whose "happy path" test above already consumes its one
// completion) so those tests never race or double-consume the same row.
// Not exported from tests/fixtures/seed-leaky-workspace.ts — scoped to this
// file only, mirroring tests/security/link-visibility-toggle.spec.ts's own
// dedicated-row idiom. No separate teardown is needed: these live under
// TEST_STAGE_TWO_ID, which cascades away with the rest of the workspace in
// teardownLeakyWorkspace() (success_plans -> plan_stages -> plan_steps).
const FRESH_STEP_EMPTY_BODY_ID = "7e570000-0000-4000-8000-00000000000b";
const FRESH_STEP_SPOOFED_BODY_ID = "7e570000-0000-4000-8000-00000000000c";
const FRESH_STEP_REPLAY_ID = "7e570000-0000-4000-8000-00000000000d";

let seeded: LeakyWorkspace;
let server: LiveServer;

function sessionCookieHeader(workspaceId: string, email: string): string {
  const { value } = createPortalSessionValue(workspaceId, email);
  return `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}`;
}

async function completeStep(stepId: string, cookie?: string, body?: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/api/steps/${stepId}/complete`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

beforeAll(async () => {
  // Runs after the seed above (vitest executes same-scope beforeAll hooks in
  // declaration order), so TEST_STAGE_TWO_ID already exists. upsert, not
  // insert, so a rerun after a previous failed run's cleanup is idempotent —
  // explicitly resets status back to 'open' and clears completed_at /
  // completed_by_email every run, matching the other fixtures' idiom for
  // dedicated file-scoped rows.
  const db = createAdminClient();
  const { error } = await db.from("plan_steps").upsert([
    {
      id: FRESH_STEP_EMPTY_BODY_ID,
      stage_id: TEST_STAGE_TWO_ID,
      label: "T35-6 fresh step (empty body)",
      owner_side: "buyer",
      status: "open",
      display_order: 3,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: FRESH_STEP_SPOOFED_BODY_ID,
      stage_id: TEST_STAGE_TWO_ID,
      label: "T35-6 fresh step (spoofed body)",
      owner_side: "buyer",
      status: "open",
      display_order: 4,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: FRESH_STEP_REPLAY_ID,
      stage_id: TEST_STAGE_TWO_ID,
      label: "T35-7 fresh step (replay)",
      owner_side: "buyer",
      status: "open",
      display_order: 5,
      completed_at: null,
      completed_by_email: null,
    },
  ]);
  if (error) throw new Error(`step-completion.spec.ts fresh-step seed failed: ${error.message}`);
}, 30_000);

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

  it(
    "T35-6: the request body is never parsed -- an empty body and a body spoofing owner_side/" +
      "completed_by_email/completed_at both complete the step under the SESSION's own email and a " +
      "server-generated completed_at",
    async () => {
      const cookie = sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL);
      const fakeCompletedAt = "2000-01-01T00:00:00.000Z";

      // Arrange + Act: one POST with an empty body, one POST with a body
      // spoofing every field this endpoint would otherwise need to trust the
      // session for -- both under the exact same session cookie.
      const emptyBodyResponse = await completeStep(FRESH_STEP_EMPTY_BODY_ID, cookie, {});
      const spoofedBodyResponse = await completeStep(FRESH_STEP_SPOOFED_BODY_ID, cookie, {
        owner_side: "buyer",
        completed_by_email: "attacker@evil.test",
        completed_at: fakeCompletedAt,
      });

      expect(emptyBodyResponse.status).toBe(200);
      expect(spoofedBodyResponse.status).toBe(200);

      const db = createAdminClient();
      const { data: rows } = await db
        .from("plan_steps")
        .select("id, completed_by_email, completed_at")
        .in("id", [FRESH_STEP_EMPTY_BODY_ID, FRESH_STEP_SPOOFED_BODY_ID]);
      const emptyBodyRow = rows?.find((row) => row.id === FRESH_STEP_EMPTY_BODY_ID);
      const spoofedBodyRow = rows?.find((row) => row.id === FRESH_STEP_SPOOFED_BODY_ID);

      // Assert: both rows carry the SESSION's email -- never a value read
      // from either body. This is stronger than "a spoofed field gets
      // overridden": the spoofed field never had a chance to be read at all,
      // because the handler never parses the body (T35-1).
      expect(emptyBodyRow?.completed_by_email).toBe(TEST_APPROVED_EMAIL);
      expect(spoofedBodyRow?.completed_by_email).toBe(TEST_APPROVED_EMAIL);
      expect(spoofedBodyRow?.completed_by_email).not.toBe("attacker@evil.test");

      // Both completed_at values are server-generated: neither is null, and
      // the spoofed one is specifically NOT the attacker's fake past date.
      expect(emptyBodyRow?.completed_at).toBeTruthy();
      expect(spoofedBodyRow?.completed_at).toBeTruthy();
      expect(spoofedBodyRow?.completed_at).not.toBe(fakeCompletedAt);
      const recentFloor = Date.now() - 60_000;
      expect(new Date(emptyBodyRow!.completed_at as string).getTime()).toBeGreaterThan(recentFloor);
      expect(new Date(spoofedBodyRow!.completed_at as string).getTime()).toBeGreaterThan(recentFloor);
    },
  );

  it(
    "T35-7: replaying a completion is a true no-op against the conditional update -- analytics count " +
      "stays unchanged (not merely un-duplicated) and completed_at is strictly equal to the first call's " +
      "own value",
    async () => {
      const cookie = sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL);
      const before = await countStepCompleteRows(FRESH_STEP_REPLAY_ID);
      expect(before).toBe(0);

      const first = await completeStep(FRESH_STEP_REPLAY_ID, cookie);
      expect(first.status).toBe(200);
      const firstJson = (await first.json()) as { data: { completed_at: string } };
      expect(firstJson.data.completed_at).toBeTruthy();

      const afterFirst = await countStepCompleteRows(FRESH_STEP_REPLAY_ID);
      expect(afterFirst).toBe(before + 1);

      const second = await completeStep(FRESH_STEP_REPLAY_ID, cookie);
      expect(second.status).toBe(200);
      const secondJson = (await second.json()) as { data: { completed_at: string } };

      // Strictly equal to the FIRST call's own value -- proves this branch
      // read back the exact row the first call wrote, not a re-completion
      // that happened to land on the same timestamp by coincidence.
      expect(secondJson.data.completed_at).toBe(firstJson.data.completed_at);

      const afterSecond = await countStepCompleteRows(FRESH_STEP_REPLAY_ID);
      // UNCHANGED from the count right after the FIRST call -- not merely "no
      // duplicate of one specific row" (which a check-then-act, non-
      // conditional-update implementation could also satisfy by accident).
      // Proves the conditional update's WHERE (status = 'open') did not
      // match on the replay at all, so the analytics insert (T35-4, gated on
      // a genuine "completed" transition) never ran a second time.
      expect(afterSecond).toBe(afterFirst);
    },
  );

  it(
    "T35-11: a malformed step id forces a genuine Postgres error, and the response is clean 4xx/5xx " +
      "JSON -- never raw Postgres text, a stack trace, or SQL",
    async () => {
      // "not-a-valid-uuid" is not merely absent (which would 404 via
      // resolveStepWorkspace's `if (!data) return null` branch) -- Postgres
      // itself rejects the WHERE clause's implicit uuid cast (SQLSTATE
      // 22P02, "invalid input syntax for type uuid"), so this reaches
      // resolveStepWorkspace's `if (error) throw error` line and is a
      // GENUINE, unmocked database error, not a hand-thrown one. Confirmed
      // manually against a live `next start` before writing this assertion:
      // 500 { "error": "UNKNOWN_ERROR" }, nothing else in the body.
      const response = await completeStep("not-a-valid-uuid");

      // lib/plans/errors.ts's mapPostgrestError has no named-constraint
      // branch for 22P02, so this falls through to its UNKNOWN_ERROR
      // default (500) rather than one of the specific 4xx codes -- still
      // funnelled through errorResponse(), still clean JSON, never an
      // unhandled rejection reaching Next's own default error page (which
      // would render HTML, not JSON, and this test's JSON.parse below would
      // fail loudly if that regressed).
      expect(response.status).toBe(500);

      const bodyText = await response.text();
      const json = JSON.parse(bodyText) as Record<string, unknown>;

      // The ONLY key in the body is the mapped error code -- nothing else
      // leaked alongside it (no `details`, no `hint`, no raw `message`).
      expect(Object.keys(json)).toEqual(["error"]);
      expect(json.error).toBe("UNKNOWN_ERROR");

      // No raw Postgres text of any kind reaches the client: not the
      // SQLSTATE, not Postgres's own "invalid input syntax" wording, not a
      // table/column name, not a stack frame, not a SQL keyword.
      expect(bodyText).not.toMatch(/invalid input syntax/i);
      expect(bodyText).not.toMatch(/22P02/);
      expect(bodyText).not.toMatch(/postgres/i);
      expect(bodyText).not.toMatch(/plan_steps/i);
      expect(bodyText).not.toMatch(/\bat [A-Za-z0-9_$.]+ \(/); // a stack-frame line's shape
      expect(bodyText).not.toMatch(/\bselect\b|\binsert\b|\bupdate\b|\bwhere\b/i);
    },
  );
});
