// T36-3 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Resolves step
// labels for /api/demo/pulse's step_complete feed entries via a NARROW
// select — id and label only. plan_steps also carries private_note and
// owner_email (seller-private, per lib/plans/types.ts), and this route is a
// session-less, unauthenticated, public polling endpoint: a `select("*")`
// here would hand both straight to anyone who can guess a demo workspace id.
// Never widen STEP_LABEL_SELECT without re-reading that sentence.

import type { SupabaseClient } from "@supabase/supabase-js";

export const STEP_LABEL_SELECT = "id, label" as const;

interface StepLabelRow {
  readonly id: string;
  readonly label: string;
}

/**
 * One round trip for every step_complete row in a single pulse response,
 * mirroring the route's existing link-label lookup. Unknown or deleted step
 * ids (workspace_analytics.step_id is ON DELETE SET NULL, migration 0005)
 * simply have no entry in the returned map — callers fall back to a default
 * label rather than treating that as an error.
 */
export async function resolveStepLabels(
  stepIds: readonly string[],
  client: SupabaseClient,
): Promise<Map<string, string>> {
  const labelById = new Map<string, string>();
  const uniqueIds = [...new Set(stepIds)];
  if (uniqueIds.length === 0) return labelById;

  const { data, error } = await client.from("plan_steps").select(STEP_LABEL_SELECT).in("id", uniqueIds);

  if (error) {
    // Degrade gracefully: a label-lookup failure must not break the whole
    // pulse feed (mirrors the route's existing tolerance for its link-label
    // lookup, which also never throws). Logged with full context
    // server-side, never surfaced to the caller.
    console.error("[pulse] step label lookup failed:", { message: error.message });
    return labelById;
  }

  for (const step of (data ?? []) as StepLabelRow[]) {
    labelById.set(step.id, step.label);
  }
  return labelById;
}
