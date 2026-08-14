// T36-6/T36-7 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Two QA
// tasks against the real GET /api/demo/pulse route handler:
//
//   T36-6 — the existing forbidden-pattern array (FORBIDDEN_FIELD_PATTERNS,
//   tests/fixtures/seed-leaky-workspace.ts — IMPORTED here, never
//   re-declared) has never been pointed at this endpoint. Run it against the
//   pulse JSON for a demo-tenant workspace with populated crm_* fields, plus
//   assert the raw (unmasked) buyer email never appears anywhere in the
//   payload.
//
//   T36-7 — regression proof that this ticket did not loosen Ticket 20's
//   scope guard: a real, non-demo workspace id gets the SAME 404 as a
//   workspace id that does not exist at all, with an indistinguishable
//   response body — an attacker must not be able to tell "exists but isn't
//   demo" from "doesn't exist."
//
// Calls the route's exported GET handler directly with a plain Request,
// mirroring tests/api/send-token.spec.ts: app/api/demo/pulse/route.ts touches
// no next/headers or next/navigation API that would throw outside a live
// request context (it only reads request.url and calls createAdminClient()),
// so a full `next build && next start` (tests/security/support/live-server.ts)
// buys nothing extra here.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { maskBuyerEmail } from "@/lib/pulse/mask-buyer-email";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FORBIDDEN_FIELD_PATTERNS,
  TEST_WORKSPACE_ID as NON_DEMO_WORKSPACE_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";
import {
  CRM_AMOUNT,
  CRM_SOURCE,
  LINK_LABEL,
  PULSE_FORBIDDEN_VALUES,
  PULSE_TEST_LINK_ID,
  PULSE_TEST_STEP_ID,
  PULSE_TEST_WORKSPACE_ID,
  RAW_BUYER_EMAIL,
  SELLER_PRIVATE_NOTE,
  STEP_LABEL,
  STEP_OWNER_EMAIL,
  TARGET_DOMAIN,
  seedDemoPulseWorkspace,
  teardownDemoPulseWorkspace,
} from "../fixtures/seed-demo-pulse-workspace";

// Fixed, never seeded by any fixture or seed script, so a lookup for it can
// only ever return "does not exist." Distinct from buyer-boundary.spec.ts's
// own NONEXISTENT_WORKSPACE_ID sentinel — different file, own id, no shared
// mutable state between the two suites.
const NONEXISTENT_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000fe";

const { GET } = await import("@/app/api/demo/pulse/route");

function pulseRequest(workspaceId: string): Request {
  return new Request(`http://localhost/api/demo/pulse?workspace_id=${workspaceId}`);
}

interface PulseResponsePayload {
  readonly workspace_id: string;
  readonly domain: string;
  readonly metrics: { readonly total_views: number; readonly total_clicks: number };
  readonly activity_feed: readonly {
    readonly action_type: string;
    readonly buyer_email: string;
    readonly metadata: { readonly link_label: string | null; readonly step_label: string | null };
    readonly timestamp: string;
  }[];
}

