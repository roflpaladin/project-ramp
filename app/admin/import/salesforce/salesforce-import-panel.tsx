"use client";

// Sprint 11, Ticket 56 — final wiring for the Salesforce import page. Mirrors
// app/admin/import/hubspot/hubspot-import-panel.tsx 1:1 (s/HubSpot/Salesforce/
// where the provider name itself matters) — see that file's own header for
// the full wiring-decision rationale, restated here in short form. page.tsx
// stays a thin server component (middleware.ts already auth-gates every
// /admin/** route), all state/wiring lives here.
//
// WIRING DECISIONS (mirrors hubspot-import-panel.tsx's own, unchanged):
//
// 1. List: listSalesforceDeals() runs once on mount via refreshDeals(),
//    which doubles as CrmDealPicker's own onRetry. isBusy drives
//    CrmDealPicker's isLoading prop for both the initial fetch and any
//    in-flight import. A thrown list-load promise still resolves to the
//    same typed failure shape via LOAD_DEALS_FAILED_MESSAGE.
//
// 2. Import: CrmDealPicker's onImport(externalIds) calls
//    importSalesforceDeals(externalIds) DIRECTLY, not the useActionState
//    wrapper submitSalesforceImport(state, formData) — same reasoning as
//    hubspot-import-panel.tsx's own decision #2: every meaningful
//    server-side guard already lives inside importSalesforceDeals() and
//    returns pre-shaped as a CrmImportResult.
//
// 3. Result: the returned CrmImportResult renders via ImportResultSummary,
//    with providerLabel="Salesforce" and reconnectHref pointed at the
//    Salesforce OAuth start route (this ticket's own de-hardcoding of the
//    three shared components — see crm-deal-picker.tsx/
//    crm-retry-reconnect-row.tsx/crm-failure-detail-list.tsx). The deal
//    list is refetched only after a successful/partial import.
//
// 4. Mapping preview: salesforce-field-map.ts exports buildFieldMappings(),
//    the static Salesforce standard-field table this ticket ships —
//    mounted here the same way hubspot-import-panel.tsx mounts its own.
//
// 5. Pending/disabled: isBusy is a single boolean covering "fetching the
//    deal list" AND "an import (plus its post-import refetch) is in
//    flight" — identical reasoning to hubspot-import-panel.tsx's own #5.

import { useCallback, useEffect, useRef, useState } from "react";
import { CrmDealPicker } from "@/components/crm/crm-deal-picker";
import { CrmMappingPreview } from "@/components/crm/crm-mapping-preview";
import { ImportResultSummary } from "@/components/crm/import-result-summary";
import { buildFieldMappings } from "@/lib/crm-import/salesforce-field-map";
import type { CrmDealListResult, CrmImportResult } from "@/lib/crm-import/types";
import { importSalesforceDeals, listSalesforceDeals } from "./salesforce-import-actions";
import { LOAD_DEALS_FAILED_MESSAGE } from "./salesforce-import-state";
import "./salesforce-import-panel.css";

/** This ticket's own de-hardcoding of crm-retry-reconnect-row.tsx / crm-deal-picker.tsx — the Salesforce OAuth start route, passed explicitly (mirrors hubspot-import-panel.tsx importing HUBSPOT_OAUTH_START_HREF from the same shared module). */
const SALESFORCE_OAUTH_START_HREF = "/api/integrations/salesforce/oauth/start";
const PROVIDER_LABEL = "Salesforce" as const;

const LOAD_DEALS_THROWN_RESULT: Extract<CrmDealListResult, { readonly ok: false }> = {
  ok: false,
  reason: "unknown",
  message: LOAD_DEALS_FAILED_MESSAGE,
  reconnectRequired: false,
};

// Static reference table — see decision #4 above. Built once; this field map
// never changes at runtime.
const FIELD_MAPPINGS = buildFieldMappings();
const UNMAPPED_FIELDS = FIELD_MAPPINGS.filter((mapping) => mapping.targetField === null).map((mapping) => ({
  sourceField: mapping.sourceField,
  sourceLabel: mapping.sourceLabel,
}));

