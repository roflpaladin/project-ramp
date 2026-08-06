// T30-7, T30-8, T30-9, T30-10 (Sprint 6, Ticket 30; plans/sprint-6-7-replan.md
// §6). Extends the Sprint 5 buyer-boundary / leaky-fixture pattern
// (tests/security/buyer-boundary.spec.ts, tests/fixtures/seed-leaky-workspace.ts)
// rather than inventing a parallel harness — same live production server
// (support/live-server.ts), same signed portal-session cookie helpers
// (lib/portal-session.ts), same RSC-flight extractor (support/rsc-flight.ts).
//
// setLinkVisibility (app/admin/workspaces/[id]/links-actions.ts) cannot be
// imported and called directly from a vitest test: its first line is
// requireSeller(), which calls lib/supabase/server.ts's createClient(),
// which calls next/headers's cookies() — that throws outside a live Next.js
// request context (confirmed directly in tests/plans/write.spec.ts's "no
// client" case, same reasoning). setLinkVisibilityAsSeller() below performs
// the IDENTICAL mutation the action performs
// (`.from("links").update({ visibility }).eq("id", linkId)`) through a real,
// RLS-scoped, seller-authenticated client obtained via a real sign-in — the
// "direct authenticated update mirroring it" fallback the ticket names. The
// action's own auth guard (requireSeller() / redirect if absent) is already
// covered separately by tests/security/server-action-auth.spec.ts's static
// coverage check; this file is about what the WRITE does to the buyer
// surfaces once it lands, not about re-proving the guard exists.
//
// The two Ticket-30-specific fixture rows (TEST_TOGGLE_LINK_ID,
// TEST_PRIVATE_RESOURCE_TYPE_LINK_ID) are inserted by THIS file's own
// beforeAll, not by seedLeakyWorkspace() itself — see the comment on those
// constants in tests/fixtures/seed-leaky-workspace.ts. Adding them to the
// base seed regressed tests/harness/seed-leaky-workspace.spec.ts and
// tests/plans/portal-payload.spec.ts, both of which assert exact
// shared/private link counts against that base set.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import { toBuyerPayload, type LinkRow, type WorkspaceRow } from "@/lib/portal-payload";
import { requireTestEnv } from "../fixtures/env";
import {
  PRIVATE_LINK_IDS,
  PRIVATE_RESOURCE_TYPE_LINK_LABEL,
  PRIVATE_RESOURCE_TYPE_LINK_URL,
  PRIVATE_RESOURCE_TYPE_VALUE,
  SHARED_LINK_IDS,
  SHARED_LINK_URLS,
  TEST_APPROVED_EMAIL,
  TEST_PRIVATE_RESOURCE_TYPE_LINK_ID,
  TEST_TOGGLE_LINK_ID,
  TOGGLE_LINK_LABEL,
  TOGGLE_LINK_URL,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import { extractRscFlightPayload } from "./support/rsc-flight";
import { startLiveServer, type LiveServer } from "./support/live-server";

const env = requireTestEnv();

/** Mirrors tests/plans/write.spec.ts's signInAsSeller. */
async function signInAsSeller(seeded: LeakyWorkspace): Promise<SupabaseClient> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: seeded.ownerEmail,
    password: seeded.ownerPassword,
  });
  if (error) throw new Error(`seller sign-in failed: ${error.message}`);
  return client;
}

async function setLinkVisibilityAsSeller(
  sellerClient: SupabaseClient,
  linkId: string,
  visibility: "shared" | "private",
): Promise<void> {
  const { error } = await sellerClient.from("links").update({ visibility }).eq("id", linkId);
  if (error) throw new Error(`setLinkVisibilityAsSeller failed: ${error.message}`);
}

/** Inserts this file's own two Ticket-30 rows — see the header comment above. */
async function seedToggleRows(workspaceId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("links").upsert([
    {
      id: TEST_TOGGLE_LINK_ID,
      workspace_id: workspaceId,
      category_header: "Getting started",
      link_label: TOGGLE_LINK_LABEL,
      url_string: TOGGLE_LINK_URL,
      display_order: 100,
      visibility: "shared",
      resource_type: null,
    },
    {
      id: TEST_PRIVATE_RESOURCE_TYPE_LINK_ID,
      workspace_id: workspaceId,
      category_header: "Internal",
      link_label: PRIVATE_RESOURCE_TYPE_LINK_LABEL,
      url_string: PRIVATE_RESOURCE_TYPE_LINK_URL,
      display_order: 101,
      visibility: "private",
      resource_type: PRIVATE_RESOURCE_TYPE_VALUE,
    },
  ]);
  if (error) throw new Error(`seedToggleRows failed: ${error.message}`);
}

