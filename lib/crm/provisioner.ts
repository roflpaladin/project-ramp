import type { CrmDealEvent, ResolvedOwner } from "@/lib/crm/types";

// Automated Workspace Provisioner seam (Sprint 3). Ticket 14 lands the
// ingestion + filter that call into this; the real four-pillar engine
// (anchor, scrape, whitelist, tenant-map in one service-role transaction)
// is Ticket 15 and replaces this stub.

export type ProvisionResult = {
  status: number;
  body: { success: boolean; workspace_id?: string; message: string };
};

export async function provisionWorkspaceFromCrm(
  _event: CrmDealEvent,
  _owner: ResolvedOwner,
): Promise<ProvisionResult> {
  return {
    status: 501,
    body: { success: false, message: "Workspace provisioner not yet implemented (Ticket 15)." },
  };
}
