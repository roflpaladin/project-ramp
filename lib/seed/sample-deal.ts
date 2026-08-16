import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildSampleDealData, type SampleDealData } from "./sample-deal-data";

// Sprint 8, Ticket 42 — the sample-deal seed engine. "Start with a sample
// deal" in onboarding must give a fresh self-serve seller a complete
// skeleton deal in <10s (Sep 1, unanimous P0) — a stranger with zero data is
// a dead first session.
//
// Runs as the service-role client, not the RLS-scoped seller client
// (contrast lib/plans/write.ts): onboarding calls this before the seller's
// browser session necessarily has anything else set up, and the workspace
// being created IS the tenant-scoping check here (tenant_id is written
// explicitly, never inferred from a JWT claim this call may not have yet).
//
// FRESH ids every call (lib/seed/sample-deal-data.ts's randomUUID()s) — no
// idempotency requirement, unlike scripts/seed-demo.mjs's singleton demo
// tenant. Two calls for the same tenant must yield two distinct sample
// workspaces, not a re-upsert of one.
//
// On any insert failure: best-effort compensating delete of whatever was
// already created, in reverse FK order, then a user-friendly failure message
// — never the raw Postgres error text (mirrors lib/auth/provision-seller.ts's
// tenant-row compensation on a failed createUser).

export type SeedSampleDealResult =
  | { ok: true; workspaceId: string; planId: string }
  | { ok: false; message: string };

const GENERIC_FAILURE_MESSAGE = "We couldn't create your sample deal. Please try again.";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Best-effort compensating delete, reverse FK creation order (steps -> stages
 * -> plan -> links -> workspace). `deal` carries only the parts that were
 * actually inserted before the failure. Each step is independently
 * try/caught: a cleanup failure must never replace or mask the original,
 * already-decided user-facing error.
 */
async function rollback(admin: AdminClient, deal: Partial<SampleDealData>): Promise<void> {
  const steps: Array<() => PromiseLike<unknown>> = [];

  if (deal.steps && deal.steps.length > 0) {
    const stepIds = deal.steps.map((step) => step.id);
    steps.push(() => admin.from("plan_steps").delete().in("id", stepIds));
  }
  if (deal.stages && deal.stages.length > 0) {
    const stageIds = deal.stages.map((stage) => stage.id);
    steps.push(() => admin.from("plan_stages").delete().in("id", stageIds));
  }
  if (deal.plan) {
    steps.push(() => admin.from("success_plans").delete().eq("id", deal.plan!.id));
  }
  if (deal.links && deal.links.length > 0) {
    const linkIds = deal.links.map((link) => link.id);
    steps.push(() => admin.from("links").delete().in("id", linkIds));
  }
  if (deal.workspace) {
    steps.push(() => admin.from("workspaces").delete().eq("id", deal.workspace!.id));
  }

  for (const run of steps) {
    try {
      await run();
    } catch {
      // Best-effort only — see the function comment above.
    }
  }
}

export async function seedSampleDeal(input: {
  tenantId: string;
  userId: string;
}): Promise<SeedSampleDealResult> {
  if (!input.tenantId || !input.userId) {
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const admin = createAdminClient();

  // Seller-side steps must carry the REAL seller's identity, not a
  // placeholder — resolved here rather than trusted from the caller so the
  // owner_email on every seller-side row is provably the signed-in account's.
  const { data: userLookup, error: userError } = await admin.auth.admin.getUserById(input.userId);
  const sellerEmail = userLookup?.user?.email;
  if (userError || !sellerEmail) {
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  // The user's own app_metadata claim — not the caller — is the authority on
  // which tenant they belong to. Running as service role, a mismatched
  // (tenantId, userId) pair would otherwise write a workspace into someone
  // else's tenant; refuse it outright.
  const claimTenantId = userLookup.user.app_metadata?.tenant_id as string | undefined;
  if (claimTenantId !== input.tenantId) {
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const deal = buildSampleDealData({
    tenantId: input.tenantId,
    userId: input.userId,
    seller: { email: sellerEmail, name: sellerEmail.split("@")[0] },
    runAt: new Date(),
  });

  const { error: workspaceError } = await admin.from("workspaces").insert(deal.workspace);
  if (workspaceError) {
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const { error: planError } = await admin.from("success_plans").insert(deal.plan);
  if (planError) {
    await rollback(admin, { workspace: deal.workspace });
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const { error: stagesError } = await admin.from("plan_stages").insert(deal.stages);
  if (stagesError) {
    await rollback(admin, { workspace: deal.workspace, plan: deal.plan });
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const { error: stepsError } = await admin.from("plan_steps").insert(deal.steps);
  if (stepsError) {
    await rollback(admin, { workspace: deal.workspace, plan: deal.plan, stages: deal.stages });
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const { error: linksError } = await admin.from("links").insert(deal.links);
  if (linksError) {
    await rollback(admin, {
      workspace: deal.workspace,
      plan: deal.plan,
      stages: deal.stages,
      steps: deal.steps,
    });
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  return { ok: true, workspaceId: deal.workspace.id, planId: deal.plan.id };
}
