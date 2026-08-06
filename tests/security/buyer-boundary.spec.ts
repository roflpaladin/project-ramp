// Sprint 5 · Ticket 26 — the buyer leakage test suite. THE SPRINT GATE.
//
// No Sprint 6 or Sprint 7 ticket merges until this file is green. Read
// plans/sprint-5-mutual-success-plan-spine.md §2.1 before touching this file —
// it is the whole design of the two-tier structure below.
//
// TIER 1 (must be green to close Sprint 5): payload-level pattern + value-level
// assertions, the new-column allowlist proof, the seller-step asymmetry
// assertion, rendered-HTML + RSC-flight greps of /view/[id] and /portal/[id],
// and the no-enumeration-oracle check. Everything here is provable today
// against the repo as it stands after Ticket 25.
//
// TIER 2 (written now, self-activating): route-existence probe + assertion
// pairs for endpoints that do not exist until Sprint 6 (Ticket 28) and Sprint 7
// (Ticket 35). Each pair skips with an explicit PENDING reason while its route
// is absent, and runs for real — as a build-blocking assertion — the moment the
// route lands. A meta-test enforces that there is no separate "disabled" flag
// for anyone to forget to flip.
//
// !! RLS IS NOT THE BUYER BOUNDARY !! Every check below exercises the actual
// service-role read path buyers go through (lib/portal-payload.ts,
// app/view/[id]/page.tsx, app/portal/[id]/page.tsx), never an RLS-scoped
// client. A pattern-based FORBIDDEN list is used throughout, never a
// hand-maintained field-name list — see the new-column proof for why.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_PRIVATE_RESOURCE_URLS, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { getPlanForBuyer } from "@/lib/plans/queries";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import {
  toBuyerPayload,
  type BuyerPayload,
  type LinkRow,
  type WorkspaceRow,
} from "@/lib/portal-payload";
import {
  FOREIGN_WORKSPACE_ID,
  PRIVATE_LINK_URLS,
  TEST_APPROVED_EMAIL,
  TEST_SELLER_STEP_ID,
  forbiddenValuesFor,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import { extractRscFlightPayload } from "./support/rsc-flight";
import { startLiveServer, type LiveServer } from "./support/live-server";
import { pendingReason, routeFileExists } from "./support/route-probe";
import { buildSellerCookieHeader } from "./support/seller-http-session";

/**
 * Pattern-based, never a hand-maintained list of field names — a list only
 * ever covers the fields someone remembered on the day they wrote it.
 */
const FORBIDDEN: readonly RegExp[] = [
  /crm_/i,
  // T32-6 (Sprint 6, Ticket 32): this pattern, plus INTERNAL_CHAT_URL in
  // FORBIDDEN_VALUES (tests/fixtures/seed-leaky-workspace.ts) via
  // forbiddenValuesFor() below, already cover workspaces.internal_chat_url
  // end-to-end -- payload JSON, rendered HTML, and RSC flight, on both
  // /portal/[id] and /view/[id]. See also the explicit chat_url-passes /
  // internal_chat_url-drops assertion in tests/plans/portal-payload.spec.ts.
  // Confirmed free coverage; deliberately no duplicate test added here.
  /internal_chat/i,
  /private_note/i,
  /tenant_id/i,
  /approved_emails/i,
  /created_by/i,
];

// Fixed, never seeded by any fixture or seed script, so a lookup for it can
// only ever return "does not exist."
const NONEXISTENT_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000ee";

let seeded: LeakyWorkspace;
let server: LiveServer;

async function fetchRows(workspaceId: string): Promise<{ workspace: WorkspaceRow; links: LinkRow[] }> {
  const db = createAdminClient();
  const [{ data: workspace }, { data: links }] = await Promise.all([
    db.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    db.from("links").select("*").eq("workspace_id", workspaceId),
  ]);
  if (!workspace) throw new Error(`fixture workspace ${workspaceId} not found`);
  return { workspace: workspace as WorkspaceRow, links: (links ?? []) as LinkRow[] };
}

/** Mirrors what the buyer loaders do: full rows in, payload out. */
async function loadBuyerPayload(workspaceId: string): Promise<BuyerPayload> {
  const [{ workspace, links }, plan] = await Promise.all([
    fetchRows(workspaceId),
    getPlanForBuyer(workspaceId),
  ]);
  return toBuyerPayload(workspace, plan, links);
}

interface HtmlResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Fetches a page from the live server, optionally carrying a signed portal
 * session cookie for `sessionWorkspaceId`. Never follows redirects — a 3xx is
 * meaningful (e.g. "no session, go to the gate") and collapsing it into a 200
 * would hide the actual response shape from the assertions below.
 */
async function fetchHtml(
  path: string,
  sessionWorkspaceId?: string,
  sessionEmail?: string,
): Promise<HtmlResponse> {
  const headers: Record<string, string> = {};
  if (sessionWorkspaceId && sessionEmail) {
    const { value } = createPortalSessionValue(sessionWorkspaceId, sessionEmail);
    headers.cookie = `${portalCookieName(sessionWorkspaceId)}=${encodeURIComponent(value)}`;
  }
  const response = await fetch(`${server.baseUrl}${path}`, { headers, redirect: "manual" });
  const body = await response.text();
  return { status: response.status, body };
}

beforeAll(async () => {
  seeded = await seedLeakyWorkspace();
  server = await startLiveServer();
}, 120_000);

afterAll(async () => {
  // Cleanup must never depend on the tests above having passed (§2.3). Each
  // step runs independently of whether the other threw.
  try {
    await server?.stop();
  } finally {
    await teardownLeakyWorkspace();
  }
}, 60_000);

describe("Tier 1 — must be green to close Sprint 5", () => {
  describe("toBuyerPayload — pattern and value level", () => {
    it("emits no private field name, by pattern rather than by a hand-maintained list", async () => {
      const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

      for (const pattern of FORBIDDEN) {
        expect(json).not.toMatch(pattern);
      }
    });

    it("emits no private VALUE — a field can be renamed, a URL or a CRM amount cannot", async () => {
      const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

      for (const forbidden of forbiddenValuesFor(seeded)) {
        expect(json).not.toContain(forbidden);
      }
    });

    it("omits both seeded private link URLs from the payload", async () => {
      const payload = await loadBuyerPayload(seeded.workspaceId);
      const urls = payload.resources.map((resource) => resource.url_string);

      for (const privateUrl of PRIVATE_LINK_URLS) {
        expect(urls).not.toContain(privateUrl);
      }
    });
  });

  describe("the deliberate asymmetry", () => {
    it("keeps seller-owned steps visible to the buyer, with private_note stripped", async () => {
      // Buyer visibility of what the seller has committed to IS the product
      // (PRD §2.5). A payload that dropped seller steps entirely would pass
      // every leak assertion in this file and still be the wrong fix.
      const payload = await loadBuyerPayload(seeded.workspaceId);
      const steps = payload.plan?.stages.flatMap((stage) => stage.steps) ?? [];
      const sellerSteps = steps.filter((step) => step.owner_side === "seller");

      expect(sellerSteps.length).toBeGreaterThan(0);
      expect(sellerSteps.some((step) => step.id === TEST_SELLER_STEP_ID)).toBe(true);
      expect(JSON.stringify(sellerSteps)).not.toMatch(/private_note/i);
    });
  });

  describe("new-column allowlist proof", () => {
    // Proves toBuyerPayload is a genuine allowlist, not a denylist that a
    // future migration can outrun. The column is added via real DDL — not
    // injected onto a JS object — so this also proves the loaders' select("*")
    // surfaces the new column; a column never fetched cannot leak, which would
    // make the proof vacuous. See supabase/migrations/0006_test_ddl_helpers.sql
    // and plans/sprint-5-mutual-success-plan-spine.md Amendments (2026-08-01).
    beforeAll(async () => {
      const db = createAdminClient();
      const { error: addError } = await db.rpc("test_add_crm_arr");
      if (addError) throw new Error(`test_add_crm_arr failed: ${addError.message}`);

      // PostgREST caches the table schema and reloads it asynchronously after
      // DDL. Hosted Supabase runs multiple PostgREST replicas behind a load
      // balancer, each with its OWN cache, so even a successful read-probe
      // against one replica does not guarantee the next write lands on a
      // replica that has refreshed — observed directly while writing this
      // test: a passing select-probe was immediately followed by an update
      // that still 404'd on the column. Retrying the actual write, not just a
      // probe read, is what a multi-replica cache actually requires.
      const deadline = Date.now() + 15_000;
      let lastError: string | undefined;
      while (Date.now() < deadline) {
        const { error: updateError } = await db
          .from("workspaces")
          .update({ crm_arr: 999999 })
          .eq("id", seeded.workspaceId);
        if (!updateError) {
          lastError = undefined;
          break;
        }
        lastError = updateError.message;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (lastError) throw new Error(`seeding crm_arr failed after retrying for 15s: ${lastError}`);
    }, 25_000);

    afterAll(async () => {
      // Runs even if the assertion below failed (vitest calls afterAll
      // regardless of test outcome within the suite). Swallow rather than
      // throw: a cleanup failure here must never mask what the test itself
      // reported.
      const db = createAdminClient();
      try {
        await db.rpc("test_drop_crm_arr");
      } catch {
        // Swallowed deliberately: a cleanup failure here must never mask
        // whatever the test itself reported.
      }
    });

    it("keeps crm_arr and its value out of the payload — with ZERO edits to the FORBIDDEN patterns above", async () => {
      // Guard against a vacuous pass: on a multi-replica PostgREST setup, the
      // raw select("*") this test's own read path performs could itself land
      // on a replica whose cache has not caught up, in which case crm_arr
      // would never be fetched at all — the strip would get credit for doing
      // nothing. Confirm the raw row genuinely carries the new value before
      // trusting the payload's absence of it.
      const db = createAdminClient();
      const rawDeadline = Date.now() + 15_000;
      let rawHasValue = false;
      while (Date.now() < rawDeadline && !rawHasValue) {
        const { data } = await db
          .from("workspaces")
          .select("*")
          .eq("id", seeded.workspaceId)
          .maybeSingle();
        rawHasValue = (data as (WorkspaceRow & { crm_arr?: number }) | null)?.crm_arr === 999999;
        if (!rawHasValue) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!rawHasValue) {
        throw new Error(
          "raw select(\"*\") never returned crm_arr=999999 within 15s — cannot prove the strip did " +
            "anything; this is an environment/PostgREST-cache issue, not a boundary failure",
        );
      }

      const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

      expect(json).not.toContain("999999");
      expect(json).not.toMatch(/crm_arr/i);

      // Re-run the same FORBIDDEN array declared at the top of this file. The
      // entire point of this test is that array was never touched to make it
      // pass — if it needed editing, the boundary regressed to a denylist.
      for (const pattern of FORBIDDEN) {
        expect(json).not.toMatch(pattern);
      }
    }, 20_000);
  });

  describe("rendered HTML and RSC flight payload — /portal/[id]", () => {
    it("neither the raw HTML nor the RSC flight payload contains any forbidden value", async () => {
      const { status, body } = await fetchHtml(
        `/portal/${seeded.workspaceId}`,
        seeded.workspaceId,
        TEST_APPROVED_EMAIL,
      );
      expect(status).toBe(200);

      // POSITIVE CONTROL, asserted in the SAME test as the leak greps rather
      // than in a sibling that could be deleted on its own. /portal/[id]
      // answers 200 for BOTH the authenticated deal room and the
      // unauthenticated access gate, so status alone says nothing about which
      // page we are holding. Without this line a regression that breaks portal
      // auth outright would leave every assertion below green while never once
      // reaching toBuyerPayload — green, and guarding nothing.
      expect(body).toContain("Shared resource 1");

      for (const forbidden of forbiddenValuesFor(seeded)) {
        expect(body).not.toContain(forbidden);
      }

      // The actual bug vector: props handed to a Client Component are
      // serialized into this payload even when never rendered. Grepping the
      // raw body alone would still catch it (the script tag is part of the
      // body), but this proves the leak is not hiding specifically there.
      const flight = extractRscFlightPayload(body);
      for (const forbidden of forbiddenValuesFor(seeded)) {
        expect(flight).not.toContain(forbidden);
      }
    });

    it("still renders the buyer-visible resources — the strip is not overzealous", async () => {
      const { body } = await fetchHtml(`/portal/${seeded.workspaceId}`, seeded.workspaceId, TEST_APPROVED_EMAIL);

      expect(body).toContain("Shared resource 1");
    });
  });

  describe("rendered HTML and RSC flight payload — /view/[id]", () => {
    it(
      "neither the raw HTML nor the RSC flight payload contains the demo tenant's private resource URLs",
      async (ctx) => {
        // /view/[id] is hard-scoped to DEMO_TENANT_ID (app/view/[id]/page.tsx) —
        // it 404s for any workspace outside the demo tenant, so this check can
        // only run against the seeded demo deal room (Ticket 27), not the
        // Ticket 23 leaky fixture. Per sprint plan §1, Step 6 does not block on
        // Step 4 — if the demo seed is not present in this environment, this
        // assertion skips loudly rather than reporting a false pass.
        const db = createAdminClient();
        const { data: demoLinks, error: demoLinksError } = await db
          .from("links")
          .select("id")
          .eq("workspace_id", DEMO_WORKSPACE_ID)
          .limit(1);

        // A failed query and an unseeded environment are NOT the same thing.
        // Destructuring only `data` makes a bad service-role key, an RLS
        // misconfiguration or a transient PostgREST outage indistinguishable
        // from "the demo seed isn't here" — turning an infrastructure failure
        // into a silent skip of a gate check. Fail on error; skip only on a
        // genuinely empty result.
        if (demoLinksError) {
          throw new Error(
            `cannot determine whether the demo seed is present: ${demoLinksError.message} — ` +
              "this is an environment failure, not an absent seed; fix it rather than skipping the check",
          );
        }
        if (demoLinks.length === 0) {
          ctx.skip();
          return;
        }

        const { status, body } = await fetchHtml(
          `/view/${DEMO_WORKSPACE_ID}`,
          DEMO_WORKSPACE_ID,
          "buyer.leakcheck@acme-logistics.example.com",
        );
        expect(status).toBe(200);

        // POSITIVE CONTROL — the fix for the confirmed vacuous pass in this
        // test. app/view/[id]/page.tsx renders the unauthenticated "Enter your
        // deal room" gate with status 200, exactly like the granted view. A
        // fetch carrying no valid session therefore satisfied every assertion
        // below while never reaching GrantedView or toBuyerPayload: the check
        // was green and proved nothing. Demonstrated adversarially, not
        // theorised. Assert we are holding the granted page before concluding
        // anything from what is missing from it.
        expect(body).toContain("Your deal room");

        for (const privateUrl of DEMO_PRIVATE_RESOURCE_URLS) {
          expect(body).not.toContain(privateUrl);
        }

        const flight = extractRscFlightPayload(body);
        for (const privateUrl of DEMO_PRIVATE_RESOURCE_URLS) {
          expect(flight).not.toContain(privateUrl);
        }
      },
    );
  });

  describe("no enumeration oracle", () => {
    /**
     * The plan (Step 6, task 2) asks for identical status AND body. Raw byte
     * equality cannot be asserted directly: Next.js encrypts a server action's
     * bound arguments per request, so two responses differ in ciphertext even
     * when neither leaks a thing — the assertion would fail against a perfectly
     * correct implementation, and would then be weakened or deleted by whoever
     * met it next.
     *
     * Normalising the per-request ciphertext and the ids themselves leaves the
     * page structure and copy, which is where a real oracle shows up: a
     * "no such deal room" page that words itself differently from a "not yours"
     * page is an oracle even when it never prints either id. Asserting on the
     * remainder is stronger than the status-plus-id-absence check it replaces,
     * without being unstable.
     */
    function normalizeForOracleComparison(body: string): string {
      return body
        .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "«opaque»")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "«uuid»");
    }

    it("/view/[id] returns identical status for a nonexistent workspace and another tenant's real workspace", async () => {
      const nonexistent = await fetchHtml(`/view/${NONEXISTENT_WORKSPACE_ID}`);
      const foreign = await fetchHtml(`/view/${FOREIGN_WORKSPACE_ID}`);

      expect(nonexistent.status).toBe(foreign.status);
      // Both are outside DEMO_TENANT_ID, so both must 404 identically — a
      // buyer must not be able to tell "this workspace does not exist" apart
      // from "this workspace exists but isn't the demo tenant."
      expect(nonexistent.status).toBe(404);
      expect(normalizeForOracleComparison(nonexistent.body)).toBe(
        normalizeForOracleComparison(foreign.body),
      );
    });

    it("/portal/[id] returns identical status for a nonexistent workspace and another tenant's real workspace, with no session", async () => {
      const nonexistent = await fetchHtml(`/portal/${NONEXISTENT_WORKSPACE_ID}`);
      const foreign = await fetchHtml(`/portal/${FOREIGN_WORKSPACE_ID}`);

      expect(nonexistent.status).toBe(foreign.status);
      // Neither response may name or otherwise distinguish the counterpart
      // workspace — an unauthenticated visitor sees the same access-request
      // gate regardless of whether the id they guessed is real.
      expect(nonexistent.body).not.toContain(FOREIGN_WORKSPACE_ID);
      expect(foreign.body).not.toContain(NONEXISTENT_WORKSPACE_ID);
      // Beyond "neither names the other": the two gates must be the same page.
      // Divergent copy, title or length distinguishes "never existed" from
      // "exists, not yours" just as effectively as printing the id would.
      expect(normalizeForOracleComparison(nonexistent.body)).toBe(
        normalizeForOracleComparison(foreign.body),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TIER 2 — written now, self-activating (sprint plan §2.1).
//
// Each probe is registered once, unconditionally. There is no separate
// "enabled" flag: the code checks the filesystem for the route handler and
// wires either `it.skip` (route absent) or a live `it` (route present) to the
// SAME assertion function. That structural fact — not a comment, not a flag
// someone has to remember to flip — is what makes this self-activating. The
// meta-test below re-derives it independently rather than trusting this
// paragraph.
// ─────────────────────────────────────────────────────────────────────────

interface Tier2Probe {
  readonly name: string;
  readonly ticket: string;
  readonly routeFile: string;
  readonly assert: () => Promise<void>;
}

const tier2Registry: Tier2Probe[] = [];

interface Tier2Wiring {
  readonly routeFile: string;
  /** True iff tier2() actually wired a live `it` for this probe, not `it.skip`. */
  readonly live: boolean;
}

// Records what tier2() ACTUALLY did, separately from tier2Registry (which
// only records what was registered) and separately from Tier2Probe itself
// (which must carry no enabled/disabled/skip field — see the sibling meta
// test below). This is what lets the meta-test catch a hand-forced
// `it.skip`, not just re-derive routeFileExists() a second time.
const tier2Wiring: Tier2Wiring[] = [];

/**
 * Registers one Tier 2 probe as BOTH a collection-time entry (for the meta
 * test below) and an actual vitest test. Registration happens synchronously,
 * at collection time — vitest only sees tests declared during the describe
 * body itself, so whether a probe runs live or skips is decided HERE, from
 * the filesystem, not behind a flag anyone has to remember to flip. That is
 * the entire self-activating mechanism; everything else in this file is
 * plumbing around it.
 */
function tier2(probe: Tier2Probe): void {
  tier2Registry.push(probe);
  const exists = routeFileExists(probe.routeFile);
  const runner = exists ? it : it.skip;
  // Captures the runner tier2() actually chose (via `runner === it`), not
  // just `exists`, so a future edit that hand-forces `it.skip` for a route
  // that exists on disk is caught by the meta-test below rather than by
  // re-deriving the same routeFileExists() call a second time.
  tier2Wiring.push({ routeFile: probe.routeFile, live: runner === it });
  runner(exists ? probe.name : pendingReason(probe.name, probe.ticket), probe.assert);
}

describe("Tier 2 — POST /api/steps/[id]/complete (Ticket 35)", () => {
  const ROUTE_FILE = "app/api/steps/[id]/complete/route.ts";

  tier2({
    name: "buyer completing a seller-owned step is refused with zero side effects",
    ticket: "35",
    routeFile: ROUTE_FILE,
    assert: async () => {
      const db = createAdminClient();
      const before = await db.from("plan_steps").select("status, completed_at").eq("id", TEST_SELLER_STEP_ID).single();
      const analyticsBefore = await db
        .from("workspace_analytics")
        .select("id")
        .eq("step_id", TEST_SELLER_STEP_ID)
        .eq("action_type", "step_complete");

      const response = await fetch(`${server.baseUrl}/api/steps/${TEST_SELLER_STEP_ID}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${portalCookieName(seeded.workspaceId)}=${encodeURIComponent(
            createPortalSessionValue(seeded.workspaceId, TEST_APPROVED_EMAIL).value,
          )}`,
        },
        // Spoofed owner_side in the body must be ignored — the server derives
        // ownership from the step row, never trusts the client's claim.
        body: JSON.stringify({ owner_side: "buyer" }),
      });
      expect(response.status).toBe(403);

      const after = await db.from("plan_steps").select("status, completed_at").eq("id", TEST_SELLER_STEP_ID).single();
      expect(after.data).toEqual(before.data);

      const analyticsAfter = await db
        .from("workspace_analytics")
        .select("id")
        .eq("step_id", TEST_SELLER_STEP_ID)
        .eq("action_type", "step_complete");
      expect(analyticsAfter.data?.length ?? 0).toBe(analyticsBefore.data?.length ?? 0);
    },
  });

  tier2({
    name: "completing a step for another workspace's session returns 404, not 403",
    ticket: "35",
    routeFile: ROUTE_FILE,
    assert: async () => {
      // A wrong-workspace session must not be able to distinguish "step exists
      // but isn't yours" (403) from "step doesn't exist" (404) — 403 would leak
      // that the id is valid.
      const response = await fetch(`${server.baseUrl}/api/steps/${TEST_SELLER_STEP_ID}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${portalCookieName(FOREIGN_WORKSPACE_ID)}=${encodeURIComponent(
            createPortalSessionValue(FOREIGN_WORKSPACE_ID, "someone@foreign-test.invalid").value,
          )}`,
        },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(404);
    },
  });

  tier2({
    name: "no session returns 401",
    ticket: "35",
    routeFile: ROUTE_FILE,
    assert: async () => {
      const response = await fetch(`${server.baseUrl}/api/steps/${TEST_SELLER_STEP_ID}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(401);
    },
  });
});

describe("Tier 2 — GET /api/plans/[ws] (Ticket 28)", () => {
  const ROUTE_FILE = "app/api/plans/[ws]/route.ts";

  tier2({
    name: "returns 401 to a buyer cookie",
    ticket: "28",
    routeFile: ROUTE_FILE,
    assert: async () => {
      const response = await fetch(`${server.baseUrl}/api/plans/${seeded.workspaceId}`, {
        headers: {
          cookie: `${portalCookieName(seeded.workspaceId)}=${encodeURIComponent(
            createPortalSessionValue(seeded.workspaceId, TEST_APPROVED_EMAIL).value,
          )}`,
        },
      });
      expect(response.status).toBe(401);
    },
  });

  tier2({
    name: "returns 401 to an anonymous request",
    ticket: "28",
    routeFile: ROUTE_FILE,
    assert: async () => {
      const response = await fetch(`${server.baseUrl}/api/plans/${seeded.workspaceId}`);
      expect(response.status).toBe(401);
    },
  });

  // T28-12 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6, decision 2).
  // POSITIVE CONTROL. Without this, the two 401 assertions above are
  // satisfiable by a handler that is unconditionally `return new
  // Response(null, { status: 401 })` — every negative case would pass while
  // the route did nothing real. This is the third time this suite has needed
  // a positive control after a confirmed vacuous pass (see the /portal and
  // /view "Your deal room" / "Shared resource 1" controls above); making it a
  // habit here rather than special-casing it.
  //
  // Signs in through a REAL @supabase/ssr server client (support/
  // seller-http-session.ts) rather than hand-building the session cookie, so
  // this exercises the exact cookie format lib/supabase/server.ts's
  // createClient() reads back — not a shortcut that could drift from what a
  // real browser sends.
  //
  // Registered directly as `it`, not through tier2(): this assertion is not
  // gated on the route's existence (T28-11 ships it in the same ticket as
  // this test), so there is nothing for it to self-activate against.
  it("returns 200 with the plan tree for an authenticated seller of the owning tenant", async () => {
    const cookie = await buildSellerCookieHeader(seeded.ownerEmail, seeded.ownerPassword);

    const response = await fetch(`${server.baseUrl}/api/plans/${seeded.workspaceId}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const json = (await response.json()) as { data: { id: string; workspace_id: string } };
    expect(json.data.id).toBe(seeded.planId);
    expect(json.data.workspace_id).toBe(seeded.workspaceId);
  });
});

describe("Tier 2 registry — self-activation meta-test", () => {
  it("registers both routes named in the ticket", () => {
    const routeFiles = tier2Registry.map((probe) => probe.routeFile);
    expect(routeFiles).toContain("app/api/steps/[id]/complete/route.ts");
    expect(routeFiles).toContain("app/api/plans/[ws]/route.ts");
  });

  it("has no manual enable/disable override that could desync a probe from the filesystem", () => {
    // The whole point of the self-activating design is that whether a probe
    // runs for real is derived from routeFileExists(), every time, with no
    // stored flag to go stale. This asserts that structural fact rather than
    // trusting the paragraph above it: if a future edit adds an `enabled` or
    // `skip` field to Tier2Probe, this fails and says why.
    for (const probe of tier2Registry) {
      expect(Object.keys(probe)).not.toContain("enabled");
      expect(Object.keys(probe)).not.toContain("disabled");
      expect(Object.keys(probe)).not.toContain("skip");
    }
  });

  it("fails if any registered route exists on disk without a corresponding live (non-skipped) test", () => {
    // tier2Wiring records the runner tier2() ACTUALLY chose (`runner === it`),
    // not merely a second call to routeFileExists() — asserting `entry.live`
    // against a fresh routeFileExists() call is what catches a refactor that
    // breaks the wiring (e.g. someone hand-forcing `it.skip` for a route that
    // now exists on disk), which a self-referential check re-deriving only
    // from routeFileExists() could never fail.
    expect(tier2Wiring.length).toBeGreaterThan(0);
    for (const entry of tier2Wiring) {
      expect(entry.live).toBe(routeFileExists(entry.routeFile));
    }
  });
});
