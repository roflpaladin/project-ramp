// Sprint 12, Ticket 60 (close a deal). Everything about a CLOSED plan: the
// vocabulary, and the guard that makes one read-only.
//
// Founder ruling (2026-09-21): won and lost behave identically. Closing
// frees an active-deal seat, deletes nothing, and the SELLER keeps seeing
// the plan with its outcome. "Read-only" is therefore a server rule, not a
// rendering choice — hidden buttons are not a boundary, and every plan /
// stage / step mutation resolves its owning plan through ensurePlanIsOpen()
// before it writes.
//
// One extra round trip per mutation, accepted deliberately: the alternative
// is a status check inside every RLS policy in 0005, which would make the
// rule invisible to anyone reading the application and impossible to change
// without a migration.
//
// RLS-scoped by construction — the caller passes its own session client, so
// a plan in another tenant is invisible here and reads as NOT_FOUND, exactly
// as it does in lib/plans/write.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError, type PostgrestErrorLike } from "./errors";
import type { PlanActionResult } from "./mutations";
import type { PlanStatus } from "./types";

/** The two outcomes a deal can be closed with. */
export type ClosedPlanStatus = Extract<PlanStatus, "won" | "lost">;

export const CLOSED_PLAN_STATUSES: readonly ClosedPlanStatus[] = Object.freeze(["won", "lost"]);

/** Boundary check for a close outcome arriving from a client component. */
export function isClosedPlanStatus(value: unknown): value is ClosedPlanStatus {
  return typeof value === "string" && CLOSED_PLAN_STATUSES.includes(value as ClosedPlanStatus);
}

/**
 * How the caller identifies the plan it is about to write to. Every mutating
 * plan action already holds exactly one of these three ids, so nothing has
 * to be threaded through the UI to use this guard.
 */
export type PlanRef =
  | { readonly planId: string }
  | { readonly stageId: string }
  | { readonly stepId: string };

interface StatusLookup {
  readonly table: string;
  readonly select: string;
  readonly id: string;
}

function lookupFor(ref: PlanRef): StatusLookup {
  if ("planId" in ref) return { table: "success_plans", select: "status", id: ref.planId };
  if ("stageId" in ref) return { table: "plan_stages", select: "success_plans!inner(status)", id: ref.stageId };
  return { table: "plan_steps", select: "plan_stages!inner(success_plans!inner(status))", id: ref.stepId };
}

/**
 * PostgREST has shipped both an object and a single-element array for a
 * to-one embed depending on how it infers the relationship. Neither shape is
 * worth depending on, so both are unwrapped rather than one being assumed.
 */
function unwrapEmbed(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
}

/**
 * Walks whichever nesting the lookup produced down to the plan's status:
 * the plan row is already the status row, a stage row carries one embed, a
 * step row two. Each level is skipped when it isn't there, so one walk
 * serves all three shapes.
 */
function readStatus(row: unknown): string | null {
  let node = unwrapEmbed(row);
  for (const key of ["plan_stages", "success_plans"]) {
    if (node && key in node) node = unwrapEmbed(node[key]);
  }

  const status = node?.status;
  return typeof status === "string" ? status : null;
}

/**
 * `{ ok: true }` means the plan exists, is visible to this caller, and is
 * still open (draft or active). Every other outcome is a refusal the caller
 * returns as-is — it is already a PlanActionResult.
 */
export async function ensurePlanIsOpen(client: SupabaseClient, ref: PlanRef): Promise<PlanActionResult<null>> {
  const lookup = lookupFor(ref);
  const { data, error } = await client
    .from(lookup.table)
    .select(lookup.select)
    .eq("id", lookup.id)
    .maybeSingle();

  if (error) return { ok: false, code: mapPostgrestError(error as PostgrestErrorLike).code };

  const status = readStatus(data);
  // No row, or a row whose plan could not be resolved: the same NOT_FOUND
  // the write layer returns for a foreign tenant. Never "assume open".
  if (status === null) return { ok: false, code: "NOT_FOUND" };

  if (CLOSED_PLAN_STATUSES.includes(status as ClosedPlanStatus)) {
    return { ok: false, code: "PLAN_CLOSED" };
  }

  return { ok: true, data: null };
}
