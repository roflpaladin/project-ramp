// Sprint 10, Ticket 53 — thin wrapper over lib/crm-connections/token-store.ts's
// isTenantConnected(), turning its boolean into this ticket's binding
// CrmConnectionState shape. No new logic: hubspot-import-actions.ts's
// listHubSpotDeals() and importHubSpotDeals() both need "is this tenant
// connected?" as their very first CRM-specific check (before any adapter
// call), so this is the one place that question is asked in the CRM-import
// shape rather than each action re-deriving it inline.
//
// Sprint 11, Ticket 56 — getSalesforceConnectionState() added alongside
// getHubSpotConnectionState() for the same reason on the Salesforce side
// (salesforce-import-actions.ts's own list/import pair). isTenantConnected()
// already accepts a `provider` argument (defaulting to "hubspot" for every
// pre-T56 caller) — this file just names the Salesforce call explicitly
// rather than adding a new lookup mechanism.

import "server-only";

import { isTenantConnected } from "@/lib/crm-connections/token-store";
import type { CrmConnectionState } from "./types";

export async function getHubSpotConnectionState(tenantId: string): Promise<CrmConnectionState> {
  const isConnected = await isTenantConnected(tenantId, "hubspot");
  return { provider: "hubspot", isConnected };
}

export async function getSalesforceConnectionState(tenantId: string): Promise<CrmConnectionState> {
  const isConnected = await isTenantConnected(tenantId, "salesforce");
  return { provider: "salesforce", isConnected };
}
