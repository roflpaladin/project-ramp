"use server";

import { redirect } from "next/navigation";

import { isValidDomain, normalizeDomain } from "@/lib/domain";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, ONBOARDING_RATE_LIMIT } from "@/lib/rate-limit";
import { seedSampleDeal } from "@/lib/seed/sample-deal";
import {
  INSERT_FAILED_MESSAGE,
  INVALID_DOMAIN_MESSAGE,
  MISSING_NAME_MESSAGE,
  MISSING_TENANT_MESSAGE,
  RATE_LIMITED_MESSAGE,
  type OnboardingActionState,
} from "./onboarding-state";

// Sprint 8, Ticket 41 — guided first-run onboarding. The two server actions
// behind the fork every fresh self-serve seller sees right after
// registration (T39): "start with a sample deal" (lib/seed/sample-deal.ts,
// T42) or "create your first workspace" by hand. Both are useActionState
// actions (React 19) — the UI (built separately against these exact
// exports) supplies the `<form action={...}>` binding and the
// disable-on-pending affordance; neither action does anything client-side.
//
// Both call requireSeller() as their first line (T28-9's contract, statically
// enforced by tests/security/server-action-auth.spec.ts) and, once past that
// guard, touch only seller.client (RLS-scoped) or hand seller-derived values
// to seedSampleDeal() — never a service-role client of this file's own.
//
// The OnboardingActionState type + its INITIAL_ONBOARDING_STATE initial value
// live in the separate, non-"use server" ./onboarding-state.ts, not here: a
// plain-object export from a "use server" module crashes every form submit
// in a production build (Next only allows async-function exports from a
// "use server" file there) — this file exports ONLY the two async actions.

// Error copy lives in ./onboarding-state.ts (shared with the client's
// aria-invalid matcher — see that file's comment). This "use server" module
// still exports only the two async actions.

/**
 * "Start with a sample deal": hands the seller's own tenant/user off to
 * seedSampleDeal (T42), which self-validates that pair against the user's
 * real app_metadata claim before writing anything — this action is never the
 * authority on tenant scoping, only the messenger.
 *
 * No double-click guard here beyond what the UI already provides
 * (disable-on-pending via useActionState's `isPending`): seedSampleDeal has
 * no idempotency by design (T42) — a second click before the redirect lands
 * is accepted as producing a second, harmless "Sample deal — Meridian Retail
 * Group" workspace, not treated as a bug this action needs to prevent.
 */
export async function startWithSampleDeal(
  _previousState: OnboardingActionState,
  _formData: FormData,
): Promise<OnboardingActionState> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");

  if (!seller.tenantId) {
    return { error: MISSING_TENANT_MESSAGE };
  }

  // Security review (T41): disable-on-pending is UI state, not a control — a
  // Server Action is a stable POST endpoint, so a scripted caller could
  // otherwise replay this far faster than the UI allows, and every call
  // writes ~17 service-role rows (seedSampleDeal is non-idempotent by
  // design). Keyed per seller, same in-memory interim limiter T39 ships for
  // registration/send-token; distributed limiting stays Ticket 62 scope.
  const sampleLimit = checkRateLimit(
    `onboarding-sample:${seller.userId}`,
    ONBOARDING_RATE_LIMIT.limit,
    ONBOARDING_RATE_LIMIT.windowMs,
  );
  if (!sampleLimit.allowed) {
    return { error: RATE_LIMITED_MESSAGE };
  }

  const result = await seedSampleDeal({ tenantId: seller.tenantId, userId: seller.userId });
  if (!result.ok) {
    return { error: result.message };
  }

  redirect(`/admin/workspaces/${result.workspaceId}`);
}

/**
 * "Create your first workspace" — the manual onboarding path. Functionally
 * parallel to app/admin/workspaces/new/actions.ts's createWorkspace, with
 * one deliberate difference: that file redirects with the raw Postgres
 * `error.message` embedded in the URL on an insert failure (see this
 * ticket's recon note) — this action never surfaces raw exception text,
 * only the fixed INSERT_FAILED_MESSAGE copy below.
 */
export async function createFirstWorkspace(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");

  const targetCompanyName = String(formData.get("target_company_name") ?? "").trim();
  if (!targetCompanyName) {
    return { error: MISSING_NAME_MESSAGE };
  }

  const targetDomain = normalizeDomain(String(formData.get("target_domain") ?? ""));
  if (!isValidDomain(targetDomain)) {
    return { error: INVALID_DOMAIN_MESSAGE };
  }

  if (!seller.tenantId) {
    return { error: MISSING_TENANT_MESSAGE };
  }

  // Same per-seller interim limiter as startWithSampleDeal above — placed
  // after validation so a typo'd resubmit never burns budget, before the
  // write so a scripted caller can't mass-create workspaces.
  const manualLimit = checkRateLimit(
    `onboarding-manual:${seller.userId}`,
    ONBOARDING_RATE_LIMIT.limit,
    ONBOARDING_RATE_LIMIT.windowMs,
  );
  if (!manualLimit.allowed) {
    return { error: RATE_LIMITED_MESSAGE };
  }

  const { data: workspace, error } = await seller.client
    .from("workspaces")
    .insert({
      target_company_name: targetCompanyName,
      target_domain: targetDomain,
      created_by: seller.userId,
      tenant_id: seller.tenantId,
    })
    .select("id")
    .single();

  if (error || !workspace) {
    return { error: INSERT_FAILED_MESSAGE };
  }

  redirect(`/admin/workspaces/${workspace.id}`);
}
