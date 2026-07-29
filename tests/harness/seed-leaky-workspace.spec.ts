// Tests for the test fixture itself.
//
// This looks like belt-and-braces until you consider the failure mode it exists
// to catch: if seedLeakyWorkspace ever stops writing the private data — a renamed
// column, a silently swallowed error, a constraint change — then Ticket 26's
// buyer-boundary suite goes green while proving absolutely nothing. The gate
// would report "no leak" because there was nothing to leak.
//
// So the load-bearing assertion below is "the fixture really does contain every
// forbidden value." Everything else is ordinary hygiene.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";
import {
  EXPECTED_VISIBLE_VALUES,
  PRIVATE_LINK_URLS,
  forbiddenValuesFor,
  SHARED_LINK_URLS,
  TEST_PLAN_ID,
  TEST_TENANT_ID,
  TEST_WORKSPACE_ID,
  seedLeakyWorkspace,
  teardownLeakyWorkspace,
  type LeakyWorkspace,
} from "../fixtures/seed-leaky-workspace";

requireTestEnv();
const db = createAdminClient();

interface LinkRow {
  readonly url_string: string;
  readonly visibility: string;
}

interface StageRow {
  readonly id: string;
  readonly display_order: number;
}

interface StepRow {
  readonly id: string;
  readonly owner_side: string;
  readonly status: string;
  readonly completed_at: string | null;
  readonly private_note: string | null;
}

interface RawGraph {
  readonly workspace: Record<string, unknown> | null;
  readonly links: LinkRow[];
  readonly plan: Record<string, unknown> | null;
  readonly stages: StageRow[];
  readonly steps: StepRow[];
}

/** Reads the seeded graph back through the service-role client — RLS bypassed, nothing filtered. */
async function readRawGraph(): Promise<RawGraph> {
  const { data: workspace } = await db
    .from("workspaces")
    .select("*")
    .eq("id", TEST_WORKSPACE_ID)
    .maybeSingle();

  const { data: links } = await db.from("links").select("*").eq("workspace_id", TEST_WORKSPACE_ID);

  const { data: plan } = await db
    .from("success_plans")
    .select("*")
    .eq("id", TEST_PLAN_ID)
    .maybeSingle();

  const { data: stages } = await db
    .from("plan_stages")
    .select("*")
    .eq("plan_id", TEST_PLAN_ID)
    .order("display_order");

  const stageIds = (stages ?? []).map((stage: StageRow) => stage.id);
  const { data: steps } = stageIds.length
    ? await db.from("plan_steps").select("*").in("stage_id", stageIds)
    : { data: [] };

  return {
    workspace: workspace ?? null,
    links: links ?? [],
    plan: plan ?? null,
    stages: stages ?? [],
    steps: steps ?? [],
  };
}

describe("seedLeakyWorkspace", () => {
  let seeded: LeakyWorkspace;

  beforeAll(async () => {
    // Start from a known-empty state so a leftover row from an interrupted run
    // cannot make the idempotency assertions pass for the wrong reason.
    await teardownLeakyWorkspace();
    seeded = await seedLeakyWorkspace();
  });

  afterAll(async () => {
    await teardownLeakyWorkspace();
  });

  it("provisions the workspace under the dedicated sentinel tenant", async () => {
    expect(seeded.workspaceId).toBe(TEST_WORKSPACE_ID);
    expect(seeded.tenantId).toBe(TEST_TENANT_ID);

    const { workspace } = await readRawGraph();
    expect(workspace).not.toBeNull();
    expect(workspace?.tenant_id).toBe(TEST_TENANT_ID);
  });

  it("contains every value the buyer boundary must strip", async () => {
    // The assertion the whole security gate rests on. Serializing the raw graph
    // and searching it proves the private data is genuinely present before any
    // later suite claims it did not leak.
    const graph = await readRawGraph();
    const serialized = JSON.stringify(graph);

    const absent = forbiddenValuesFor(seeded).filter((value) => !serialized.includes(value));
    expect(
      absent,
      "Fixture is missing forbidden value(s), so any leakage test using it would " +
        `pass vacuously: ${absent.join(", ")}`,
    ).toEqual([]);
  });

  it("contains the buyer-visible values that must survive the boundary", async () => {
    const graph = await readRawGraph();
    const serialized = JSON.stringify(graph);

    const absent = EXPECTED_VISIBLE_VALUES.filter((value) => !serialized.includes(value));
    expect(absent).toEqual([]);
  });

  it("splits resources into three shared and two private links", async () => {
    const { links } = await readRawGraph();

    const shared = links.filter((link) => link.visibility === "shared");
    const priv = links.filter((link) => link.visibility === "private");

    expect(shared).toHaveLength(SHARED_LINK_URLS.length);
    expect(priv).toHaveLength(PRIVATE_LINK_URLS.length);
    expect(priv.map((link) => link.url_string).sort()).toEqual([...PRIVATE_LINK_URLS].sort());
  });

  it("seeds both sides of the ownership split, with at least one private note", async () => {
    const { steps } = await readRawGraph();

    expect(steps.some((step) => step.owner_side === "seller")).toBe(true);
    expect(steps.some((step) => step.owner_side === "buyer")).toBe(true);
    expect(steps.filter((step) => step.private_note !== null).length).toBeGreaterThanOrEqual(1);
  });

  it("satisfies the plan_steps completion-coherence constraint on every row", async () => {
    const { steps } = await readRawGraph();

    // Mirrors the CHECK in migration 0005: (status = 'done') = (completed_at is not null).
    // The database enforces this, so a violation here means the fixture stopped
    // writing what it thinks it writes.
    for (const step of steps) {
      expect(step.status === "done").toBe(step.completed_at !== null);
    }
  });

  it("is idempotent — a second seed changes no row counts", async () => {
    const before = await readRawGraph();
    await seedLeakyWorkspace();
    const after = await readRawGraph();

    expect(after.links).toHaveLength(before.links.length);
    expect(after.stages).toHaveLength(before.stages.length);
    expect(after.steps).toHaveLength(before.steps.length);
  });
});

describe("teardownLeakyWorkspace", () => {
  beforeAll(async () => {
    await seedLeakyWorkspace();
    await teardownLeakyWorkspace();
  });

  it("removes the workspace, its links, and the whole plan tree", async () => {
    const graph = await readRawGraph();

    expect(graph.workspace).toBeNull();
    expect(graph.links).toHaveLength(0);
    expect(graph.plan).toBeNull();
    expect(graph.stages).toHaveLength(0);
    expect(graph.steps).toHaveLength(0);
  });

  it("removes the sentinel tenant", async () => {
    const { data } = await db.from("tenants").select("id").eq("id", TEST_TENANT_ID);
    expect(data ?? []).toHaveLength(0);
  });
});
