// Sprint 8, Ticket 40 — tenant-isolation test matrix for the auto-provisioned
// signup path (lib/auth/provision-seller.ts, Ticket 39). Every existing
// security suite pins RLS against fixtures that were HAND-SEEDED with a
// tenant_id already attached (tests/fixtures/seed-leaky-workspace.ts); none
// of them exercise a tenant that came into being through provisionSeller()
// itself. That gap is exactly the shape of defects B1/B2/B5 (project
// history): a boundary that looked proven, on a fixture nobody actually
// walked through the new code path.
//
// Every assertion here runs at the DB/PostgREST layer directly — an
// RLS-scoped client (anon key + real sign-in) or the service-role admin
// client — never through an app route. App routes can (and in the buyer
// path, per 0005's own comment, DO) add filtering the database itself does
// not enforce; that is fine for the buyer surface (see the note at the
// bottom of this file) but it would hide a genuine RLS gap on the seller
// path, which is this ticket's actual target.
//
// Structure per table: ADMIN sees the seeded row exists -> the OWNING
// tenant's scoped client CAN read it -> the FOREIGN tenant's scoped client
// CANNOT. Skipping the first two steps and asserting only the negative is
// the exact false-green failure mode this ticket exists to kill — a
// negative test against a row that was never created passes for the wrong
// reason.
//
// Cleanup mirrors seed-leaky-workspace.ts's discipline: every row is tagged
// with a per-run UUID, deleted in FK-safe order in afterAll, resiliently (one
// failure must not strand the rest) — this suite shares the dev Supabase
// project with concurrent work this sprint.

import { randomUUID } from "node:crypto";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { requireTestEnv } from "../fixtures/env";

const env = requireTestEnv();

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false },
});

/** Never signed in — the "anonymous visitor" control used throughout. */
const anonClient = createClient(env.supabaseUrl, env.anonKey, {
  auth: { persistSession: false },
});

const runId = randomUUID();

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

interface TenantFixture {
  readonly label: "a" | "b";
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly scoped: SupabaseClient;
  readonly workspaceId: string;
  readonly linkId: string;
  readonly planId: string;
  readonly stageId: string;
  readonly stepId: string;
  readonly analyticsId: string;
  readonly tokenId: string;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

// Collected as rows are created so afterAll can clean up resiliently even if
// a single seed step below threw partway through.
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdLinkIds: string[] = [];
const createdPlanIds: string[] = [];
const createdStageIds: string[] = [];
const createdStepIds: string[] = [];
const createdAnalyticsIds: string[] = [];
const createdTokenIds: string[] = [];

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`tenant-isolation-matrix seed — ${label}: ${error.message}`);
}

