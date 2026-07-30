// Read paths for the mutual success plan tree.
//
// Two entry points that are deliberately NOT merged into one parameterised
// function. A single getPlan(workspaceId, { asBuyer }) would put the seller and
// buyer paths one boolean apart, and that boolean would eventually be wrong.
// Keeping them separate makes "which client am I on?" a property of the function
// you called, not of an argument someone forgot to pass.
//
// !! getPlanForBuyer RETURNING PRIVATE DATA IS CORRECT AT THIS LAYER !!
// It is a raw read through the service-role client, which bypasses RLS entirely.
// private_note comes back populated and that is expected. The strip happens in
// lib/portal-payload.ts (Ticket 25). Do not filter here: splitting the boundary
// across two files is how half of it gets forgotten, and a half-applied boundary
// reads as a whole one.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSellerClient } from "@/lib/supabase/server";
import type { PlanStage, PlanStageRow, PlanStepRow, PlanTree, SuccessPlanRow } from "./types";

/**
 * Any Supabase client. Injectable so the read paths can be tested: the seller
 * client is built from next/headers cookies(), which throws outside a request
 * context, so a test could not otherwise reach getPlanForSeller at all.
 * Production callers omit it and get the right client by default.
 */
export type PlanReadClient = SupabaseClient;

/**
 * Only one plan is ever live for a workspace. Migration 0005's partial unique
 * index (idx_success_plans_one_live_per_workspace) enforces exactly that over
 * these two statuses, which is what makes maybeSingle() below safe — archived
 * won/lost plans may coexist with a live one, so an unfiltered query could
 * legitimately match several rows and throw.
 */
const LIVE_PLAN_STATUSES = ["draft", "active"] as const;

// One round trip. Nested rather than a query per stage: a plan with eight stages
// would otherwise cost nine requests to render a single page.
const PLAN_TREE_SELECT = `
  id, workspace_id, title, start_date, target_date, status, created_at,
  plan_stages (
    id, plan_id, title, display_order, status,
    plan_steps (
      id, stage_id, label, owner_side, owner_name, owner_email,
      due_date, status, display_order, completed_at, completed_by_email, private_note
    )
  )
` as const;

/** The shape PostgREST returns for the nested select above. */
interface RawPlanRow extends SuccessPlanRow {
  plan_stages: (PlanStageRow & { plan_steps: PlanStepRow[] | null })[] | null;
}

/**
 * Ordered by display_order, ties broken on id.
 *
 * The tiebreak is not decoration. plan_stages.display_order carries no unique
 * constraint (0005 leaves it a plain index on purpose, so the builder can
 * reorder by rewriting the whole set without tripping a constraint mid-swap),
 * so duplicate values are legal and reachable. Without a deterministic second
 * key the same plan could render in a different order on consecutive loads.
 */
function byDisplayOrderThenId(
  a: { display_order: number; id: string },
  b: { display_order: number; id: string },
): number {
  if (a.display_order !== b.display_order) return a.display_order - b.display_order;
  return a.id.localeCompare(b.id);
}

/**
 * Shared by both read paths — the assembly is identical, only the client differs.
 * Sorting happens here rather than in SQL so the tiebreak is expressed once and
 * applies at every level.
 */
export function assemblePlanTree(raw: RawPlanRow): PlanTree {
  const { plan_stages, ...plan } = raw;

  const stages: PlanStage[] = [...(plan_stages ?? [])]
    .sort(byDisplayOrderThenId)
    .map(({ plan_steps, ...stage }) => ({
      ...stage,
      steps: [...(plan_steps ?? [])].sort(byDisplayOrderThenId),
    }));

  return { ...plan, stages };
}

async function fetchPlanTree(
  client: PlanReadClient,
  workspaceId: string,
): Promise<PlanTree | null> {
  const { data, error } = await client
    .from("success_plans")
    .select(PLAN_TREE_SELECT)
    .eq("workspace_id", workspaceId)
    .in("status", LIVE_PLAN_STATUSES)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load plan for workspace ${workspaceId}: ${error.message}`);
  }

  // No live plan is an ordinary state, not an error: a workspace exists before
  // anyone builds its plan. Callers render an empty state, they do not catch.
  if (!data) return null;

  return assemblePlanTree(data as unknown as RawPlanRow);
}

/**
 * Seller (AE) read path — RLS-scoped.
 *
 * Returns everything, private_note included. RLS restricts this to the caller's
 * own tenant: a workspace belonging to another tenant yields no rows, so this
 * returns null rather than throwing.
 */
export async function getPlanForSeller(
  workspaceId: string,
  client?: PlanReadClient,
): Promise<PlanTree | null> {
  return fetchPlanTree(client ?? (await createSellerClient()), workspaceId);
}

/**
 * Buyer read path — service-role, RLS bypassed BY DESIGN.
 *
 * Buyers hold no Supabase Auth session, so there is no RLS policy that could
 * scope this; the portal routes read through the service-role client after
 * validating the portal session cookie. This therefore returns the plan for ANY
 * workspace id, including another tenant's, and returns private_note populated.
 *
 * That is not a bug and it is not the boundary. The boundary is
 * lib/portal-payload.ts (Ticket 25). Anyone reasoning "RLS protects it" about
 * this function has misunderstood the architecture.
 */
export async function getPlanForBuyer(
  workspaceId: string,
  client?: PlanReadClient,
): Promise<PlanTree | null> {
  return fetchPlanTree(client ?? createAdminClient(), workspaceId);
}
