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
  /**
   * T43 (Sprint 8, Ticket 43). Additive -- the seller-invite flow
   * (app/admin/workspaces/[id]/invite-actions.ts) needs the AE's own inbox
   * address for the "invite yourself" case. `null`, not thrown/omitted, on
   * the rare account that has no email on the Supabase Auth user (e.g. a
   * phone-only sign-in), so callers get an explicit value to handle rather
   * than an implicit `undefined`.
   */
  readonly email: string | null;
  /**
   * T41 (Sprint 8, Ticket 41). The guided first-run onboarding flow
   * (app/admin/onboarding/onboarding-actions.ts) needs the seller's own
   * tenant claim to hand to lib/seed/sample-deal.ts's seedSampleDeal() and to
   * stamp on a manually-created first workspace — mirrors
   * app/admin/workspaces/new/actions.ts's inline
   * `user.app_metadata?.tenant_id as string | undefined` read, pulled in here
   * so onboarding doesn't have to re-derive it from `client.auth.getUser()`
   * a second time. Additive: `null`, not thrown, when the claim is absent
   * (the same "explicit value over implicit undefined" reasoning as `email`
   * above) — a real case for an account whose tenant provisioning (T39)
   * never completed.
   */
  readonly tenantId: string | null;
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

  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;

  return { client, userId: user.id, email: user.email ?? null, tenantId };
}
