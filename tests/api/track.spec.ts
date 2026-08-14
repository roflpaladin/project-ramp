// T34-10 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Regression
// coverage for GET /api/track's click-logging behaviour — the "happy path"
// (a valid session clicking a shared link) had zero direct coverage before
// this file. tests/security/link-visibility-toggle.spec.ts (T30-10) already
// covers the private-link visibility filter specifically; this file covers
// what remains: the ordinary link-click flow, the no-session guard, and the
// wrong-workspace-session guard, none of which either existing suite
// exercises.
//
// Same live-server + real-fixture convention as
// tests/security/link-visibility-toggle.spec.ts: app/api/track/route.ts
// calls next/headers's cookies(), which throws outside a real Next.js
// request context, so this goes through a real, built `next start` server
// rather than calling the route's GET handler directly.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import { requireTestEnv } from "../fixtures/env";
import {
  FOREIGN_WORKSPACE_ID,
  SHARED_LINK_IDS,
  SHARED_LINK_URLS,
  TEST_APPROVED_EMAIL,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import { startLiveServer, type LiveServer } from "../security/support/live-server";

requireTestEnv();

interface TrackResponse {
  readonly status: number;
  readonly location: string | null;
}

async function fetchTrack(
  path: string,
  cookieHeader?: string,
): Promise<TrackResponse> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    redirect: "manual",
  });
  return { status: response.status, location: response.headers.get("location") };
}

function sessionCookieHeader(workspaceId: string, email: string): string {
  const { value } = createPortalSessionValue(workspaceId, email);
  return `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}`;
}

async function countLinkClicks(workspaceId: string, linkId: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("workspace_analytics")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("link_id", linkId)
    .eq("action_type", "link_click");
  return data?.length ?? 0;
}

let seeded: LeakyWorkspace;
let server: LiveServer;

beforeAll(async () => {
  await teardownLeakyWorkspace();
  seeded = await seedLeakyWorkspace();
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  try {
    await server?.stop();
  } finally {
    await teardownLeakyWorkspace();
  }
}, 60_000);

describe("GET /api/track — happy path", () => {
  it("a valid session clicking a shared link redirects to its destination and logs exactly one link_click", async () => {
    const linkId = SHARED_LINK_IDS[1];
    const before = await countLinkClicks(seeded.workspaceId, linkId);

    const result = await fetchTrack(
      `/api/track?linkId=${linkId}&wsId=${seeded.workspaceId}`,
      sessionCookieHeader(seeded.workspaceId, TEST_APPROVED_EMAIL),
    );

    expect(result.status).toBe(302);
    expect(result.location).toBe(SHARED_LINK_URLS[1]);

    const after = await countLinkClicks(seeded.workspaceId, linkId);
    expect(after).toBe(before + 1);
  });
});

describe("GET /api/track — key guard: no session", () => {
  it("bounces an unauthenticated click back to the portal gate and logs nothing", async () => {
    const linkId = SHARED_LINK_IDS[0];
    const before = await countLinkClicks(seeded.workspaceId, linkId);

    const result = await fetchTrack(`/api/track?linkId=${linkId}&wsId=${seeded.workspaceId}`);

    expect(result.status).toBe(302);
    expect(result.location).toContain(`/portal/${seeded.workspaceId}`);

    const after = await countLinkClicks(seeded.workspaceId, linkId);
    expect(after).toBe(before);
  });

  it("no linkId at all (portal-entry mode) redirects to /view/[id], not /portal/[id]", async () => {
    // app/api/track/route.ts's second responsibility: a bare wsId (no
    // linkId) is the shareable deal-room link, which routes to the
    // zero-friction /view gate rather than the magic-link /portal gate.
    const result = await fetchTrack(`/api/track?wsId=${seeded.workspaceId}`);

    expect(result.status).toBe(302);
    expect(result.location).toContain(`/view/${seeded.workspaceId}`);
  });

  it("missing wsId entirely is rejected with 400, not a redirect", async () => {
    const response = await fetch(`${server.baseUrl}/api/track?linkId=${SHARED_LINK_IDS[0]}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/track — key guard: a session for a DIFFERENT workspace", () => {
  it("does not resolve the link and bounces to the requested workspace's own portal gate, logging nothing", async () => {
    // The cookie is real and valid — just scoped to a different workspace.
    // verifyPortalSessionValue(wsId, cookie) must fail for this wsId, exactly
    // as if there were no session at all; it must not fall through to
    // resolving the link under the wrong workspace's identity.
    const linkId = SHARED_LINK_IDS[2];
    const before = await countLinkClicks(seeded.workspaceId, linkId);

    const result = await fetchTrack(
      `/api/track?linkId=${linkId}&wsId=${seeded.workspaceId}`,
      sessionCookieHeader(FOREIGN_WORKSPACE_ID, "someone@foreign-test.invalid"),
    );

    expect(result.status).toBe(302);
    expect(result.location).toContain(`/portal/${seeded.workspaceId}`);

    const after = await countLinkClicks(seeded.workspaceId, linkId);
    expect(after).toBe(before);
  });
});