/**
 * salesforce-import-state.ts exports no generic "the import action itself
 * failed unexpectedly" message — only LOAD_DEALS_FAILED_MESSAGE covers the
 * equivalent case for the list call, same gap hubspot-import-panel.tsx's own
 * importThrownResult() documents. importSalesforceDeals() is designed to
 * always resolve a typed CrmImportResult, so this is pure defense-in-depth
 * for a genuinely unexpected throw.
 */
function importThrownResult(externalIds: readonly string[]): CrmImportResult {
  return {
    status: "failed",
    importedCount: 0,
    failedCount: externalIds.length,
    totalCount: externalIds.length,
    failures: externalIds.map((externalId) => ({
      externalId,
      reason: "unknown" as const,
      message: LOAD_DEALS_FAILED_MESSAGE,
    })),
    unmappedFields: UNMAPPED_FIELDS,
    retryable: true,
    reconnectRequired: false,
  };
}

export function SalesforceImportPanel() {
  const [listResult, setListResult] = useState<CrmDealListResult | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [importResult, setImportResult] = useState<CrmImportResult | null>(null);
  const [lastSelection, setLastSelection] = useState<readonly string[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshDeals = useCallback(async () => {
    setIsBusy(true);
    try {
      const result = await listSalesforceDeals();
      if (isMountedRef.current) setListResult(result);
    } catch {
      // Same HIGH review finding hubspot-import-panel.tsx's own refreshDeals
      // documented: a thrown list-load promise must still resolve to the
      // typed failure shape, never strand this page on "Loading…" forever.
      if (isMountedRef.current) setListResult(LOAD_DEALS_THROWN_RESULT);
    } finally {
      if (isMountedRef.current) setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshDeals();
  }, [refreshDeals]);

  // Re-entrancy guard — mirrors hubspot-import-panel.tsx's own importInFlightRef.
  const importInFlightRef = useRef(false);

  const runImport = useCallback(
    async (externalIds: readonly string[]) => {
      if (externalIds.length === 0) return;
      if (importInFlightRef.current) return;
      importInFlightRef.current = true;

      setLastSelection(externalIds);
      setIsBusy(true);
      try {
        const result = await importSalesforceDeals(externalIds);
        if (!isMountedRef.current) return;
        setImportResult(result);

        if (result.importedCount > 0) {
          // Imported deals are filtered server-side — refetch so the picker
          // reflects the new already-imported set (decision #3).
          await refreshDeals();
          return;
        }
        setIsBusy(false);
      } catch {
        if (isMountedRef.current) {
          setImportResult(importThrownResult(externalIds));
          setIsBusy(false);
        }
      } finally {
        importInFlightRef.current = false;
      }
    },
    [refreshDeals],
  );

  const handleRetryImport = useCallback(() => {
    runImport(lastSelection);
  }, [runImport, lastSelection]);

  // Ignored by CrmDealPicker whenever isLoading is true — a harmless
  // placeholder for the window before the first listSalesforceDeals() call
  // resolves.
  const pickerResult: CrmDealListResult = listResult ?? { ok: true, deals: [], alreadyImportedCount: 0 };

  return (
    <section className="sip-page" data-surface="salesforce-import-panel" data-testid="salesforce-import-panel">
      <div className="sip-header">
        <h1 className="sip-title">Import deals from Salesforce</h1>
        <p className="sip-intro">Pick Opportunities from Salesforce to bring into Brava as workspaces.</p>
      </div>

      <CrmDealPicker
        result={pickerResult}
        isLoading={isBusy}
        onImport={runImport}
        onRetry={refreshDeals}
        providerLabel={PROVIDER_LABEL}
        reconnectHref={SALESFORCE_OAUTH_START_HREF}
      />

      <div className="sip-mapping">
        <h2 className="sip-section-title">Field mapping</h2>
        <CrmMappingPreview mappings={FIELD_MAPPINGS} />
      </div>

      {importResult ? (
        <ImportResultSummary
          result={importResult}
          onRetry={handleRetryImport}
          providerLabel={PROVIDER_LABEL}
          reconnectHref={SALESFORCE_OAUTH_START_HREF}
        />
      ) : null}
    </section>
  );
}
