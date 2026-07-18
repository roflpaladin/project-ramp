import { createAdminClient } from "@/lib/supabase/admin";

// Mirrors the DB default on workspaces.trigger_stage (migration 0004). Used
// only when a tenant has no workspaces yet — the filter itself always reads
// the saved config, never a hardcoded stage literal.
export const DEFAULT_TRIGGER_STAGE = "evaluation";

// Stage names differ in casing across vendors ("Evaluation" in a Salesforce
// StageName, "evaluation" as a HubSpot internal dealstage value, title case in
// the Settings UI mock pipeline) — comparisons are case-insensitive.
export function normalizeStage(stage: string): string {
  return stage.trim().toLowerCase();
}

// Effective trigger stage for a tenant (Sprint 3 config-scope ruling): the
// column lives per-workspace (0004), but the setting is tenant-wide in
// practice — the Settings UI (Ticket 16) saves the chosen stage across all of
// the tenant's workspaces and the provisioner stamps it onto new ones, so any
// row is representative. Tenant with no workspaces yet → DB default.
export async function getTriggerStageForTenant(tenantId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspaces")
    .select("trigger_stage")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  const configured = data?.trigger_stage;
  return typeof configured === "string" && configured.trim() ? configured : DEFAULT_TRIGGER_STAGE;
}
