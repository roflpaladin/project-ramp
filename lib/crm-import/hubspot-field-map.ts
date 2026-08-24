// Sprint 10, Ticket 53 — static HubSpot standard-property table driving both
// the field-mapping preview (CrmFieldMapping[]) and the unmappedFields list
// in CrmImportResult. SETTLED decision: no live HubSpot properties API call
// in v1 — this fixed table is the entire source of "what fields exist on a
// HubSpot deal/company/contact and where each one goes (or doesn't) in
// Brava". A future v2 that reads HubSpot's live properties metadata would
// replace this table's construction, not its shape.
//
// Deliberately includes entries with targetField: null (dealtype, pipeline,
// the owner, description) — known-but-unused HubSpot standard properties —
// so a seller reviewing the import sees exactly what HubSpot data exists but
// is NOT imported, rather than assuming silence means "everything came
// across". Least-data reads (this ticket's own SETTLED decision) still only
// ever FETCH the seven mapped properties below; the unmapped rows are
// documentation, not a promise this pipeline reads them.

import type { CrmDealDetail, CrmFieldMapping, CrmUnmappedField } from "./types";

interface HubSpotFieldDefinition {
  readonly sourceField: string;
  readonly sourceLabel: string;
  readonly targetField: string | null;
  readonly sample: (detail: CrmDealDetail) => string | null;
}

function noSample(): null {
  return null;
}

export const HUBSPOT_FIELD_TABLE: readonly HubSpotFieldDefinition[] = [
  { sourceField: "dealname", sourceLabel: "Deal name", targetField: "plan_title", sample: (d) => d.dealName },
  { sourceField: "amount", sourceLabel: "Amount", targetField: "crm_amount", sample: (d) => d.amount },
  { sourceField: "dealstage", sourceLabel: "Deal stage", targetField: "crm_stage", sample: (d) => d.stage },
  { sourceField: "closedate", sourceLabel: "Close date", targetField: "crm_close_date", sample: (d) => d.closeDate },
  {
    sourceField: "company.name",
    sourceLabel: "Company name",
    targetField: "target_company_name",
    sample: (d) => d.companyName,
  },
  {
    sourceField: "company.domain",
    sourceLabel: "Company domain",
    targetField: "target_domain",
    sample: (d) => d.companyDomain,
  },
  {
    sourceField: "contact.email",
    sourceLabel: "Contact email",
    targetField: "contact_email",
    sample: (d) => d.contactEmail,
  },
  // Known standard HubSpot deal properties this v1 import does not use.
  { sourceField: "dealtype", sourceLabel: "Deal type", targetField: null, sample: noSample },
  { sourceField: "pipeline", sourceLabel: "Pipeline", targetField: null, sample: noSample },
  { sourceField: "hubspot_owner_id", sourceLabel: "Deal owner", targetField: null, sample: noSample },
  { sourceField: "description", sourceLabel: "Description", targetField: null, sample: noSample },
] as const;

/**
 * Builds the field-mapping preview table. `sample`, when given, is used to
 * fill in each row's sampleValue from one real deal's detail — omitted (the
 * default), every row's sampleValue is null.
 */
export function buildFieldMappings(sample?: CrmDealDetail): readonly CrmFieldMapping[] {
  return HUBSPOT_FIELD_TABLE.map((field) => ({
    sourceField: field.sourceField,
    sourceLabel: field.sourceLabel,
    targetField: field.targetField,
    sampleValue: sample ? field.sample(sample) : null,
  }));
}

/** The fixed set of HubSpot fields this v1 import knows about but does not map — CrmImportResult.unmappedFields is always exactly this list. */
export function getUnmappedFields(): readonly CrmUnmappedField[] {
  return HUBSPOT_FIELD_TABLE.filter((field) => field.targetField === null).map((field) => ({
    sourceField: field.sourceField,
    sourceLabel: field.sourceLabel,
  }));
}
