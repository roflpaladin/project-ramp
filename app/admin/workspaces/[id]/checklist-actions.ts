"use server";

// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Seller-only dismissal
// for the per-workspace activation checklist. lib/plans/activation.ts
// computes WHAT the checklist shows; this file only persists the seller's
// "dismiss" action against it.
//
// Dismissal lives in a `workspaces` column
// (activation_checklist_dismissed_at, migration 0012) rather than
// localStorage/a cookie — founder decision: it must follow the workspace
// itself across devices/browsers, the same reasoning every other
// per-workspace flag in this schema (approved_emails, chat_url, crm_*)
// already lives in the row rather than client storage.
//
// requireSeller() is this file's first line (T28-9's contract; statically
// enforced by tests/security/server-action-auth.spec.ts). Touches ONLY
// seller.client (RLS-scoped), never the service-role admin client — the "AE
// manages own tenant workspaces" RLS policy (0001) is what actually blocks a
// cross-tenant workspaceId, the same reliance invite-actions.ts and
// links-actions.ts already place on it; there is no second, explicit
// tenant_id check in this file.

import { revalidatePath } from "next/cache";

import { requireSeller } from "@/lib/plans/require-seller";

/**
 * `{ ok: false, code }` on failure rather than a thrown error or a free-text
 * message — mirrors lib/plans/mutations.ts's PlanActionResult shape, the
 * convention every other mutation in this codebase's admin surface returns.
 */
export type DismissChecklistResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHENTICATED" | "NOT_FOUND" };

export async function dismissActivationChecklist(workspaceId: string): Promise<DismissChecklistResult> {
  const session = await requireSeller();
  if (!session) return { ok: false, code: "UNAUTHENTICATED" };

  const { data, error } = await session.client
    .from("workspaces")
    .update({ activation_checklist_dismissed_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, code: "NOT_FOUND" };
  // RLS hides a foreign tenant's row rather than erroring the SELECT half of
  // this round trip — null covers both "no such workspace" and "not this
  // caller's tenant" with the one NOT_FOUND code, mirroring
  // lib/plans/write.ts's updatePlan.
  if (!data) return { ok: false, code: "NOT_FOUND" };

  revalidatePath(`/admin/workspaces/${workspaceId}`);
  return { ok: true };
}
