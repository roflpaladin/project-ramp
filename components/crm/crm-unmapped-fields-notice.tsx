/**
 * Sprint 10, Ticket 54, Phase 1 — unmapped-fields notice for a CRM import
 * result. lib/crm/import-ui-types.ts's CrmImportResult.unmappedFields MUST
 * be surfaced, never dropped invisibly — that is this component's entire
 * job. Deliberately neutral wording (not framed as an error): a field going
 * unmapped does not mean the import failed, only that that one source field
 * had nowhere to land in Brava.
 */
import type { CrmUnmappedField } from "@/lib/crm-import/types";

export interface CrmUnmappedFieldsNoticeProps {
  readonly fields: readonly CrmUnmappedField[];
}

export function CrmUnmappedFieldsNotice({ fields }: CrmUnmappedFieldsNoticeProps) {
  if (fields.length === 0) return null;

  const isSingular = fields.length === 1;

  return (
    <div className="cir-unmapped" data-testid="crm-unmapped-fields-notice">
      <p className="cir-unmapped-intro">
        <span className="cir-mono">{fields.length}</span> source {isSingular ? "field" : "fields"} did not map to a
        Brava field and {isSingular ? "was" : "were"} skipped:
      </p>
      <ul className="cir-unmapped-list">
        {fields.map((field) => (
          // Human label as the visible text (contract amendment 2026-08-24);
          // raw source key survives in the title tooltip for debugging.
          <li key={field.sourceField} title={field.sourceField}>
            {field.sourceLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}