async function seedTenant(label: "a" | "b"): Promise<TenantFixture> {
  const email = `t40-seller-${label}-${runId}@example.com`;
  const password = "correct-horse-40-battery";
  const companyName = `T40 tenant ${label} ${runId}`;

  const provisioned = await provisionSeller({ email, password, companyName });
  if (!provisioned.ok) {
    throw new Error(`provisionSeller failed for tenant ${label}: ${provisioned.message}`);
  }
  createdUserIds.push(provisioned.userId);
  createdTenantIds.push(provisioned.tenantId);

  // An anon-key client subject to RLS — the only kind of client that can
  // prove isolation. The service-role client bypasses RLS entirely.
  const scoped = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await scoped.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`sign-in failed for tenant ${label}: ${signInError.message}`);
  }

  const workspaceId = randomUUID();
  const linkId = randomUUID();
  const planId = randomUUID();
  const stageId = randomUUID();
  const stepId = randomUUID();
  const analyticsId = randomUUID();
  const tokenId = randomUUID();

  failOn(
    `workspace ${label}`,
    (
      await admin.from("workspaces").insert({
        id: workspaceId,
        tenant_id: provisioned.tenantId,
        target_company_name: `T40 target ${label} ${runId}`,
        target_domain: `t40-${label}-${runId}.example.com`,
        created_by: provisioned.userId,
        approved_emails: [`buyer-${label}-${runId}@example.com`],
      })
    ).error,
  );
  createdWorkspaceIds.push(workspaceId);

  // Deliberately created 'private' — this single link row doubles as the
  // fixture for the item-9 buyer-leakage extension (a link flipped to a
  // non-shared visibility state) so the matrix does not need a second link
  // per tenant just to cover that case.
  failOn(
    `link ${label}`,
    (
      await admin.from("links").insert({
        id: linkId,
        workspace_id: workspaceId,
        category_header: "Internal",
        link_label: `T40 private link ${label} ${runId}`,
        url_string: `https://internal.example.com/t40-${label}-${runId}`,
        display_order: 0,
        visibility: "private",
      })
    ).error,
  );
  createdLinkIds.push(linkId);

  failOn(
    `success_plans ${label}`,
    (
      await admin.from("success_plans").insert({
        id: planId,
        workspace_id: workspaceId,
        title: `T40 plan ${label} ${runId}`,
        status: "active",
      })
    ).error,
  );
  createdPlanIds.push(planId);

  failOn(
    `plan_stages ${label}`,
    (
      await admin.from("plan_stages").insert({
        id: stageId,
        plan_id: planId,
        title: `T40 stage ${label} ${runId}`,
        display_order: 0,
        status: "current",
      })
    ).error,
  );
  createdStageIds.push(stageId);

  failOn(
    `plan_steps ${label}`,
    (
      await admin.from("plan_steps").insert({
        id: stepId,
        stage_id: stageId,
        label: `T40 step ${label} ${runId}`,
        owner_side: "seller",
        status: "open",
        display_order: 0,
      })
    ).error,
  );
  createdStepIds.push(stepId);

  failOn(
    `workspace_analytics ${label}`,
    (
      await admin.from("workspace_analytics").insert({
        id: analyticsId,
        workspace_id: workspaceId,
        buyer_email: `buyer-${label}-${runId}@example.com`,
        action_type: "portal_view",
      })
    ).error,
  );
  createdAnalyticsIds.push(analyticsId);

  failOn(
    `portal_access_tokens ${label}`,
    (
      await admin.from("portal_access_tokens").insert({
        id: tokenId,
        workspace_id: workspaceId,
        email: `buyer-${label}-${runId}@example.com`,
        token_hash: `t40-token-hash-${label}-${runId}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    ).error,
  );
  createdTokenIds.push(tokenId);

  return {
    label,
    tenantId: provisioned.tenantId,
    userId: provisioned.userId,
    email,
    password,
    scoped,
    workspaceId,
    linkId,
    planId,
    stageId,
    stepId,
    analyticsId,
    tokenId,
  };
}

beforeAll(async () => {
  tenantA = await seedTenant("a");
  tenantB = await seedTenant("b");
}, 120_000);

afterAll(async () => {
  // Cleanup order matters (FK constraints): plan_steps -> plan_stages ->
  // success_plans -> links -> workspace_analytics -> portal_access_tokens ->
  // workspaces -> tenants -> auth users. Each step is independently
  // try/caught so one failure cannot strand the rest.
  const steps: Array<[string, () => PromiseLike<unknown>]> = [
    ["plan_steps", () => admin.from("plan_steps").delete().in("id", createdStepIds)],
    ["plan_stages", () => admin.from("plan_stages").delete().in("id", createdStageIds)],
    ["success_plans", () => admin.from("success_plans").delete().in("id", createdPlanIds)],
    ["links", () => admin.from("links").delete().in("id", createdLinkIds)],
    ["workspace_analytics", () => admin.from("workspace_analytics").delete().in("id", createdAnalyticsIds)],
    ["portal_access_tokens", () => admin.from("portal_access_tokens").delete().in("id", createdTokenIds)],
    ["workspaces", () => admin.from("workspaces").delete().in("id", createdWorkspaceIds)],
    ["tenants", () => admin.from("tenants").delete().in("id", createdTenantIds)],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only, no assertion depends on this
      console.error(`tenant-isolation-matrix cleanup — ${label} failed:`, error);
    }
  }

  for (const userId of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- cleanup diagnostics only
      console.error(`tenant-isolation-matrix cleanup — auth user ${userId} failed:`, error);
    }
  }

  await tenantA?.scoped.auth.signOut().catch(() => undefined);
  await tenantB?.scoped.auth.signOut().catch(() => undefined);
}, 60_000);

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

interface ProbeResult {
  readonly data: unknown;
  readonly errorCode: string | null;
  readonly status: number;
}

async function probe(
  builder: PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>,
): Promise<ProbeResult> {
  const { data, error, status } = await builder;
  return { data, errorCode: error?.code ?? null, status };
}

/**
 * Verifies a cross-tenant write did not take effect, tolerating either shape
 * the ticket allows: an explicit RLS error, or a silent zero-row match. What
 * must always hold is the row's absence/unchanged state per `verifyOk`.
 */
async function assertWriteBlocked(
  attempt: () => PromiseLike<{ error: PostgrestError | null }>,
  verifyOk: () => Promise<boolean>,
): Promise<void> {
  await attempt();
  const ok = await verifyOk();
  expect(ok).toBe(true);
}

// ---------------------------------------------------------------------------
// 1. tenants
// ---------------------------------------------------------------------------

describe("tenants", () => {
  it("admin sees tenant B's row", async () => {
    const { data, error } = await admin.from("tenants").select("id").eq("id", tenantB.tenantId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.tenantId);
  });

  it("tenant B's own scoped client can read its own tenant", async () => {
    const { data, error } = await tenantB.scoped.from("tenants").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(tenantB.tenantId);
  });

  it("tenant A cannot read tenant B's tenant row by known id", async () => {
    const { data, error } = await tenantA.scoped.from("tenants").select("id").eq("id", tenantB.tenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A's unfiltered SELECT on tenants returns exactly its own row", async () => {
    const { data, error } = await tenantA.scoped.from("tenants").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(tenantA.tenantId);
  });

  it("tenant A cannot UPDATE tenant B's company_name", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("tenants")
          .update({ company_name: `PWNED BY A ${runId}` })
          .eq("id", tenantB.tenantId),
      async () => {
        const { data } = await admin.from("tenants").select("company_name").eq("id", tenantB.tenantId).single();
        return data?.company_name === `T40 tenant b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's tenant row", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("tenants").delete().eq("id", tenantB.tenantId),
      async () => {
        const { data } = await admin.from("tenants").select("id").eq("id", tenantB.tenantId).maybeSingle();
        return data?.id === tenantB.tenantId;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. workspaces
// ---------------------------------------------------------------------------

describe("workspaces", () => {
  it("admin sees tenant B's workspace", async () => {
    const { data, error } = await admin.from("workspaces").select("id").eq("id", tenantB.workspaceId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.workspaceId);
  });

  it("tenant B's own scoped client can read its own workspace", async () => {
    const { data, error } = await tenantB.scoped.from("workspaces").select("id").eq("id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's workspace by known id", async () => {
    const { data, error } = await tenantA.scoped.from("workspaces").select("id").eq("id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A's unfiltered SELECT on workspaces returns only its own", async () => {
    const { data, error } = await tenantA.scoped.from("workspaces").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(tenantA.workspaceId);
  });

  it("tenant A cannot INSERT a workspace claiming tenant B's tenant_id", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("workspaces").insert({
          id: forgedId,
          tenant_id: tenantB.tenantId,
          target_company_name: `forged ${runId}`,
          target_domain: `forged-${runId}.example.com`,
          created_by: tenantA.userId,
        }),
      async () => {
        const { data } = await admin.from("workspaces").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdWorkspaceIds.push(forgedId); // stray-write guard, in case RLS ever regresses
        return data === null;
      },
    );
  });

  it("tenant A cannot UPDATE tenant B's workspace", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("workspaces")
          .update({ target_company_name: `PWNED BY A ${runId}` })
          .eq("id", tenantB.workspaceId),
      async () => {
        const { data } = await admin
          .from("workspaces")
          .select("target_company_name")
          .eq("id", tenantB.workspaceId)
          .single();
        return data?.target_company_name === `T40 target b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's workspace", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("workspaces").delete().eq("id", tenantB.workspaceId),
      async () => {
        const { data } = await admin.from("workspaces").select("id").eq("id", tenantB.workspaceId).maybeSingle();
        return data?.id === tenantB.workspaceId;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. links
// ---------------------------------------------------------------------------

describe("links", () => {
  it("admin sees tenant B's link", async () => {
    const { data, error } = await admin.from("links").select("id").eq("id", tenantB.linkId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.linkId);
  });

  it("tenant B's own scoped client can read its own link", async () => {
    const { data, error } = await tenantB.scoped.from("links").select("id").eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(tenantB.linkId);
  });

  it("tenant A cannot read tenant B's links by known workspace_id", async () => {
    const { data, error } = await tenantA.scoped.from("links").select("id").eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot INSERT a link into tenant B's workspace", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("links").insert({
          id: forgedId,
          workspace_id: tenantB.workspaceId,
          category_header: "forged",
          link_label: `forged ${runId}`,
          url_string: "https://forged.example.com",
          display_order: 99,
        }),
      async () => {
        const { data } = await admin.from("links").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdLinkIds.push(forgedId);
        return data === null;
      },
    );
  });

  it("tenant A cannot UPDATE tenant B's link", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("links")
          .update({ link_label: `PWNED BY A ${runId}` })
          .eq("id", tenantB.linkId),
      async () => {
        const { data } = await admin.from("links").select("link_label").eq("id", tenantB.linkId).single();
        return data?.link_label === `T40 private link b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's link", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("links").delete().eq("id", tenantB.linkId),
      async () => {
        const { data } = await admin.from("links").select("id").eq("id", tenantB.linkId).maybeSingle();
        return data?.id === tenantB.linkId;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. success_plans / plan_stages / plan_steps
// ---------------------------------------------------------------------------

describe("success_plans", () => {
  it("admin sees tenant B's plan", async () => {
    const { data, error } = await admin.from("success_plans").select("id").eq("id", tenantB.planId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.planId);
  });

  it("tenant B's own scoped client can read its own plan", async () => {
    const { data, error } = await tenantB.scoped.from("success_plans").select("id").eq("id", tenantB.planId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's plan by known id", async () => {
    const { data, error } = await tenantA.scoped.from("success_plans").select("id").eq("id", tenantB.planId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot INSERT a stage into tenant B's plan", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("plan_stages").insert({
          id: forgedId,
          plan_id: tenantB.planId,
          title: `forged ${runId}`,
          display_order: 99,
        }),
      async () => {
        const { data } = await admin.from("plan_stages").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdStageIds.push(forgedId);
        return data === null;
      },
    );
  });

  it("tenant A cannot UPDATE tenant B's plan", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("success_plans")
          .update({ title: `PWNED BY A ${runId}` })
          .eq("id", tenantB.planId),
      async () => {
        const { data } = await admin.from("success_plans").select("title").eq("id", tenantB.planId).single();
        return data?.title === `T40 plan b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's plan", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("success_plans").delete().eq("id", tenantB.planId),
      async () => {
        const { data } = await admin.from("success_plans").select("id").eq("id", tenantB.planId).maybeSingle();
        return data?.id === tenantB.planId;
      },
    );
  });
});

describe("plan_stages", () => {
  it("admin sees tenant B's stage", async () => {
    const { data, error } = await admin.from("plan_stages").select("id").eq("id", tenantB.stageId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.stageId);
  });

  it("tenant B's own scoped client can read its own stage", async () => {
    const { data, error } = await tenantB.scoped.from("plan_stages").select("id").eq("id", tenantB.stageId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's stage by known id", async () => {
    const { data, error } = await tenantA.scoped.from("plan_stages").select("id").eq("id", tenantB.stageId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot INSERT a step into tenant B's stage", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("plan_steps").insert({
          id: forgedId,
          stage_id: tenantB.stageId,
          label: `forged ${runId}`,
          owner_side: "seller",
          status: "open",
          display_order: 99,
        }),
      async () => {
        const { data } = await admin.from("plan_steps").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdStepIds.push(forgedId);
        return data === null;
      },
    );
  });

  it("tenant A cannot UPDATE tenant B's stage", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("plan_stages")
          .update({ title: `PWNED BY A ${runId}` })
          .eq("id", tenantB.stageId),
      async () => {
        const { data } = await admin.from("plan_stages").select("title").eq("id", tenantB.stageId).single();
        return data?.title === `T40 stage b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's stage", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("plan_stages").delete().eq("id", tenantB.stageId),
      async () => {
        const { data } = await admin.from("plan_stages").select("id").eq("id", tenantB.stageId).maybeSingle();
        return data?.id === tenantB.stageId;
      },
    );
  });
});

describe("plan_steps", () => {
  it("admin sees tenant B's step", async () => {
    const { data, error } = await admin.from("plan_steps").select("id").eq("id", tenantB.stepId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.stepId);
  });

  it("tenant B's own scoped client can read its own step", async () => {
    const { data, error } = await tenantB.scoped.from("plan_steps").select("id").eq("id", tenantB.stepId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's step by known id", async () => {
    const { data, error } = await tenantA.scoped.from("plan_steps").select("id").eq("id", tenantB.stepId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot UPDATE tenant B's step", async () => {
    await assertWriteBlocked(
      () =>
        tenantA.scoped
          .from("plan_steps")
          .update({ label: `PWNED BY A ${runId}` })
          .eq("id", tenantB.stepId),
      async () => {
        const { data } = await admin.from("plan_steps").select("label").eq("id", tenantB.stepId).single();
        return data?.label === `T40 step b ${runId}`;
      },
    );
  });

  it("tenant A cannot DELETE tenant B's step", async () => {
    await assertWriteBlocked(
      () => tenantA.scoped.from("plan_steps").delete().eq("id", tenantB.stepId),
      async () => {
        const { data } = await admin.from("plan_steps").select("id").eq("id", tenantB.stepId).maybeSingle();
        return data?.id === tenantB.stepId;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. workspace_analytics
// ---------------------------------------------------------------------------

describe("workspace_analytics", () => {
  it("admin sees tenant B's analytics row", async () => {
    const { data, error } = await admin
      .from("workspace_analytics")
      .select("id")
      .eq("id", tenantB.analyticsId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.analyticsId);
  });

  it("tenant B's own scoped client can read its own analytics row", async () => {
    const { data, error } = await tenantB.scoped
      .from("workspace_analytics")
      .select("id")
      .eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's analytics rows", async () => {
    const { data, error } = await tenantA.scoped
      .from("workspace_analytics")
      .select("id")
      .eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot INSERT an analytics row into tenant B's workspace (no INSERT policy exists at all — 0003)", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("workspace_analytics").insert({
          id: forgedId,
          workspace_id: tenantB.workspaceId,
          buyer_email: `forged-${runId}@example.com`,
          action_type: "portal_view",
        }),
      async () => {
        const { data } = await admin.from("workspace_analytics").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdAnalyticsIds.push(forgedId);
        return data === null;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 6. portal_access_tokens — RLS enabled, NO policy at all (service-role only)
// ---------------------------------------------------------------------------

describe("portal_access_tokens", () => {
  it("admin sees tenant B's token", async () => {
    const { data, error } = await admin
      .from("portal_access_tokens")
      .select("id")
      .eq("id", tenantB.tokenId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(tenantB.tokenId);
  });

  // Deliberately NOT "owner can read" here — 0002 grants zero seller
  // policies on this table on purpose (service-role only). An authenticated
  // seller reading even their OWN workspace's token would itself be a
  // boundary defect, not a false negative to correct.
  it("tenant B's own scoped client sees ZERO rows on its OWN workspace's token — no seller policy exists by design", async () => {
    const { data, error } = await tenantB.scoped
      .from("portal_access_tokens")
      .select("id")
      .eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot read tenant B's token", async () => {
    const { data, error } = await tenantA.scoped
      .from("portal_access_tokens")
      .select("id")
      .eq("workspace_id", tenantB.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant A cannot INSERT a portal access token for its own or tenant B's workspace", async () => {
    const forgedId = randomUUID();
    await assertWriteBlocked(
      () =>
        tenantA.scoped.from("portal_access_tokens").insert({
          id: forgedId,
          workspace_id: tenantB.workspaceId,
          email: `forged-${runId}@example.com`,
          token_hash: `forged-hash-${runId}`,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      async () => {
        const { data } = await admin.from("portal_access_tokens").select("id").eq("id", forgedId).maybeSingle();
        if (data) createdTokenIds.push(forgedId);
        return data === null;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 7. No-session anon client — never signed in
// ---------------------------------------------------------------------------

describe("no-session anon client", () => {
  it.each([
    "tenants",
    "workspaces",
    "links",
    "success_plans",
    "plan_stages",
    "plan_steps",
    "workspace_analytics",
    "portal_access_tokens",
  ] as const)("unfiltered SELECT on %s returns zero rows with no session at all", async (table) => {
    const { data, error } = await anonClient.from(table).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Enumeration oracle
// ---------------------------------------------------------------------------

describe("enumeration oracle", () => {
  it("tenant A gets an identical response probing an unknown UUID vs. tenant B's real workspace id", async () => {
    const unknownId = randomUUID();

    const unknownProbe = await probe(tenantA.scoped.from("workspaces").select("id").eq("id", unknownId));
    const foreignProbe = await probe(tenantA.scoped.from("workspaces").select("id").eq("id", tenantB.workspaceId));

    expect(unknownProbe).toEqual(foreignProbe);
    expect(unknownProbe.data).toEqual([]);
    expect(unknownProbe.errorCode).toBeNull();
  });

  it("tenant A gets an identical response updating an unknown UUID vs. tenant B's real workspace id", async () => {
    const unknownId = randomUUID();
    const patch = { target_company_name: `oracle probe ${runId}` };

    const unknownProbe = await probe(tenantA.scoped.from("workspaces").update(patch).eq("id", unknownId).select("id"));
    const foreignProbe = await probe(
      tenantA.scoped.from("workspaces").update(patch).eq("id", tenantB.workspaceId).select("id"),
    );

    expect(unknownProbe).toEqual(foreignProbe);
  });
});

// ---------------------------------------------------------------------------
// 9. Buyer-leakage extension to the auto-provisioned path
// ---------------------------------------------------------------------------

describe("buyer-leakage extension (auto-provisioned workspace)", () => {
  // !! RLS IS NOT THE BUYER BOUNDARY !! (migration 0005's own header comment,
  // echoed in tests/security/buyer-boundary.spec.ts). Buyers hold no Supabase
  // Auth session at all — /portal and /view read through the SERVICE-ROLE
  // client after validating a signed portal-session cookie, which BYPASSES
  // RLS entirely. Nothing at the DB/PostgREST layer can prove or disprove
  // that app-layer filter; tests/security/buyer-boundary.spec.ts already
  // owns that proof (rendered HTML + RSC-flight greps against
  // toBuyerPayload). What the DB layer genuinely CAN prove, and what this
  // block proves, is the ceiling under that filter: an anon/unauthenticated
  // caller — which is what a buyer-equivalent client looks like at this
  // layer, since buyers carry no Supabase Auth session — gets zero rows from
  // `links` outright, regardless of the row's `visibility` value. That is
  // true here against tenant A's link even though it was created through
  // provisionSeller(), not the hand-seeded fixture.

  it("tenant A's link is genuinely 'private' at the DB row (positive control for the assertion below)", async () => {
    const { data, error } = await admin
      .from("links")
      .select("id, visibility")
      .eq("id", tenantA.linkId)
      .single();
    expect(error).toBeNull();
    expect(data?.visibility).toBe("private");
  });

  it("an anonymous (no-session) client sees zero rows of tenant A's link, private or not", async () => {
    const { data, error } = await anonClient.from("links").select("id").eq("workspace_id", tenantA.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("tenant B's authenticated scoped client — a stand-in for any non-owning caller — also sees zero rows of tenant A's link", async () => {
    const { data, error } = await tenantB.scoped.from("links").select("id").eq("workspace_id", tenantA.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
