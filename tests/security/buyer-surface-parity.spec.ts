// T34-7 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Both-surfaces
// parity: /portal/[id] and /view/[id] mount the SAME BuyerWorkspaceView
// through the SAME loader (T34-1/T34-2) for the same workspace, so their
// granted-branch visible content should be identical, and — independently
// of that equality claim — neither should leak anything sensitive-adjacent
// that the other does not. These are two different assertions on purpose:
// content equality alone would not catch a leak present on BOTH surfaces
// (equal, but equally wrong), and a leak-absence check alone would not catch
// one surface silently rendering less (or different) content than the
// other. Live, over HTTP, via the real Next.js server — reuses
// tests/security/support/live-server.ts exactly as buyer-boundary.spec.ts
// does, never a second boot mechanism.
//
// Uses lib/demo.ts's DEMO_WORKSPACE_ID (npm run seed:demo) rather than
// tests/fixtures/seed-leaky-workspace.ts's TEST_WORKSPACE_ID, because /view
// is hard-scoped to DEMO_TENANT_ID (app/view/[id]/page.tsx's
// requireTenantId) — the leaky fixture's workspace lives under a different
// tenant and would 404 on /view regardless of session, which would make
// this file's "same workspace, both routes" premise false. Session
// authentication reuses buyer-boundary.spec.ts's own established technique
// (mint a signed portal-session cookie per lib/portal-session.ts and send it
// as a request header) rather than driving either gate's actual form — that
// is what T34-9's Playwright spec does, for the one assertion (portal_view
// row count) that genuinely needs the real gate mechanism; this file's claim
// is about RENDERED CONTENT once a session already exists, which is
// identical in substance whichever gate issued it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_PRIVATE_RESOURCE_URLS, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import { FORBIDDEN_FIELD_PATTERNS } from "../fixtures/seed-leaky-workspace";
import { extractRscFlightPayload } from "./support/rsc-flight";
import { startLiveServer, type LiveServer } from "./support/live-server";

const PARITY_BUYER_EMAIL = "buyer.parity-check@acme-logistics.example.com";

let server: LiveServer;

interface HtmlResponse {
  readonly status: number;
  readonly body: string;
}

async function fetchGranted(path: string, workspaceId: string, email: string): Promise<HtmlResponse> {
  const { value } = createPortalSessionValue(workspaceId, email);
  const response = await fetch(`${server.baseUrl}${path}`, {
    headers: { cookie: `${portalCookieName(workspaceId)}=${encodeURIComponent(value)}` },
    redirect: "manual",
  });
  return { status: response.status, body: await response.text() };
}

/**
 * Reduces a full HTML document to its VISIBLE text: the <body>...</body>
 * region, with every <script> block removed first (this is where the RSC
 * flight payload and hydration bootstrap live — implementation, not
 * content, and the two routes' internal module references differ even when
 * their rendered output does not), then every remaining tag stripped, HTML
 * entities decoded, and whitespace collapsed. "Gate-specific chrome" — the
 * outer `data-surface="view"` / `data-surface="portal"` wrapper div each
 * layout.tsx adds — carries no text of its own, so it disappears here
 * without needing to be special-cased.
 */
function extractVisibleBodyText(html: string): string {
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1] : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Every FORBIDDEN_FIELD_PATTERNS match, plus any of the demo tenant's
 *  private resource URLs, found verbatim in `text`. Case-insensitive and
 *  lower-cased on insert so two differently-cased occurrences of the same
 *  field name count as the same finding rather than inflating a diff. */
function findSensitiveAdjacentMatches(text: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of FORBIDDEN_FIELD_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const matches = text.match(new RegExp(pattern.source, flags));
    matches?.forEach((match) => found.add(match.toLowerCase()));
  }
  for (const url of DEMO_PRIVATE_RESOURCE_URLS) {
    if (text.includes(url)) found.add(url);
  }
  return found;
}

function onlyIn(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((value) => !b.has(value));
}

beforeAll(async () => {
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  await server?.stop();
}, 60_000);

describe("buyer surface parity — /portal/[id] vs /view/[id] for the same workspace (T34-7)", () => {
  it("renders the same normalised visible content on both surfaces, and neither leaks anything the other does not", async (ctx) => {
    // Per Step 6's own precedent (buyer-boundary.spec.ts's /view assertions):
    // a failed existence query and a genuinely absent seed are NOT the same
    // thing — fail loudly on a query error, skip only on a confirmed-empty
    // result, so an infrastructure failure can never be mistaken for "the
    // demo seed just isn't here."
    const db = createAdminClient();
    const { data: demoWorkspace, error: demoWorkspaceError } = await db
      .from("workspaces")
      .select("id")
      .eq("id", DEMO_WORKSPACE_ID)
      .maybeSingle();
    if (demoWorkspaceError) {
      throw new Error(
        `cannot determine whether the demo seed is present: ${demoWorkspaceError.message} — this is an ` +
          "environment failure, not an absent seed; fix it rather than skipping the check",
      );
    }
    if (!demoWorkspace) {
      ctx.skip();
      return;
    }

    const portal = await fetchGranted(`/portal/${DEMO_WORKSPACE_ID}`, DEMO_WORKSPACE_ID, PARITY_BUYER_EMAIL);
    const view = await fetchGranted(`/view/${DEMO_WORKSPACE_ID}`, DEMO_WORKSPACE_ID, PARITY_BUYER_EMAIL);

    // POSITIVE CONTROL — both branches are actually the granted render, not
    // some other 200 (a gate, an error page). Without this, a regression
    // that broke session verification on one surface (making it fall back
    // to an unauthenticated branch) would leave the rest of this test
    // vacuously green: two DIFFERENT unauthenticated gate pages would still
    // fail equality, but two pages that both happened to redirect or both
    // 404 in the same way would not be caught by content equality alone.
    expect(portal.status).toBe(200);
    expect(view.status).toBe(200);
    expect(portal.body).toContain('data-testid="buyer-workspace"');
    expect(view.body).toContain('data-testid="buyer-workspace"');

    // ── Assertion 1: same normalised visible content ──────────────────
    const portalVisible = extractVisibleBodyText(portal.body);
    const viewVisible = extractVisibleBodyText(view.body);
    expect(portalVisible).toBe(viewVisible);
    // Guard the equality assertion itself against a vacuous "both empty"
    // pass — there must be real rendered content to have compared.
    expect(portalVisible.length).toBeGreaterThan(200);

    // ── Assertion 2: neither leaks anything the other does not ────────
    const portalFlight = extractRscFlightPayload(portal.body);
    const viewFlight = extractRscFlightPayload(view.body);
    const portalMatches = findSensitiveAdjacentMatches(`${portal.body}\n${portalFlight}`);
    const viewMatches = findSensitiveAdjacentMatches(`${view.body}\n${viewFlight}`);

    expect([...portalMatches], "portal must not leak any sensitive-adjacent string").toEqual([]);
    expect([...viewMatches], "view must not leak any sensitive-adjacent string").toEqual([]);
    // Symmetric-difference form, not just "both empty": this is what would
    // actually catch an ASYMMETRIC leak — one surface exposing something
    // the other correctly withholds — rather than relying on both totals
    // independently landing on zero for unrelated reasons.
    expect(onlyIn(portalMatches, viewMatches), "present on /portal but not /view").toEqual([]);
    expect(onlyIn(viewMatches, portalMatches), "present on /view but not /portal").toEqual([]);
  });
});
