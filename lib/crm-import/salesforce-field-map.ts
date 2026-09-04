// Sprint 11, Ticket 56 — static Salesforce standard-field table driving both
// the field-mapping preview (CrmFieldMapping[]) and the unmappedFields list
// in CrmImportResult. Mirrors lib/crm-import/hubspot-field-map.ts's own
// SETTLED decision, restated here: no live Salesforce field-metadata call
// (no Tooling API / describe() round trip) in v1 — this fixed table is the
// entire source of "what fields exist on a Salesforce Opportunity and where
// each one goes (or doesn't) in Brava".
//
// Deliberately includes entries with targetField: null (Type, NextStep,
// OwnerId, Description) — known-but-unused standard Opportunity fields — for
// the same reason hubspot-field-map.ts documents its own unmapped rows: a
// seller reviewing the import sees exactly what Salesforce data exists but is
// NOT imported, rather than assuming silence means "everything came across".
// salesforce-adapter.ts's own SOQL SELECT lists still only ever fetch the
// seven mapped fields below (least-data reads, same discipline as HubSpot's
// module) — the unmapped rows are documentation, not a promise this pipeline
// reads them.

import type { CrmDealDetail, CrmFieldMapping, CrmUnmappedField } from "./types";

interface SalesforceFieldDefinition {
  readonly sourceField: string;
  readonly sourceLabel: string;
  readonly targetField: string | null;
  readonly sample: (detail: CrmDealDetail) => string | null;
}

function noSample(): null {
  return null;
}

export const SALESFORCE_FIELD_TABLE: readonly SalesforceFieldDefinition[] = [
  { sourceField: "Name", sourceLabel: "Opportunity name", targetField: "plan_title", sample: (d) => d.dealName },
  { sourceField: "Amount", sourceLabel: "Amount", targetField: "crm_amount", sample: (d) => d.amount },
  { sourceField: "StageName", sourceLabel: "Stage", targetField: "crm_stage", sample: (d) => d.stage },
  { sourceField: "CloseDate", sourceLabel: "Close date", targetField: "crm_close_date", sample: (d) => d.closeDate },
  {
    sourceField: "Account.Name",
    sourceLabel: "Account name",
    targetField: "target_company_name",
    sample: (d) => d.companyName,
  },
  {
    sourceField: "Account.Website",
    sourceLabel: "Account website",
    targetField: "target_domain",
    sample: (d) => d.companyDomain,
  },
  {
    sourceField: "OpportunityContactRole/Contact.Email",
    sourceLabel: "Contact email",
    targetField: "contact_email",
    sample: (d) => d.contactEmail,
  },
  // Known standard Opportunity fields this v1 import does not use.
  { sourceField: "Type", sourceLabel: "Opportunity type", targetField: null, sample: noSample },
  { sourceField: "NextStep", sourceLabel: "Next step", targetField: null, sample: noSample },
  { sourceField: "OwnerId", sourceLabel: "Opportunity owner", targetField: null, sample: noSample },
  { sourceField: "Description", sourceLabel: "Description", targetField: null, sample: noSample },
] as const;

/**
 * Builds the field-mapping preview table. `sample`, when given, is used to
 * fill in each row's sampleValue from one real deal's detail — omitted (the
 * default), every row's sampleValue is null.
 */
export function buildFieldMappings(sample?: CrmDealDetail): readonly CrmFieldMapping[] {
  return SALESFORCE_FIELD_TABLE.map((field) => ({
    sourceField: field.sourceField,
    sourceLabel: field.sourceLabel,
    targetField: field.targetField,
    sampleValue: sample ? field.sample(sample) : null,
  }));
}

/** The fixed set of Salesforce fields this v1 import knows about but does not map — CrmImportResult.unmappedFields is always exactly this list. */
export function getUnmappedFields(): readonly CrmUnmappedField[] {
  return SALESFORCE_FIELD_TABLE.filter((field) => field.targetField === null).map((field) => ({
    sourceField: field.sourceField,
    sourceLabel: field.sourceLabel,
  }));
}
