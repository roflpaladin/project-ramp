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
// ONE SAMPLE PER TENANT (Sprint 12, Ticket 60 — this replaces T42's
// "non-idempotent by design"). A sample workspace is excluded from the
// active-deal limit, so a second one is a second free, uncounted deal.
// Migration 0015 enforces it with a unique partial index
// (idx_workspaces_one_sample_per_tenant); this function makes the app agree
// with the database rather than colliding with it:
//   * a tenant that already has a sample gets that SAME workspace back, and
//     nothing is written;
//   * two clicks racing each other both succeed — the loser reads the
//     winner's row back after the unique violation.
// Onboarding redirects to whichever workspace id comes back, so the happy
// path is unchanged from the seller's point of view.
//
// Fresh ids per call otherwise (lib/seed/sample-deal-data.ts's randomUUID()s).
//
// On any insert failure: best-effort compensating delete of whatever was
// already created, in reverse FK order, then a user-friendly failure message
// — never the raw Postgres error text (mirrors lib/auth/provision-seller.ts's
// tenant-row compensation on a failed createUser).

export type SeedSampleDealResult =
  | { ok: true; workspaceId: string; planId: string }
  | { ok: false; message: string };

const GENERIC_FAILURE_MESSAGE = "We couldn't create your sample deal. Please try again.";

/** 0015's idx_workspaces_one_sample_per_tenant, hit by two racing clicks. */
const UNIQUE_VIOLATION_CODE = "23505";

type AdminClient = ReturnType<typeof createAdminClient>;

interface ExistingSample {
  readonly workspaceId: string;
  readonly planId: string;
}

/**
 * "broken" is a sample workspace with no plan left in it — see
 * findExistingSample below. Kept distinct from "none" so the caller refuses
 * instead of trying to insert a second sample the unique index would reject
 * anyway.
 */
type SampleLookup =
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly sample: ExistingSample }
  | { readonly kind: "broken" };

/** PostgREST returns a to-many embed as an array; defensive against either shape. */
function firstPlanId(embedded: unknown): string | null {
  const rows = Array.isArray(embedded) ? embedded : [embedded];
  const first = rows[0];
  const id = (first as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : null;
}

/**
 * The tenant's existing sample, if it has one. Ordered + limited rather than
 * .maybeSingle(): the unique index guarantees at most one row, but this code
 * also has to behave sanely on a database where 0015 has not been applied
 * yet (several pre-T60 samples can coexist there). workspaces has NO
 * timestamp column (0001), so the tie-break is the id — deterministic, and
 * irrelevant once 0015's index makes the row unique.
 *
 * Returns null on a failed read too, after logging: the caller then attempts
 * the insert, and the unique index catches the collision for real.
 */
async function findExistingSample(admin: AdminClient, tenantId: string): Promise<SampleLookup> {
  const { data, error } = await admin
    .from("workspaces")
    .select("id, success_plans (id)")
    .eq("tenant_id", tenantId)
    .eq("is_sample", true)
    .order("id", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[sample-deal] could not check for an existing sample workspace:", {
      tenantId,
      message: error.message,
    });
    return { kind: "none" };
  }

  const row = (data ?? [])[0] as { id?: string; success_plans?: unknown } | undefined;
  if (!row?.id) return { kind: "none" };

  const planId = firstPlanId(row.success_plans);
  if (!planId) {
    // Only reachable if an earlier run died between the workspace insert and
    // its compensating delete. Refused rather than papered over: the fix is
    // to delete that stray workspace, and inventing a plan id here would
    // hand onboarding a redirect to a deal that has no plan.
    console.error("[sample-deal] the tenant's sample workspace has no plan — manual cleanup needed:", {
      tenantId,
      workspaceId: row.id,
    });
    return { kind: "broken" };
  }

  return { kind: "found", sample: { workspaceId: row.id, planId } };
}

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

  // One sample per tenant (see this file's header). Checked before anything
  // is built so a second "start with a sample deal" click is a redirect, not
  // seventeen more rows.
  const existing = await findExistingSample(admin, input.tenantId);
  if (existing.kind === "found") {
    return { ok: true, workspaceId: existing.sample.workspaceId, planId: existing.sample.planId };
  }
  if (existing.kind === "broken") {
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
    // The other half of the race: another request for this same tenant won
    // between the check above and this insert. 0015's unique index is what
    // makes that safe, and the winner's workspace is the right answer for
    // both callers — nothing was written here, so there is nothing to undo.
    if (workspaceError.code === UNIQUE_VIOLATION_CODE) {
      const raced = await findExistingSample(admin, input.tenantId);
      if (raced.kind === "found") {
        return { ok: true, workspaceId: raced.sample.workspaceId, planId: raced.sample.planId };
      }
    }
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
