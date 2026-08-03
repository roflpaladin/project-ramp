import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * T28-9 (Sprint 6, Ticket 28). First line of every mutating plan action
 * (app/admin/workspaces/[id]/plan/plan-actions.ts) — mirrors the guard shape
 * app/admin/workspaces/new/actions.ts and app/settings/integrations/actions.ts
 * already use inline (createClient -> auth.getUser() -> bail if absent),
 * pulled into one place so every plan mutation calls the exact same check
 * rather than a hand-copied version of it.
 */
export interface SellerSession {
  readonly client: SupabaseClient;
  readonly userId: string;
}

/**
 * Returns null rather than throwing or redirecting: a Server Action's error
 * needs to become `{ ok: false, code: "UNAUTHENTICATED" }` (T28-10), which a
 * thrown error or a next/navigation redirect can't cleanly express as a
 * PlanActionResult. The caller turns null into that result itself.
 *
 * Deliberately re-derives the client and session on every call rather than
 * accepting one as a parameter — the whole point of "first line of every
 * mutating action" is that nobody can pass in an unverified client and skip
 * the check.
 */
export async function requireSeller(): Promise<SellerSession | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) return null;

  return { client, userId: user.id };
}
