// T28-15 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Layer C — one
// HTTP assertion: an unauthenticated GET of the plan builder route redirects
// to /admin/login. This is the only test in the suite that fails if someone
// edits middleware.ts's matcher array (lib/supabase/middleware.ts's
// updateSession, wired from middleware.ts's `config.matcher`) — every other
// plan test in this ticket exercises lib/plans/* or app/api/plans/[ws]
// directly and would stay green even if /admin/workspaces/[id]/plan lost its
// middleware protection entirely.
//
// Deliberately targets a route with NO page.tsx yet (Ticket 29 builds the UI)
// — middleware runs on every request matching its matcher BEFORE Next
// resolves whether a page exists for the path, so this proves the gate
// applies to the route today, independent of whether the page under it has
// been built.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_WORKSPACE_ID } from "../fixtures/seed-leaky-workspace";
import { startLiveServer, type LiveServer } from "../security/support/live-server";

let server: LiveServer;

beforeAll(async () => {
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  await server?.stop();
}, 60_000);

describe("GET /admin/workspaces/[id]/plan — unauthenticated (T28-15)", () => {
  it("redirects 307 to /admin/login, with no session cookie at all", async () => {
    const response = await fetch(`${server.baseUrl}/admin/workspaces/${TEST_WORKSPACE_ID}/plan`, {
      redirect: "manual",
    });

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    // Next.js's redirect Location header may be absolute or origin-relative
    // depending on how the framework builds it; resolving against the live
    // server's own base URL handles either form without assuming which one.
    expect(new URL(location as string, server.baseUrl).pathname).toBe("/admin/login");
  });
});
