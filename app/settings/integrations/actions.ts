"use server";

import { redirect } from "next/navigation";
import { MOCK_PIPELINE_STAGES } from "@/lib/crm/stages";
import { createClient } from "@/lib/supabase/server";

// Persists the chosen trigger stage (Sprint 3, Ticket 16). Config-scope
// ruling (the ticket's flagged open item): trigger_stage lives per-workspace
// (0004), but the product setting is tenant-wide — so Save writes the stage
// across ALL of the tenant's workspaces, keeping the per-workspace config
// tenant-consistent, and the provisioner stamps it onto new workspaces. A true
// tenants.default_trigger_stage column stays a flagged follow-up migration.
//
// Writes go through the RLS-scoped client on purpose: the "AE manages own
// tenant workspaces" policy enforces the tenant boundary at the DB layer even
// if this code were wrong about the session's tenant.
export async function saveTriggerStage(formData: FormData) {
  const submitted = String(formData.get("trigger_stage") ?? "").trim();
  const stage = MOCK_PIPELINE_STAGES.find(
    (candidate) => candidate.toLowerCase() === submitted.toLowerCase(),
  );
  if (!stage) {
    redirect(`/settings/integrations?error=${encodeURIComponent("Pick a stage from the list.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/admin/login");
  }
  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  if (!tenantId) {
    redirect(`/settings/integrations?error=${encodeURIComponent("Your account has no tenant assigned yet.")}`);
  }

  const { data: updated, error } = await supabase
    .from("workspaces")
    .update({ trigger_stage: stage })
    .eq("tenant_id", tenantId)
    .select("id");

  if (error) {
    redirect(`/settings/integrations?error=${encodeURIComponent(error.message)}`);
  }
  if (!updated || updated.length === 0) {
    // Per-workspace config scope means a tenant with zero workspaces has no
    // row to persist to yet — the flagged limitation of the ruling above.
    redirect(
      `/settings/integrations?error=${encodeURIComponent(
        "No workspaces to save to yet — the trigger applies once your first workspace exists.",
      )}`,
    );
  }

  redirect("/settings/integrations?saved=1");
}