/**
 * Mirrors buyer-boundary.spec.ts's loadBuyerPayload, narrowed to just the
 * resources array (plan is irrelevant to this file's assertions).
 */
async function loadBuyerResources(workspaceId: string): Promise<ReturnType<typeof toBuyerPayload>["resources"]> {
  const db = createAdminClient();
  const [{ data: workspace }, { data: links }] = await Promise.all([
    db.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    db.from("links").select("*").eq("workspace_id", workspaceId),
  ]);
  if (!workspace) throw new Error(`fixture workspace ${workspaceId} not found`);
  return toBuyerPayload(workspace as WorkspaceRow, null, (links ?? []) as LinkRow[]).resources;
}

interface HtmlResponse {
  readonly status: number;
  readonly body: string;
}

async function fetchPortalHtml(workspaceId: string, buyerEmail: string): Promise<HtmlResponse> {
  const { value } = createPortalSessionValue(workspaceId, buyerEmail);
  const response = await fetch(`${server.baseUrl}/portal/${workspaceId}`, {
    headers: { cookie: `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}` },
    redirect: "manual",
  });
  return { status: response.status, body: await response.text() };
}

interface TrackResponse {
  readonly status: number;
  readonly location: string | null;
}

async function fetchTrack(workspaceId: string, buyerEmail: string, linkId: string): Promise<TrackResponse> {
  const { value } = createPortalSessionValue(workspaceId, buyerEmail);
  const response = await fetch(`${server.baseUrl}/api/track?linkId=${linkId}&wsId=${workspaceId}`, {
    headers: { cookie: `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}` },
    redirect: "manual",
  });
  return { status: response.status, location: response.headers.get("location") };
}

let seeded: LeakyWorkspace;
let server: LiveServer;
let seller: SupabaseClient;

beforeAll(async () => {
  // Full teardown-then-reseed rather than relying on whatever state a
  // previous file left behind — mirrors tests/plans/write.spec.ts. The
  // fixture's own upsert is idempotent, so this is safe even if a previous
  // run of THIS file crashed mid-toggle and never restored the toggle
  // link's visibility.
  await teardownLeakyWorkspace();
  seeded = await seedLeakyWorkspace();
  await seedToggleRows(seeded.workspaceId);
  server = await startLiveServer();
  seller = await signInAsSeller(seeded);
}, 120_000);

afterAll(async () => {
  try {
    await server?.stop();
  } finally {
    // Deletes every link under the tenant's workspaces, including this
    // file's own seedToggleRows() rows — no separate cleanup needed for them.
    await teardownLeakyWorkspace();
  }
}, 60_000);