describe("GET /api/demo/pulse — T36-6, forbidden-pattern + raw-email boundary", () => {
  beforeAll(async () => {
    await seedDemoPulseWorkspace();
  }, 60_000);

  afterAll(async () => {
    await teardownDemoPulseWorkspace();
  }, 30_000);

  it("proves the fixture actually landed populated crm_* fields (guard against a vacuous pass)", async () => {
    // Mirrors buyer-boundary.spec.ts's own "new-column allowlist proof" idiom:
    // a leak assertion against data that was never really written proves
    // nothing. Read back with the SAME admin client the route itself uses,
    // so a PostgREST replica-cache lag would surface here, not silently
    // invalidate the assertions below.
    const db = createAdminClient();
    const { data: workspace, error } = await db
      .from("workspaces")
      .select("crm_source, crm_amount, internal_chat_url")
      .eq("id", PULSE_TEST_WORKSPACE_ID)
      .single();

    expect(error).toBeNull();
    expect(workspace?.crm_source).toBe(CRM_SOURCE);
    expect(Number(workspace?.crm_amount)).toBe(CRM_AMOUNT);
    expect(workspace?.internal_chat_url).not.toBeNull();

    const { data: step } = await db
      .from("plan_steps")
      .select("private_note, owner_email")
      .eq("id", PULSE_TEST_STEP_ID)
      .single();
    expect(step?.private_note).toBe(SELLER_PRIVATE_NOTE);
    expect(step?.owner_email).toBe(STEP_OWNER_EMAIL);
  });

  it("emits no private field name, by pattern, for a workspace with populated crm_* fields", async () => {
    const response = await GET(pulseRequest(PULSE_TEST_WORKSPACE_ID));
    expect(response.status).toBe(200);
    const body = await response.text();

    // POSITIVE CONTROL: this endpoint answers 200 for both "found and
    // rendered" and (per the route's own scope guard) a demo workspace with
    // zero events. Confirm the feed actually assembled real events before
    // trusting anything about what's absent from it — the same discipline
    // buyer-boundary.spec.ts applies to /portal and /view.
    const json = JSON.parse(body) as PulseResponsePayload;
    expect(json.workspace_id).toBe(PULSE_TEST_WORKSPACE_ID);
    expect(json.domain).toBe(TARGET_DOMAIN);
    expect(json.activity_feed.length).toBe(3);
    expect(json.activity_feed.some((item) => item.metadata.link_label === LINK_LABEL)).toBe(true);
    expect(json.activity_feed.some((item) => item.metadata.step_label === STEP_LABEL)).toBe(true);

    // Re-run the array declared in tests/fixtures/seed-leaky-workspace.ts,
    // imported, never re-declared — the whole point (per that array's own
    // header comment) is that a future private column is caught by pattern
    // rather than requiring every leak-assertion file to remember to add it.
    for (const pattern of FORBIDDEN_FIELD_PATTERNS) {
      expect(body).not.toMatch(pattern);
    }
  });

  it("emits no private VALUE either — a field can be renamed, a CRM amount or private note cannot", async () => {
    const response = await GET(pulseRequest(PULSE_TEST_WORKSPACE_ID));
    const body = await response.text();

    for (const forbidden of PULSE_FORBIDDEN_VALUES) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("never emits the raw buyer email — only the masked form (T36-2) reaches the wire", async () => {
    const response = await GET(pulseRequest(PULSE_TEST_WORKSPACE_ID));
    const body = await response.text();

    expect(body).not.toContain(RAW_BUYER_EMAIL);

    // POSITIVE CONTROL: the masked form must actually be present, or "the
    // raw email is absent" could vacuously pass because buyer_email was
    // dropped from the response entirely rather than genuinely masked.
    const masked = maskBuyerEmail(RAW_BUYER_EMAIL);
    expect(body).toContain(masked);

    const json = JSON.parse(body) as PulseResponsePayload;
    for (const item of json.activity_feed) {
      expect(item.buyer_email).not.toContain(RAW_BUYER_EMAIL);
      expect(item.buyer_email).toBe(masked);
    }
  });
});

describe("GET /api/demo/pulse — T36-7, non-demo workspace 404s identically to a nonexistent one", () => {
  beforeAll(async () => {
    await seedLeakyWorkspace();
  }, 120_000);

  afterAll(async () => {
    await teardownLeakyWorkspace();
  }, 60_000);

  it("returns 404 for a REAL workspace that exists but is outside the demo tenant", async () => {
    // NON_DEMO_WORKSPACE_ID (seed-leaky-workspace.ts's TEST_WORKSPACE_ID)
    // is genuinely seeded and genuinely real — under TEST_TENANT_ID, not
    // DEMO_TENANT_ID. This is the "exists but isn't demo" half of the oracle
    // check below, not a second nonexistent-id case.
    const response = await GET(pulseRequest(NON_DEMO_WORKSPACE_ID));
    expect(response.status).toBe(404);
  });

  it("returns 404 for a workspace id that was never seeded at all", async () => {
    const response = await GET(pulseRequest(NONEXISTENT_WORKSPACE_ID));
    expect(response.status).toBe(404);
  });

  it(
    "gives an attacker holding a real non-demo workspace id no way to distinguish it from a " +
      "nonexistent id — same status, byte-identical body",
    async () => {
      const foreign = await GET(pulseRequest(NON_DEMO_WORKSPACE_ID));
      const nonexistent = await GET(pulseRequest(NONEXISTENT_WORKSPACE_ID));

      expect(foreign.status).toBe(nonexistent.status);
      expect(foreign.status).toBe(404);

      const foreignBody = await foreign.text();
      const nonexistentBody = await nonexistent.text();

      // Unlike buyer-boundary.spec.ts's HTML-page oracle check, this route
      // returns static JSON with no per-request ciphertext or id
      // interpolation — app/api/demo/pulse/route.ts's 404 branch returns the
      // literal same object on both paths, so byte-for-byte equality is the
      // real (and stronger) assertion, not a normalised approximation of it.
      expect(foreignBody).toBe(nonexistentBody);
      expect(foreignBody).not.toContain(NON_DEMO_WORKSPACE_ID);
      expect(foreignBody).not.toContain(NONEXISTENT_WORKSPACE_ID);
    },
  );
});
