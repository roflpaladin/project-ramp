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
import { CLOSED_PLAN_STATUSES } from "./closed-plans";
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
 * Seller read path for a CLOSED deal (Sprint 12, Ticket 60).
 *
 * Founder ruling (2026-09-21): closing a deal deletes nothing — the seller
 * keeps seeing the plan, read-only, with its Won/Lost status. getPlanForSeller
 * above cannot serve that: it matches draft+active only, which is what makes
 * its .maybeSingle() safe.
 *
 * This read therefore CANNOT use .maybeSingle(). Nothing stops a workspace
 * accumulating several closed plans — 0005's unique index covers draft+active
 * only, precisely so a new plan can start after a close — so the widened
 * filter can legitimately match many rows, and one of them has to be chosen
 * explicitly: newest first, ties broken on id so two plans created in the same
 * transaction don't render in a different order on consecutive loads.
 *
 * Intended use is the fallback, not a second query on every load: call it only
 * when getPlanForSeller returned null. The returned tree's own `status` is how
 * a caller knows to render read-only.
 *
 * getPlanForBuyer and the buyer portal path are deliberately untouched by T60.
 */
export async function getClosedPlanForSeller(
  workspaceId: string,
  client?: PlanReadClient,
): Promise<PlanTree | null> {
  const supabase = client ?? (await createSellerClient());
  const { data, error } = await supabase
    .from("success_plans")
    .select(PLAN_TREE_SELECT)
    .eq("workspace_id", workspaceId)
    .in("status", CLOSED_PLAN_STATUSES)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load closed plan for workspace ${workspaceId}: ${error.message}`);
  }

  const [row] = (data ?? []) as unknown as RawPlanRow[];
  if (!row) return null;

  return assemblePlanTree(row);
}

/**
 * One plan row, no tree (Sprint 12, Ticket 60).
 *
 * The go-live path writes through 0015's mark_plan_live() on the service-role
 * client, which returns a verdict rather than the row — so the action reads
 * the row back through the SELLER's own client to answer with. That read-back
 * is not just plumbing: it re-proves under RLS that the plan it just made live
 * really is in the caller's tenant.
 *
 * null covers both "no such plan" and "not this caller's tenant", the same
 * conflation lib/plans/write.ts documents.
 */
export async function getPlanRowForSeller(
  planId: string,
  client?: PlanReadClient,
): Promise<SuccessPlanRow | null> {
  const supabase = client ?? (await createSellerClient());
  const { data, error } = await supabase.from("success_plans").select("*").eq("id", planId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load plan ${planId}: ${error.message}`);
  }

  return (data as SuccessPlanRow | null) ?? null;
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
