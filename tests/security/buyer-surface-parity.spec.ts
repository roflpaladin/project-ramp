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
 * Extracts the raw HTML of the element carrying `data-testid="${testId}"`,
 * INCLUDING its full subtree, via tag-depth counting on that element's own
 * tag name (not a whole-document regex) — the only way to find its true
 * closing tag when the subtree contains nested elements of the same tag
 * name (BuyerWorkspaceView's root is a <div> and so are several of its
 * descendants).
 *
 * Failure mode this exists to close (found in CI, not locally): comparing
 * the WHOLE <body> region's text is timing-sensitive under a slow render —
 * Next/React can stream head-adjacent metadata (e.g. the page <title> text)
 * into the body region as a trailing text node, present on a slow CI
 * runner's response but not on a fast local one, which broke exact-text
 * equality for a reason that had nothing to do with the buyer boundary.
 * Scoping extraction to BuyerWorkspaceView's own root element — the one
 * thing both surfaces actually mount identically — removes that streamed
 * chrome from the comparison instead of trying to pattern-match it away.
 *
 * Throws (fails the test loudly, never a vacuous pass) if `testId` is not
 * found, or if its tags are unbalanced — a missing testid on either surface
 * is itself a parity failure, not something to silently skip past.
 */
function extractTestIdSubtreeHtml(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`extractTestIdSubtreeHtml: no element with ${marker} found in this surface's HTML`);
  }

  const tagStart = html.lastIndexOf("<", markerIndex);
  const tagNameMatch = tagStart === -1 ? null : /^<([a-zA-Z][\w-]*)/.exec(html.slice(tagStart, tagStart + 40));
  if (tagStart === -1 || !tagNameMatch) {
    throw new Error(`extractTestIdSubtreeHtml: could not determine the enclosing tag for ${marker}`);
  }
  const tagName = tagNameMatch[1];

  const boundaryRe = new RegExp(`<${tagName}(?=[\\s>])|</${tagName}>`, "g");
  boundaryRe.lastIndex = tagStart;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = boundaryRe.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return html.slice(tagStart, match.index + match[0].length);
      }
    } else {
      depth++;
    }
  }
  throw new Error(`extractTestIdSubtreeHtml: unbalanced <${tagName}> tags while extracting ${marker}`);
}

/**
 * Reduces one element's HTML subtree to its VISIBLE text: any <script>
 * block removed first (BuyerWorkspaceView mounts no client-component script
 * of its own, but this stays defensive rather than assuming), then every
 * remaining tag stripped, HTML entities decoded, and whitespace collapsed.
 */
function htmlToVisibleText(html: string): string {
  return html
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
    // Scoped to BuyerWorkspaceView's own root subtree (data-testid=
    // "buyer-workspace"), not the whole <body> — see extractTestIdSubtreeHtml's
    // header comment for the CI streaming-timing failure this fixes.
    // extractTestIdSubtreeHtml() throws (failing this test, not skipping it)
    // if the testid is missing from either surface's HTML.
    const portalVisible = htmlToVisibleText(extractTestIdSubtreeHtml(portal.body, "buyer-workspace"));
    const viewVisible = htmlToVisibleText(extractTestIdSubtreeHtml(view.body, "buyer-workspace"));
    expect(portalVisible).toBe(viewVisible);
    // Guard the equality assertion itself against a vacuous "both empty"
    // pass — there must be real rendered content to have compared.
    expect(portalVisible.length).toBeGreaterThan(200);

    // ── Assertion 2: neither leaks anything the other does not ────────
    // Deliberately UNSCOPED — the full raw HTML of each surface (plus its
    // RSC flight payload below), not the testid subtree above. A leak
    // outside BuyerWorkspaceView's own markup (e.g. back in generateMetadata,
    // exactly T34-6's shape) must still be caught here even though
    // Assertion 1 no longer looks at that region.
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
