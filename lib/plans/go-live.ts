// Sprint 12, Ticket 60 (active-deal limit). The go-live decision, start to
// finish: may this tenant start another deal, and did the database agree?
//
// It lives in lib/ rather than inside the server action so the flow is
// testable without a request context, and so the action stays what every
// other action in that file is — requireSeller, delegate, revalidate.
//
// FAIL CLOSED, BUT HONESTLY (orchestrator call, 2026-09-21). Three different
// "no" answers, never collapsed into one:
//   BILLING_PAST_DUE     payment failed and the grace is over.
//   DEAL_LIMIT_REACHED   the tenant is at their tier's cap — the upgrade wall.
//   BILLING_CHECK_FAILED we could not find out. No new deal, but the seller
//                        is told it was us, not them, and every one of these
//                        is logged server-side with the tenant id.
// Rendering the upgrade wall for our own outage would be a lie about money,
// which is why the third exists at all.
//
// The limit itself is NOT decided here: markPlanLive hands the tier's cap to
// 0015's mark_plan_live(), which re-counts under a per-tenant lock. This
// module only chooses the number and reads the verdict.

import { getTenantEntitlement } from "@/lib/billing/tenant-entitlement";
import type { Entitlement } from "@/lib/billing/entitlement";
import { markPlanLive } from "./mark-live";
import type { PlanActionResult } from "./mutations";
import { getPlanRowForSeller } from "./queries";
import type { SellerSession } from "./require-seller";
import type { SuccessPlanRow } from "./types";

const LOG_PREFIX = "[go-live]";

/**
 * Read back through the SELLER's own client, not the service-role one that
 * performed the write: it re-proves under RLS that the plan now live really
 * is in the caller's tenant, and it is the row shape every caller of this
 * action already expects.
 */
async function readBackPlan(session: SellerSession, planId: string): Promise<PlanActionResult<SuccessPlanRow>> {
  const row = await getPlanRowForSeller(planId, session.client);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, data: row };
}

export async function goLivePlan(
  session: SellerSession,
  planId: string,
): Promise<PlanActionResult<SuccessPlanRow>> {
  const { tenantId } = session;
  // No tenant claim means provisioning (T39) never completed for this
  // account. There is no safe default cap to assume, so nothing goes live.
  if (!tenantId) {
    console.error(`${LOG_PREFIX} refused: no tenant claim on the session`, { userId: session.userId });
    return { ok: false, code: "BILLING_CHECK_FAILED" };
  }

  let entitlement: Entitlement;
  try {
    entitlement = await getTenantEntitlement(tenantId);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not read the billing state for tenant ${tenantId}`, error);
    return { ok: false, code: "BILLING_CHECK_FAILED" };
  }

  if (entitlement.isBlockedFromNewDeals) return { ok: false, code: "BILLING_PAST_DUE" };

  try {
    const verdict = await markPlanLive({ planId, tenantId, maxActiveDeals: entitlement.maxActiveDeals });

    if (verdict === "limit_reached") return { ok: false, code: "DEAL_LIMIT_REACHED" };
    // The sample workspace is excluded from the count, so it must also be
    // excluded from going live — otherwise it is a free, permanent extra
    // deal. Deliberately NOT the upgrade wall: no plan change fixes it.
    if (verdict === "sample_workspace") return { ok: false, code: "SAMPLE_DEAL_LOCKED" };
    if (verdict === "not_found") return { ok: false, code: "NOT_FOUND" };

    // 'live' and 'already_live' are both success: a second click, or a retry
    // after a dropped response, must not read as a failure.
    return await readBackPlan(session, planId);
  } catch (error) {
    console.error(`${LOG_PREFIX} failed to make plan ${planId} live for tenant ${tenantId}`, error);
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