describe("T30-7 — staleness proof: shared -> private disappears on the very next fetch", () => {
  it("omits the toggled link from /portal/[id]'s buyer HTML and RSC flight immediately after the toggle", async () => {
    // POSITIVE CONTROL, in the same test as the disappearance assertion
    // rather than a sibling that could be deleted on its own (this suite's
    // established pattern — see buyer-boundary.spec.ts's "Shared resource 1"
    // / "Your deal room" controls). Without this, a portal page that always
    // omits the link (e.g. broken rendering) would pass the "absent after
    // toggle" assertion below for the wrong reason. Asserts on the link
    // LABEL and id (what /portal/[id] actually renders — an
    // `/api/track?linkId=...` href plus the label text), not on
    // TOGGLE_LINK_URL: the portal masks every destination URL behind
    // /api/track by design (app/api/track/route.ts's own header comment:
    // "The buyer portal never exposes a raw destination URL in the DOM"),
    // so a raw url_string can never appear in this page's HTML regardless
    // of whether the visibility filter works — asserting its absence here
    // would be vacuously true and would prove nothing.
    const before = await fetchPortalHtml(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(before.status).toBe(200);
    expect(before.body).toContain(TOGGLE_LINK_LABEL);
    expect(before.body).toContain(TEST_TOGGLE_LINK_ID);

    await setLinkVisibilityAsSeller(seller, TEST_TOGGLE_LINK_ID, "private");

    // No delay, no cache-buster query param, no revalidatePath() call
    // anywhere in this test. There is no cache to invalidate: both
    // app/portal/[id]/page.tsx and app/view/[id]/page.tsx call cookies()
    // (via portalCookieName()/verifyPortalSessionValue()) before they read
    // anything, and calling cookies() opts a Next.js route out of the full
    // static/ISR render cache for that request — every hit is already a
    // fresh, dynamic render. If a future change adds
    // `revalidatePath('/portal/[id]')` "to be safe," it is solving a
    // problem this test proves does not exist.
    const after = await fetchPortalHtml(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(after.status).toBe(200);
    expect(after.body).not.toContain(TOGGLE_LINK_LABEL);
    expect(after.body).not.toContain(TEST_TOGGLE_LINK_ID);

    const flight = extractRscFlightPayload(after.body);
    expect(flight).not.toContain(TOGGLE_LINK_LABEL);
    expect(flight).not.toContain(TEST_TOGGLE_LINK_ID);
  });
});

describe("T30-8 — mirror test: private -> shared appears on the very next fetch", () => {
  it("shows the toggled link on /portal/[id] immediately after flipping it back to shared", async () => {
    // Re-asserts the "currently private" precondition explicitly rather
    // than assuming T30-7 ran first and left it that way — this test must
    // fail with a clear reason (never a silent false pass) if run in
    // isolation, e.g. via `vitest run -t`.
    const db = createAdminClient();
    const { data: current } = await db
      .from("links")
      .select("visibility")
      .eq("id", TEST_TOGGLE_LINK_ID)
      .single();
    if (current?.visibility !== "private") {
      await setLinkVisibilityAsSeller(seller, TEST_TOGGLE_LINK_ID, "private");
    }

    const beforeFlip = await fetchPortalHtml(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(beforeFlip.body).not.toContain(TOGGLE_LINK_LABEL);

    await setLinkVisibilityAsSeller(seller, TEST_TOGGLE_LINK_ID, "shared");

    // Guards against an overzealous negative cache: a naive "remember which
    // links were private and keep hiding them" implementation would pass
    // T30-7 and fail silently here.
    const afterFlip = await fetchPortalHtml(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(afterFlip.status).toBe(200);
    expect(afterFlip.body).toContain(TOGGLE_LINK_LABEL);
    expect(afterFlip.body).toContain(TEST_TOGGLE_LINK_ID);
  });
});

describe("T30-9 — leaky fixture / §C extension: resource_type creates no second leak path", () => {
  it("keeps the private+resource_type link out of toBuyerPayload's resources array — value level, not just field name", async () => {
    const resources = await loadBuyerResources(seeded.workspaceId);

    expect(resources.map((resource) => resource.id)).not.toContain(TEST_PRIVATE_RESOURCE_TYPE_LINK_ID);
    // The actual url_string VALUE, not merely the absence of a "url_string"
    // key — a renamed or restructured field would still fail this.
    expect(resources.map((resource) => resource.url_string)).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_URL);
    expect(JSON.stringify(resources)).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_URL);
  });

  it("keeps the private+resource_type link's id and label out of /portal/[id]'s HTML and RSC flight payload", async () => {
    const { status, body } = await fetchPortalHtml(seeded.workspaceId, TEST_APPROVED_EMAIL);
    expect(status).toBe(200);

    // POSITIVE CONTROL — same reasoning as T30-7's above.
    expect(body).toContain("Shared resource 1");

    // What the page would actually render if the private filter failed:
    // the id in an /api/track href, and the label as link text. (Asserting
    // url_string absence too, for completeness against the ticket's literal
    // wording — see this file's header comment on why that check alone is
    // structurally guaranteed regardless of correctness.)
    expect(body).not.toContain(TEST_PRIVATE_RESOURCE_TYPE_LINK_ID);
    expect(body).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_LABEL);
    expect(body).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_URL);

    const flight = extractRscFlightPayload(body);
    expect(flight).not.toContain(TEST_PRIVATE_RESOURCE_TYPE_LINK_ID);
    expect(flight).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_LABEL);
    expect(flight).not.toContain(PRIVATE_RESOURCE_TYPE_LINK_URL);
  });
});

