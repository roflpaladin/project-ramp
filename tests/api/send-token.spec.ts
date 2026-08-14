// T34-10 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Regression
// coverage for POST /api/auth/send-token — zero coverage before this ticket,
// despite being a route Ticket 34's ACs claim stays "intact." Writing this is
// what makes "intact" a testable claim rather than an assertion nobody checks.
//
// Calls the route's exported POST handler directly with a plain Request,
// rather than going through tests/security/support/live-server.ts. Unlike
// the buyer-gate actions, app/api/auth/send-token/route.ts touches no
// next/headers or next/navigation API that would throw outside a live
// request context — it only calls issueAccessToken(), which reads real
// Supabase — so a full `next build && next start` buys nothing extra here.
// Same real fixture and real Supabase project as the rest of tests/plans and
// tests/security (tests/fixtures/seed-leaky-workspace.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { sendAccessCodeEmail as SendAccessCodeEmail } from "@/lib/email/send-access-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";
import {
  TEST_APPROVED_EMAIL,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

requireTestEnv();

// The only mock in this file. issueAccessToken()'s DB reads/writes and its
// approved-email/workspace guard run for real against Supabase below — this
// stubs out only the SMTP hop (lib/email/send-access-code.ts), which is a
// third-party network side effect orthogonal to what this route's ACs are
// about. .env.local ships a PLACEHOLDER SMTP_HOST ("smtp.your-provider.com"),
// so leaving this unmocked means every send attempts a real DNS/TCP
// connection to a host that doesn't exist — nodemailer's default connection
// timeout is two minutes, which starved this exact test past Vitest's
// testTimeout before this mock was added. sendAccessCodeEmail already fails
// soft in production (catches, logs, returns `{ ok: false }`) without ever
// blocking token creation, so stubbing its transport here changes nothing
// about the behaviour under test.
const sendAccessCodeEmail = vi.fn<typeof SendAccessCodeEmail>(async () => ({ ok: true }));
vi.mock("@/lib/email/send-access-code", () => ({
  sendAccessCodeEmail: (...args: Parameters<typeof SendAccessCodeEmail>) => sendAccessCodeEmail(...args),
}));

const { POST } = await import("@/app/api/auth/send-token/route");

const ROUTE_URL = "http://localhost/api/auth/send-token";

function postJson(body: unknown): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function countPendingTokens(workspaceId: string, email: string): Promise<number> {
  const db = createAdminClient();
  // The route lowercases the email before it ever reaches issueAccessToken
  // (app/api/auth/send-token/route.ts: `email.trim().toLowerCase()`), so the
  // stored row's email is always lowercase — normalise here too, or a
  // mixed-case fixture email (TEST_APPROVED_EMAIL contains LEAK_TOKEN, which
  // is uppercase) would never match and this helper would report 0 both
  // before and after regardless of whether the insert happened.
  const { data } = await db
    .from("portal_access_tokens")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email", email.toLowerCase())
    .is("consumed_at", null);
  return data?.length ?? 0;
}

let seeded: LeakyWorkspace;

beforeAll(async () => {
  await teardownLeakyWorkspace();
  seeded = await seedLeakyWorkspace();
});

afterAll(async () => {
  await teardownLeakyWorkspace();
});

beforeEach(() => {
  sendAccessCodeEmail.mockClear();
});

describe("POST /api/auth/send-token", () => {
  it("happy path: an approved email for a real workspace gets 200 and a new pending token row", async () => {
    const before = await countPendingTokens(seeded.workspaceId, TEST_APPROVED_EMAIL);

    const response = await postJson({ email: TEST_APPROVED_EMAIL, workspaceId: seeded.workspaceId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const after = await countPendingTokens(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(after).toBe(before + 1);

    // Proves the route reached the real send step for an approved email,
    // rather than the guard silently no-opping and the count only
    // incrementing for an unrelated reason.
    expect(sendAccessCodeEmail).toHaveBeenCalledTimes(1);
    expect(sendAccessCodeEmail.mock.calls[0][0]).toMatchObject({ to: TEST_APPROVED_EMAIL.toLowerCase() });
  });

  it("key guard: missing email or workspaceId is rejected with 400 and writes no token", async () => {
    const missingEmail = await postJson({ workspaceId: seeded.workspaceId });
    expect(missingEmail.status).toBe(400);
    const missingEmailBody = (await missingEmail.json()) as { ok: boolean; error: string };
    expect(missingEmailBody.ok).toBe(false);
    expect(missingEmailBody.error).toBeTruthy();

    const missingWorkspace = await postJson({ email: TEST_APPROVED_EMAIL });
    expect(missingWorkspace.status).toBe(400);

    const malformedJson = await postJson("not json");
    expect(malformedJson.status).toBe(400);
  });

  it("key guard: an unapproved email gets the SAME 200 response as an approved one, and writes no token", async () => {
    // issueAccessToken silently no-ops for an email that doesn't match the
    // workspace's approved list or domain — the route must still answer 200
    // uniformly, or the response shape itself becomes an approved-email
    // enumeration oracle.
    const unapprovedEmail = "not-approved@somewhere-else.invalid";
    const before = await countPendingTokens(seeded.workspaceId, unapprovedEmail);

    const response = await postJson({ email: unapprovedEmail, workspaceId: seeded.workspaceId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const after = await countPendingTokens(seeded.workspaceId, unapprovedEmail);
    expect(after).toBe(before);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  it("key guard: a nonexistent workspace gets the SAME 200 response, and writes no token", async () => {
    const nonexistentWorkspaceId = "7e570000-0000-4000-8000-0000000000ec";

    const response = await postJson({ email: TEST_APPROVED_EMAIL, workspaceId: nonexistentWorkspaceId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const after = await countPendingTokens(nonexistentWorkspaceId, TEST_APPROVED_EMAIL);
    expect(after).toBe(0);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });
});
