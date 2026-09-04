import type { CrmImportResult } from "@/lib/crm-import/types";
import { CrmFailureDetailList } from "./crm-failure-detail-list";
import { CrmUnmappedFieldsNotice } from "./crm-unmapped-fields-notice";
import { CrmRetryReconnectRow } from "./crm-retry-reconnect-row";
import "./import-result-summary.css";

/**
 * Sprint 10, Ticket 54, Phase 1 — CRM import result summary. PROVISIONAL:
 * built entirely against mocks of lib/crm/import-ui-types.ts's
 * CrmImportResult (T53's backend CRM import pipeline is a different
 * session's lane — see that file's own header). No API call lives in this
 * component or any of its children; `onRetry` is a plain callback prop the
 * caller wires up once T53 lands.
 *
 * Composes the three outcome pieces built alongside this file:
 *   - CrmFailureDetailList — failures grouped by the closed reason set,
 *     never dropped or summarized away.
 *   - CrmUnmappedFieldsNotice — fields the mapping step couldn't place,
 *     surfaced by name, never silently.
 *   - CrmRetryReconnectRow — retry/reconnect, exactly one Signal per the
 *     ruling documented in that file's own header.
 *
 * Structurally mirrors app/admin/import/csv-import-panel.tsx's results
 * block: a single role="status" region, a dot+text status pill (status is
 * never colour-only), tokens-only styling shipping both light and dark
 * themes (import-result-summary.css).
 *
 * PROVIDER AWARENESS (Sprint 11, Ticket 56): `providerLabel` and
 * `reconnectHref` are pure pass-through props to CrmFailureDetailList and
 * CrmRetryReconnectRow — this component holds no provider-specific copy of
 * its own. Both default to the original HubSpot values, so a caller that
 * predates this ticket keeps rendering exactly as before.
 */
export interface ImportResultSummaryProps {
  readonly result: CrmImportResult;
  readonly onRetry: () => void;
  readonly providerLabel?: "HubSpot" | "Salesforce";
  readonly reconnectHref?: string;
}

function statusTone(status: CrmImportResult["status"]): "done" | "risk" {
  return status === "complete" ? "done" : "risk";
}

/**
 * Partial success is reported with explicit counts — imported, failed, and
 * total — never collapsed into a single vague summary (design brief's
 * "NEVER silent" requirement). Raw values render in Geist Mono, matching
 * this codebase's other raw-value treatment (csv-import-panel.tsx's own
 * result sentence, crm-forecast-strip.css's numeric fields).
 */
function ImportStatusMessage({ result }: { result: CrmImportResult }) {
  const { status, importedCount, failedCount, totalCount } = result;

  const importedPhrase = (
    <>
      <span className="cir-mono">{importedCount}</span> of <span className="cir-mono">{totalCount}</span> deals
      imported.
    </>
  );

  if (status === "complete") return importedPhrase;

  const failedPhrase = (
    <>
      {" "}
      <span className="cir-mono">{failedCount}</span> failed.
    </>
  );

  if (status === "partial") {
    return (
      <>
        {importedPhrase}
        {failedPhrase}
      </>
    );
  }

  return (
    <>
      Import failed. {importedPhrase}
      {failedPhrase}
    </>
  );
}

export function ImportResultSummary({
  result,
  onRetry,
  providerLabel = "HubSpot",
  reconnectHref,
}: ImportResultSummaryProps) {
  return (
    <section className="cir-card" data-surface="crm-import-result" data-testid="crm-import-result-summary">
      <div className="cir-results" role="status">
        <p className="cir-status" data-tone={statusTone(result.status)}>
          <span className="cir-status-dot" aria-hidden="true" />
          <span>
            <ImportStatusMessage result={result} />
          </span>
        </p>

        <CrmFailureDetailList failures={result.failures} providerLabel={providerLabel} />
        <CrmUnmappedFieldsNotice fields={result.unmappedFields} />
        <CrmRetryReconnectRow
          retryable={result.retryable}
          reconnectRequired={result.reconnectRequired}
          onRetry={onRetry}
          providerLabel={providerLabel}
          reconnectHref={reconnectHref}
        />
      </div>
    </section>
  );
}
