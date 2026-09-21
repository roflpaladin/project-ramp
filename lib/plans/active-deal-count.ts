// Sprint 12, Ticket 60 (active-deal limit). How many deals is this tenant
// running right now?
//
// ADVISORY ONLY. The decision that actually gates a go-live is made inside
// 0015's mark_plan_live(), which re-counts under a per-tenant row lock —
// two tabs pressing "make it live" at the same cap cannot both win there,
// and no count read here could promise that. This function exists so the
// seller can SEE where they stand ("2 of 3 active deals") before pressing
// anything, and so a wall can be rendered before a refusal rather than after.
//
// Service-role: the count spans every workspace in the tenant, including
// ones the signed-in seller did not create, so an RLS-scoped read would be
// the wrong number as soon as a tenant has a second user.
//
// Sample deals do not count (founder ruling, and 0015's own reasoning): a
// brand-new Free tenant is seeded with an ACTIVE sample plan, and a cap of 1
// would otherwise mean their first real deal can never go live.

import { createAdminClient } from "@/lib/supabase/admin";

const PLANS_TABLE = "success_plans";

/** The live status. Draft plans cost nothing — only a live deal holds a seat. */
const ACTIVE_STATUS = "active";

/**
 * A real column plus the inner-joined workspace, NOT a head-only count:
 * a HEAD request with count("exact") comes back 204 even for a table that
 * does not exist (project memory, 2026-08), which would turn a schema
 * mistake into a confident zero.
 */
const ACTIVE_DEAL_SELECT = "id, workspaces!inner(tenant_id, is_sample)";

export async function countActiveDealsForTenant(tenantId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from(PLANS_TABLE)
    .select(ACTIVE_DEAL_SELECT, { count: "exact", head: false })
    .eq("status", ACTIVE_STATUS)
    .eq("workspaces.tenant_id", tenantId)
    .eq("workspaces.is_sample", false);

  if (error) throw new Error(`Failed to count active deals for tenant ${tenantId}: ${error.message}`);

  // Never coalesced to 0: "we could not count" and "there are none" lead to
  // opposite decisions upstream, and only one of them is safe to guess.
  if (count === null) {
    throw new Error(`Failed to count active deals for tenant ${tenantId}: the driver returned no count`);
  }

  return count;
}
