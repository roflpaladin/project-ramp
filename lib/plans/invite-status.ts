// Sprint 11, Ticket 58 — "In-App Onboarding Checklist".
//
// Whether ANY buyer invite has ever been SENT for a workspace — the signal
// the activation checklist's "buyer invited" step needs
// (lib/plans/activation.ts). Existence only: returns a boolean, never an
// email, expiry, or consumption state. This is deliberately NOT a substitute
// for the real portal_access_tokens reads in lib/portal-access-token.ts,
// which do carry those fields — this module answers one narrow question and
// nothing else.
//
// SERVICE-ROLE, NOT RLS-SCOPED — by necessity, not convenience.
// portal_access_tokens (migration 0002) ships with RLS enabled and ZERO
// policies: default-deny for every authenticated role, including the
// seller's own session. A query through the seller's RLS-scoped client
// against this table always returns zero rows, so this function would
// silently and PERMANENTLY report "never invited" for every workspace if it
// used that client. lib/portal-access-token.ts's own reads/writes already
// establish this exact service-role-only access pattern for this table —
// this module follows it, not invents it.
//
// TENANT SCOPING IS THE CALLER'S JOB. This function filters only by
// `workspace_id`; the service-role client bypasses RLS entirely, so it will
// answer for ANY workspace id, including another tenant's. That is the same
// division of labour app/admin/workspaces/[id]/invite-actions.ts's
// issueAccessTokenForInvite call already relies on: callers here are
// expected to have already resolved workspaceId through an RLS-scoped
// `workspaces` read (e.g. the workspace detail page's own lookup) BEFORE
// calling this. Passing an unvalidated workspaceId straight through would
// answer "has this OTHER tenant's workspace been invited?" — exactly the
// boundary this codebase's RLS policies exist to hold.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/** Injectable for testability — mirrors lib/plans/queries.ts's PlanReadClient. */
export type InviteStatusReadClient = SupabaseClient;

export async function hasSentInviteForWorkspace(
  workspaceId: string,
  client?: InviteStatusReadClient,
): Promise<boolean> {
  const supabase = client ?? createAdminClient();

  const { data, error } = await supabase
    .from("portal_access_tokens")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check invite status for workspace ${workspaceId}: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}
