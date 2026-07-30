// Ticket 25 — the buyer boundary, at the payload level.
//
// Scope note: this file proves toBuyerPayload itself. The rendered-HTML and RSC
// flight-payload greps, the route-level probes and the cURL suite belong to
// Ticket 26 (tests/security/buyer-boundary.spec.ts). Keeping them apart means a
// failure here names the boundary function, not a page three files away.
//
// Everything runs against the real Ticket 23 fixture on real Supabase. A mock
// workspace would be assembled from the same allowlist this file is trying to
// test, and would pass no matter how wrong the implementation was.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPlanForBuyer } from "@/lib/plans/queries";
import {
  toBuyerPayload,
  type BuyerPayload,
  type LinkRow,
  type WorkspaceRow,
} from "@/lib/portal-payload";
import {
  CHAT_URL,
  EXPECTED_VISIBLE_VALUES,
  INTERNAL_CHAT_URL,
  PRIVATE_LINK_URLS,
  SELLER_STEP_LABEL,
  SELLER_STEP_OWNER_NAME,
  forbiddenValuesFor,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

/**
 * Pattern-based, never a hand-maintained list of field names — a list only ever
 * covers the fields someone remembered on the day they wrote it.
 */
const FORBIDDEN_PATTERNS = [
  /crm_/i,
  /internal_chat/i,
  /private_note/i,
  /tenant_id/i,
  /approved_emails/i,
  /created_by/i,
] as const;

let seeded: LeakyWorkspace;

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

beforeAll(async () => {
  seeded = await seedLeakyWorkspace();
});

afterAll(async () => {
  await teardownLeakyWorkspace();
});

describe("toBuyerPayload", () => {
  it("emits no private field name, by pattern rather than by list", async () => {
    const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(json).not.toMatch(pattern);
    }
  });

  it("emits no private VALUE, not merely no private key", async () => {
    // A field can be renamed; a URL or a CRM amount cannot. Key-level assertions
    // alone would pass a payload that spread the row under different names.
    const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

    for (const forbidden of forbiddenValuesFor(seeded)) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("omits both private resource URLs while keeping the three shared ones", async () => {
    const payload = await loadBuyerPayload(seeded.workspaceId);
    const urls = payload.resources.map((resource) => resource.url_string);

    for (const privateUrl of PRIVATE_LINK_URLS) {
      expect(urls).not.toContain(privateUrl);
    }
    expect(payload.resources).toHaveLength(3);
  });

  it("filters private resources even when the caller forgets the SQL filter", async () => {
    // The loaders also filter in SQL. This asserts the in-function filter holds
    // on its own — the SQL clause lives in whichever page needs it and is the
    // easier of the two to forget.
    const { workspace, links } = await fetchRows(seeded.workspaceId);

    // Deliberately unfiltered: every private row is handed to the boundary.
    expect(links.some((link) => link.visibility === "private")).toBe(true);

    const json = JSON.stringify(toBuyerPayload(workspace, null, links));
    for (const privateUrl of PRIVATE_LINK_URLS) {
      expect(json).not.toContain(privateUrl);
    }
  });

  it("passes chat_url through and drops internal_chat_url", async () => {
    const payload = await loadBuyerPayload(seeded.workspaceId);

    expect(payload.workspace.chat_url).toBe(CHAT_URL);
    expect(JSON.stringify(payload)).not.toContain(INTERNAL_CHAT_URL);
  });

  it("keeps seller-owned steps visible, minus their private metadata", async () => {
    // The deliberate asymmetry. A payload that dropped seller steps entirely
    // would pass every leak assertion above and destroy the product: seeing what
    // the seller has committed to IS the mutual plan.
    const payload = await loadBuyerPayload(seeded.workspaceId);
    const steps = payload.plan?.stages.flatMap((stage) => stage.steps) ?? [];
    const sellerSteps = steps.filter((step) => step.owner_side === "seller");

    expect(sellerSteps.length).toBeGreaterThan(0);

    const sellerStep = sellerSteps.find((step) => step.label === SELLER_STEP_LABEL);
    expect(sellerStep).toBeDefined();
    expect(sellerStep?.owner_name).toBe(SELLER_STEP_OWNER_NAME);
    expect(sellerStep?.due_date).toBe("2026-08-14");
    expect(sellerStep?.status).toBe("open");
    expect(JSON.stringify(sellerSteps)).not.toMatch(/private_note/i);
  });

  it("keeps every value that is supposed to survive", async () => {
    // The mirror of the leak tests: a strip that removed everything would pass
    // all of them. Guards against an overzealous boundary.
    const json = JSON.stringify(await loadBuyerPayload(seeded.workspaceId));

    for (const visible of EXPECTED_VISIBLE_VALUES) {
      expect(json).toContain(visible);
    }
  });

  it("returns plan: null for a workspace with no plan, rather than throwing", async () => {
    const payload = await loadBuyerPayload(seeded.emptyWorkspaceId);

    expect(payload.plan).toBeNull();
    expect(payload.workspace.id).toBe(seeded.emptyWorkspaceId);
  });

  it("stays closed when a NEW private field appears — with no edit to this file", async () => {
    // The proof of allowlist semantics, and the only test here that will still
    // be catching bugs in a year. A denylist implementation passes every other
    // assertion in this file and fails precisely this one.
    //
    // The extra field is injected onto the row object rather than added as a
    // real column: supabase-js has no DDL path, and the point under test is that
    // toBuyerPayload never copies a field it was not told about — which is true
    // of any unknown key regardless of how it got there. Ticket 26 runs the
    // migration-level version (`alter table … add column crm_arr`, dropped in an
    // afterAll), which additionally proves the LOADERS' select("*") surfaces the
    // new column so this strip is doing real work.
    //
    // Note the forbidden patterns above are untouched: crm_arr is caught by
    // /crm_/i for free. If this test ever needs editing to accommodate a new
    // column, the boundary has regressed to a denylist.
    const { workspace, links } = await fetchRows(seeded.workspaceId);
    const widened = { ...workspace, crm_arr: 999999 } as WorkspaceRow;

    const json = JSON.stringify(toBuyerPayload(widened, null, links));

    expect(json).not.toContain("999999");
    expect(json).not.toMatch(/crm_arr/i);
  });

  it("rejects a raw workspace row where a BuyerPayload is expected", async () => {
    // Compile-time, not runtime: the assertion is that the line below does not
    // type-check, which `npm run typecheck` enforces on every commit. The
    // suppression directive below turns that into a live guarantee — if
    // BuyerPayload is ever widened enough for a raw row to satisfy it, the
    // directive becomes unused and the build fails.
    const { workspace } = await fetchRows(seeded.workspaceId);

    // @ts-expect-error — a WorkspaceRow is not a BuyerPayload, and must never become one.
    const wrong: BuyerPayload = workspace;

    expect(wrong).toBeDefined();
  });
});
