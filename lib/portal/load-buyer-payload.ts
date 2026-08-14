// T34-1 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). The one loader
// both buyer surfaces call after their own gate has already granted access.
//
// This file knows NOTHING about cookies or sessions. /portal/[id] (magic-link
// code) and /view/[id] (any-@ demo gate) genuinely differ in how a buyer
// proves who they are — folding that into a `mode` flag here would put the
// two gates one boolean apart, and that boolean would eventually be wrong.
// The gates stay exactly where they are: app/portal/[id]/gate-actions.ts and
// app/view/[id]/gate-actions.ts (plus each page.tsx's own session check).
//
// `requireTenantId` is how /view's demo-tenant scoping is expressed here
// instead: a plain equality check, not a branch. Passing it is what /view
// does; omitting it is what /portal does; the function itself never asks
// "which surface is this?"
//
// Returns null for BOTH "workspace does not exist" and "workspace belongs to
// a different tenant than requireTenantId" — one value, deliberately, so no
// caller can build a distinct response for each and reconstruct an
// enumeration oracle.
//
// Does NOT write analytics. portal_view logging lives in each gate action
// (T34-4), fired once per entry — not here, and not on every render.

import "server-only";

import { getPlanForBuyer, type PlanReadClient } from "@/lib/plans/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { toBuyerPayload, type BuyerPayload, type LinkRow, type WorkspaceRow } from "@/lib/portal-payload";

export interface LoadBuyerPayloadOptions {
  /**
   * When set, a workspace outside this tenant is treated identically to a
   * workspace that does not exist: this function returns null either way.
   * /view/[id] passes DEMO_TENANT_ID here; /portal/[id] omits it entirely.
   */
  requireTenantId?: string;
  /**
   * Injectable so this can be tested against a real Supabase project without
   * a live Next.js request context. Production callers omit it and get the
   * service-role client — buyers hold no Supabase Auth session, so there is
   * no RLS-scoped client to default to here.
   */
  client?: PlanReadClient;
}

/**
 * Loads everything a buyer is allowed to see for one workspace: the
 * boundary-stripped workspace fields (lib/portal-payload.ts), the live plan
 * tree if one exists, and shared resources.
 *
 * select("*") on both tables is deliberate, matching the existing loaders:
 * fetching the full row and stripping in one named place (toBuyerPayload)
 * beats a narrow SELECT that silently pre-filters upstream, where no leak
 * test is looking.
 */
export async function loadBuyerPayload(
  workspaceId: string,
  { requireTenantId, client }: LoadBuyerPayloadOptions = {},
): Promise<BuyerPayload | null> {
  const supabase = client ?? createAdminClient();

  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle();

  if (!workspaceRow) return null;
  const workspace = workspaceRow as WorkspaceRow;

  if (requireTenantId && workspace.tenant_id !== requireTenantId) return null;

  const [{ data: linkRows }, plan] = await Promise.all([
    supabase
      .from("links")
      .select("*")
      .eq("workspace_id", workspaceId)
      // Defence in depth; toBuyerPayload filters again. Free at the index
      // level via idx_links_workspace_shared.
      .eq("visibility", "shared")
      .order("category_header", { ascending: true })
      .order("display_order", { ascending: true }),
    getPlanForBuyer(workspaceId, supabase),
  ]);

  return toBuyerPayload(workspace, plan, (linkRows ?? []) as LinkRow[]);
}
