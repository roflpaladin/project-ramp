import { scrapeBrandTitle } from "@/lib/crm/brand-scrape";
import type { CrmDealEvent, ResolvedOwner } from "@/lib/crm/types";
import { createAdminClient } from "@/lib/supabase/admin";

// Automated Workspace Provisioner Engine (Sprint 3, Ticket 15). Commits the
// Four Core Data Pillars via the service-role client (lib/supabase/admin.ts),
// matching the Sprint 1/2 write pattern. Atomicity: all four pillars land in
// ONE INSERT on workspaces (the whitelist is the row's own approved_emails
// array per the no-second-table ruling, and branding/favicon derive from
// target_domain at render), so a single-statement transaction covers the
// "no orphan workspace on partial failure" requirement — there is no
// multi-table write to orphan.

export type ProvisionResult = {
  status: number;
  body: { success: boolean; workspace_id?: string; message: string };
};

export async function provisionWorkspaceFromCrm(
  event: CrmDealEvent,
  owner: ResolvedOwner,
  triggerStage: string,
): Promise<ProvisionResult> {
  // Pillar 2 — Branding: SSRF-guarded scrape of the account domain for a
  // display name. CRM-supplied company name wins (it's authoritative);
  // scrape fills the gap; the bare domain is the generic fallback. Scrape
  // failure never fails provisioning.
  const scrapedTitle = event.companyName ? null : await scrapeBrandTitle(event.domain);
  const targetCompanyName = event.companyName ?? scrapedTitle ?? event.domain;

  // Pillar 3 — Buyer Whitelist: parser already normalized + deduped. Ghost
  // Contact (empty list) is fine — the Security Gate also approves any email
  // whose domain matches target_domain (lib/portal-access.ts), so anchoring
  // target_domain to the account domain IS the domain-level fallback.
  const admin = createAdminClient();
  const { data: workspace, error } = await admin
    .from("workspaces")
    .insert({
      // Pillar 4 — Seller Instance Mapping: tenant resolved from the AE's
      // app_metadata tenant_id claim (Ticket 14), never auth.uid().
      tenant_id: owner.tenantId,
      created_by: owner.userId,
      target_company_name: targetCompanyName,
      target_domain: event.domain,
      approved_emails: event.buyerEmails,
      // Pillar 1 — Deal Anchor.
      crm_source: event.crmSource,
      crm_object_id: event.crmObjectId,
      // New workspaces inherit the tenant's effective trigger so the
      // per-workspace config stays tenant-consistent (see trigger-stage.ts).
      trigger_stage: triggerStage,
    })
    .select("id")
    .single();

  if (error) {
    // idx_workspaces_tenant_crm (0004): same CRM deal already provisioned
    // within this tenant — webhook retry/duplicate, not a server fault.
    if (error.code === "23505") {
      return {
        status: 409,
        body: {
          success: false,
          message: `Deal ${event.crmObjectId} (${event.crmSource}) is already provisioned for this tenant.`,
        },
      };
    }
    return {
      status: 500,
      body: { success: false, message: "Workspace provisioning failed." },
    };
  }

  return {
    status: 201,
    body: {
      success: true,
      workspace_id: workspace.id,
      message: `Workspace provisioned for ${targetCompanyName} (${event.crmSource} ${event.crmObjectId}).`,
    },
  };
}
