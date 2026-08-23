"use server";

// Ticket 45 (Sprint 9), Phase 2b — rebuild of the legacy manual
// workspace-creation form onto the useActionState pattern this codebase
// standardised on for T41/T43/T45 (onboarding-actions.ts, invite-actions.ts,
// import-actions.ts). Replaces app/admin/workspaces/new/actions.ts, whose own
// doc comment flagged that it redirected with the raw Postgres `error.message`
// embedded in a query string on an insert failure — a real exception-text
// leak into the UI. This file never surfaces anything but its own fixed,
// app-authored copy (./workspace-form-state.ts).
//
// Named new-workspace-actions.ts, not actions.ts, so the server-action auth
// coverage probe (tests/security/support/route-probe.ts's listActionFiles)
// picks it up — that probe only walks files whose basename ends in
// "-actions.ts", mirroring every other action file in app/admin/**
// (plan-actions.ts, links-actions.ts, onboarding-actions.ts, invite-actions.ts,
// import-actions.ts).
//
// Field set: unchanged from the legacy form (target_company_name,
// target_domain) — the ticket allowed adding optional plan_title/target_date
// IF trivially composable with lib/plans/write.ts's createPlan(). It is not:
// createPlan requires a non-empty `title` and returns a PlanActionResult
// error CODE with no message text (lib/plans/mutations.ts's own comment: "no
// free-text `message` field"), so an optional, possibly-empty plan_title
// would need its own validation branch, its own code-to-copy mapping, AND a
// decision for the half-succeeded case (workspace insert ok, plan insert
// fails) that the rest of this form has no precedent for. That's real added
// scope, not a trivial field bolt-on — kept out per YAGNI, same field set as
// today.
//
// Mirrors app/admin/onboarding/onboarding-actions.ts's createFirstWorkspace
// almost exactly (same two fields, same validation order, same
// requireSeller()-then-redirect-to-login-on-null shape) since this page and
// that flow's manual step are functionally the same operation reached from
// two different entry points.

import { redirect } from "next/navigation";

import { isValidDomain, normalizeDomain } from "@/lib/domain";
import { requireSeller } from "@/lib/plans/require-seller";
import {
  INSERT_FAILED_MESSAGE,
  INVALID_DOMAIN_MESSAGE,
  MISSING_NAME_MESSAGE,
  MISSING_TENANT_MESSAGE,
  type NewWorkspaceActionState,
} from "./workspace-form-state";

export async function createWorkspace(
  _previousState: NewWorkspaceActionState,
  formData: FormData,
): Promise<NewWorkspaceActionState> {
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