describe("T30-10 — B2 regression: /api/track does not resolve a private link, and is indistinguishable from a nonexistent one", () => {
  // Fixed, never seeded by any fixture, so a lookup for it can only ever
  // return "does not exist" — mirrors buyer-boundary.spec.ts's
  // NONEXISTENT_WORKSPACE_ID convention, applied to a link id instead of a
  // workspace id.
  const NONEXISTENT_LINK_ID = "7e570000-0000-4000-8000-0000000000ff";

  it("resolves a shared link's id to its own destination — positive control proving the lookup runs at all", async () => {
    // Without this, every assertion below would be equally well satisfied
    // by a handler that unconditionally redirects to /portal regardless of
    // linkId, which would prove nothing about the visibility filter
    // specifically. This suite's established positive-control pattern (see
    // this file's other describe blocks, and buyer-boundary.spec.ts).
    const result = await fetchTrack(seeded.workspaceId, TEST_APPROVED_EMAIL, SHARED_LINK_IDS[0]);
    expect(result.status).toBe(302);
    expect(result.location).toBe(SHARED_LINK_URLS[0]);
  });

  it("a private link id and a nonexistent link id produce the identical redirect — same status, same Location", async () => {
    // The valid buyer session is REQUIRED here, not incidental: without a
    // session /api/track already redirects to /portal/{wsId} for every
    // linkId (session-missing branch), which would make private and
    // nonexistent indistinguishable for the wrong reason and prove nothing
    // about the visibility filter (fix B2) specifically. A held, valid
    // session for the OWNING workspace is what makes this a real test of
    // the `.eq("visibility", "shared")` filter in app/api/track/route.ts.
    const privateResult = await fetchTrack(seeded.workspaceId, TEST_APPROVED_EMAIL, PRIVATE_LINK_IDS[0]);
    const nonexistentResult = await fetchTrack(seeded.workspaceId, TEST_APPROVED_EMAIL, NONEXISTENT_LINK_ID);

    // Substring match on the path, not a hardcoded absolute URL: the
    // server's own request.url can legitimately report a different host
    // (e.g. "localhost" vs the "127.0.0.1" this suite dials) than
    // server.baseUrl without that being a security-relevant difference —
    // the equality check two lines below is the actual proof, this is only
    // a sanity check that both really did fall through to the portal
    // fallback rather than, say, a raw 404.
    const portalFallbackPath = `/portal/${seeded.workspaceId}`;
    expect(privateResult.status).toBe(302);
    expect(privateResult.location).toContain(portalFallbackPath);

    expect(nonexistentResult.status).toBe(302);
    expect(nonexistentResult.location).toContain(portalFallbackPath);

    // The actual proof: not merely "both happen to fall back to /portal"
    // individually, but that the two responses are identical to each other
    // — this is what keeps the enumeration oracle closed. A regression that
    // returned, say, a distinct 404 for "private" versus the /portal
    // fallback for "nonexistent" would fail here even though each
    // individual assertion above could still pass.
    expect(privateResult.status).toBe(nonexistentResult.status);
    expect(privateResult.location).toBe(nonexistentResult.location);
  });

  it("does not log a link_click analytics event for the private link's blocked attempt", async () => {
    // Defence-in-depth check: the visibility filter must reject the lookup
    // BEFORE the analytics insert, not merely redirect afterwards having
    // already recorded a click on a resource the buyer was never shown.
    const db = createAdminClient();
    const before = await db
      .from("workspace_analytics")
      .select("id")
      .eq("workspace_id", seeded.workspaceId)
      .eq("link_id", PRIVATE_LINK_IDS[0])
      .eq("action_type", "link_click");

    await fetchTrack(seeded.workspaceId, TEST_APPROVED_EMAIL, PRIVATE_LINK_IDS[0]);

    const after = await db
      .from("workspace_analytics")
      .select("id")
      .eq("workspace_id", seeded.workspaceId)
      .eq("link_id", PRIVATE_LINK_IDS[0])
      .eq("action_type", "link_click");

    expect(after.data?.length ?? 0).toBe(before.data?.length ?? 0);
  });
});
