// Sprint 12, Ticket 60 (active-deal limit). The wrapper over 0015's
// mark_plan_live() — the ONE place a plan is allowed to become 'active'.
//
// Why a Postgres function and not a read-then-write here: the check ("is
// this tenant under their cap?") and the write ("make this plan live") have
// to happen in the same statement sequence under a per-tenant lock. Two tabs
// at a cap of 1 would otherwise both read "0 active", both pass the check in
// application code, and both write — the exact race
// lib/billing/subscription-repository.ts documents for webhook deliveries,
// with money on the other side of it.
//
// The cap is an ARGUMENT, not a lookup: tier caps are product config in
// lib/billing/plans.ts and must never need a migration to change. The
// database enforces "under the number you were given", the application
// decides what that number is.
//
// Service-role: 0015's go-live trigger refuses the transition into 'active'
// for every other role, so this is the only client that can perform it.

import { createAdminClient } from "@/lib/supabase/admin";
import { mapPostgrestError, type PostgrestErrorLike } from "./errors";

const MARK_PLAN_LIVE_FUNCTION = "mark_plan_live";

/**
 * What the database decided:
 *   live          — the plan is now active.
 *   already_live  — it was active before this call; nothing changed. Not an
 *                   error: two clicks, or a retry, must not read as a
 *                   failure.
 *   limit_reached — the tenant is at their cap. Nothing was written.
 *   not_found     — no draft plan with that id in that tenant (wrong tenant,
 *                   deleted plan, or a plan that is already closed).
 *   sample_workspace — the plan lives in the tenant's SAMPLE workspace,
 *                   which the limit never counts. Reachable with ordinary
 *                   clicks (close the sample as Won, start a new plan in it,
 *                   press "make it live"), so it is a first-class verdict
 *                   rather than an assertion.
 */
export type MarkPlanLiveVerdict = "live" | "already_live" | "limit_reached" | "not_found" | "sample_workspace";

const MARK_PLAN_LIVE_VERDICTS: readonly string[] = Object.freeze([
  "live",
  "already_live",
  "limit_reached",
  "not_found",
  "sample_workspace",
]);

export interface MarkPlanLiveInput {
  readonly planId: string;
  readonly tenantId: string;
  /** null = unlimited (Advanced, Enterprise, any manual entitlement). */
  readonly maxActiveDeals: number | null;
}

export async function markPlanLive(input: MarkPlanLiveInput): Promise<MarkPlanLiveVerdict> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(MARK_PLAN_LIVE_FUNCTION, {
    p_plan_id: input.planId,
    p_tenant_id: input.tenantId,
    p_max_active_deals: input.maxActiveDeals,
  });

  // The mapped code rides along in the message on purpose: the most likely
  // production failure here is 0015's role allow-list being wrong for this
  // project (GO_LIVE_NOT_PERMITTED) or the grant being missing (NOT_FOUND,
  // from a 42501), and a log line that says which one is the difference
  // between a five-minute fix and an evening of guessing.
  if (error) {
    const { code } = mapPostgrestError(error as PostgrestErrorLike);
    throw new Error(`Failed to mark the plan live (${code}): ${error.message}`);
  }

  // Validated, not trusted — the same rule upsertFromState applies to
  // apply_tenant_subscription_event: a version of the function that is not
  // the one this file was written against must fail loudly rather than be
  // read as a refusal (a paying seller walled) or a success (an unpaid deal
  // going live).
  if (typeof data !== "string" || !MARK_PLAN_LIVE_VERDICTS.includes(data)) {
    throw new Error(`${MARK_PLAN_LIVE_FUNCTION} returned an unexpected verdict: ${JSON.stringify(data)}`);
  }

  return data as MarkPlanLiveVerdict;
}
