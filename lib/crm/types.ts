// Sprint 3 (v1.2): shared shapes for the CRM ingestion pipeline.
// Mock vendor webhooks (HubSpot/Salesforce shapes) are normalized into one
// CrmDealEvent — the Four Core Data Pillars — before filtering/provisioning.

export type CrmSource = "hubspot" | "salesforce";

export type CrmDealEvent = {
  crmSource: CrmSource;
  // Pillar 1 — Deal Anchor: HubSpot dealId/hs_object_id, Salesforce Opportunity Id.
  crmObjectId: string;
  // Pillar 2 — Branding: company domain (normalized) + optional display name.
  domain: string;
  companyName: string | null;
  // Pillar 3 — Access Control: buyer emails. May be empty (Salesforce "Ghost
  // Contact") — the provisioner falls back to the account domain, never errors.
  buyerEmails: string[];
  // Pillar 4 — Seller Instance Mapping: the AE who owns the deal.
  ownerEmail: string | null;
  // Stage property (dealstage/StageName), compared against the configured
  // trigger_stage. Normalized to lowercase for the comparison.
  stage: string;
};

export type ResolvedOwner = {
  // auth.users id for workspaces.created_by.
  userId: string;
  // tenant_id claim from app_metadata — the RLS anchor.
  tenantId: string;
};
