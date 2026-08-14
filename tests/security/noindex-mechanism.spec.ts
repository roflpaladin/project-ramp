// T34-8 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). "Both routes
// respond noindex" checked against the ACTUAL mechanism, not assumed.
//
// Discovered empirically against a real `next build && next start` before
// writing this file (Next 15.5.20, App Router file-based Metadata API):
// declaring `robots: { index: false, follow: false }` in a layout's
// exported `metadata` object renders as
//   <meta name="robots" content="noindex, nofollow"/>
// in the response's <head> — Next emits NO `X-Robots-Tag` HTTP header for
// this API. Verified with curl against all four combinations below
// (gate/granted × /portal/[id] //view/[id]) before this file was written, so
// the assertions here check the mechanism that is actually in play rather
// than either of the two the ticket flags as possible. If a future Next
// version (or a switch to route-level `headers()`) changes which mechanism
// carries this, THIS assertion is what will fail — not a silent pass on the
// wrong one.
//
// Live, over HTTP, via the real server (tests/security/support/
// live-server.ts) — a robots meta tag is head-of-document markup that a
// unit test calling generateMetadata() directly would only prove was
// RETURNED, not that Next actually rendered it into the response Google
// would receive.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_WORKSPACE_ID } from "@/lib/demo";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import { startLiveServer, type LiveServer } from "./support/live-server";

let server: LiveServer;

// Fixed, never seeded — a workspace id that can only ever resolve to "does
// not exist," for the gate-branch checks below (mirrors buyer-boundary.spec.ts's
// NONEXISTENT_WORKSPACE_ID convention, kept file-local to avoid entangling
// this file with that one's fixture-driven lifecycle).
const NONEXISTENT_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000ee";

const ROBOTS_META_RE = /<meta\s+name="robots"\s+content="([^"]*)"\s*\/?>/i;

interface FetchedPage {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

async function fetchPage(path: string, cookieHeader?: string): Promise<FetchedPage> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    redirect: "manual",
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function grantedCookieFor(workspaceId: string): string {
  const { value } = createPortalSessionValue(workspaceId, "buyer.noindex-check@acme-logistics.example.com");
  return `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}`;
}

/** Asserts the CONCRETE mechanism this file discovered: a robots meta tag
 *  present in <head> with "noindex" in its content, and — checked directly
 *  rather than assumed — no X-Robots-Tag header standing in for it either. */
function expectNoindexMetaTag(page: FetchedPage, description: string): void {
  expect(page.headers.get("x-robots-tag"), `${description}: no X-Robots-Tag header is emitted by this mechanism`).toBeNull();

  const match = ROBOTS_META_RE.exec(page.body);
  expect(match, `${description}: expected a <meta name="robots" content="..."> tag in the response body`).not.toBeNull();
  expect(match?.[1].toLowerCase(), description).toContain("noindex");
}

beforeAll(async () => {
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  await server?.stop();
}, 60_000);

describe("noindex — the actual mechanism, on both branches of both routes (T34-8)", () => {
  it("/portal/[id] — unauthenticated gate branch is noindex", async () => {
    const page = await fetchPage(`/portal/${NONEXISTENT_WORKSPACE_ID}`);
    // POSITIVE CONTROL: /portal/[id] answers 200 for the gate itself (the
    // no-enumeration-oracle design), so status alone can't confirm which
    // branch we're holding — assert the actual gate copy is present.
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/Deal Room Access/);
    expectNoindexMetaTag(page, "/portal/[id] gate branch");
  });

  it("/portal/[id] — granted branch is noindex", async (ctx) => {
    const db = createAdminClient();
    const { data: demoWorkspace, error } = await db.from("workspaces").select("id").eq("id", DEMO_WORKSPACE_ID).maybeSingle();
    if (error) throw new Error(`cannot determine whether the demo seed is present: ${error.message}`);
    if (!demoWorkspace) {
      ctx.skip();
      return;
    }

    const page = await fetchPage(`/portal/${DEMO_WORKSPACE_ID}`, grantedCookieFor(DEMO_WORKSPACE_ID));
    expect(page.status).toBe(200);
    expect(page.body).toContain('data-testid="buyer-workspace"');
    expectNoindexMetaTag(page, "/portal/[id] granted branch");
  });

  it("/view/[id] — unauthenticated (but demo-tenant-scoped) gate branch is noindex", async (ctx) => {
    const db = createAdminClient();
    const { data: demoWorkspace, error } = await db.from("workspaces").select("id").eq("id", DEMO_WORKSPACE_ID).maybeSingle();
    if (error) throw new Error(`cannot determine whether the demo seed is present: ${error.message}`);
    if (!demoWorkspace) {
      ctx.skip();
      return;
    }

    const page = await fetchPage(`/view/${DEMO_WORKSPACE_ID}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/Enter your deal room/);
    expectNoindexMetaTag(page, "/view/[id] gate branch");
  });

  it("/view/[id] — outside the demo tenant, the 404 branch is ALSO noindex (Next's own not-found metadata, merged with this layout's base)", async () => {
    const page = await fetchPage(`/view/${NONEXISTENT_WORKSPACE_ID}`);
    expect(page.status).toBe(404);
    expectNoindexMetaTag(page, "/view/[id] 404 branch");
  });

  it("/view/[id] — granted branch is noindex", async (ctx) => {
    const db = createAdminClient();
    const { data: demoWorkspace, error } = await db.from("workspaces").select("id").eq("id", DEMO_WORKSPACE_ID).maybeSingle();
    if (error) throw new Error(`cannot determine whether the demo seed is present: ${error.message}`);
    if (!demoWorkspace) {
      ctx.skip();
      return;
    }

    const page = await fetchPage(`/view/${DEMO_WORKSPACE_ID}`, grantedCookieFor(DEMO_WORKSPACE_ID));
    expect(page.status).toBe(200);
    expect(page.body).toContain('data-testid="buyer-workspace"');
    expectNoindexMetaTag(page, "/view/[id] granted branch");
  });
});
