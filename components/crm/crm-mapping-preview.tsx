import type { CrmFieldMapping } from "@/lib/crm/import-ui-types";
import "./crm-mapping-preview.css";

/**
 * Sprint 10, Ticket 54, Phase 2 — the CRM field-mapping preview. Renders
 * every entry in a readonly CrmFieldMapping[] (lib/crm/import-ui-types.ts)
 * as a table: source field, the Brava field it maps to, and a sample value.
 * PROVISIONAL / mock-seamed like its picker sibling — no API call lives
 * here, mappings arrive as a plain prop.
 *
 * A null `targetField` is an unmapped field, not a failure — surfaced with
 * a dot + "not mapped" text in the neutral/wait tone (never risk), matching
 * crm-unmapped-fields-notice.tsx's framing that going unmapped does not
 * mean the import failed. Every row renders; none are dropped or filtered.
 */
export interface CrmMappingPreviewProps {
  readonly mappings: readonly CrmFieldMapping[];
}

function CrmTargetFieldCell({ targetField }: { targetField: string | null }) {
  if (targetField === null) {
    return (
      <span className="cmp-status" data-tone="wait">
        <span className="cmp-status-dot" aria-hidden="true" />
        <span>Not mapped</span>
      </span>
    );
  }

  return <span>{targetField}</span>;
}

export function CrmMappingPreview({ mappings }: CrmMappingPreviewProps) {
  return (
    <section className="cmp-card" data-surface="crm-mapping-preview" data-testid="crm-mapping-preview">
      <div className="cmp-table-scroll">
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col">Source field</th>
              <th scope="col">Brava field</th>
              <th scope="col">Sample value</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.sourceField}>
                <td>{mapping.sourceLabel}</td>
                <td>
                  <CrmTargetFieldCell targetField={mapping.targetField} />
                </td>
                <td className="cmp-mono">{mapping.sampleValue ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
