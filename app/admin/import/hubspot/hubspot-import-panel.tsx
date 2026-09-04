"use client";

// Sprint 10, Ticket 54, Phase 3 — final wiring for the HubSpot import page.
// Replaces T53's deliberately-bare page.tsx with the real presentation built
// from the T54 components (CrmDealPicker, CrmMappingPreview,
// ImportResultSummary), wired to the real server actions in
// hubspot-import-actions.ts. Structurally mirrors
// app/admin/import/csv-import-panel.tsx: page.tsx stays a thin server
// component (middleware.ts already auth-gates every /admin/** route — same
// reasoning as that file's own header), all state/wiring lives here.
//
// WIRING DECISIONS (T54 Phase 3):
//
// 1. List: listHubSpotDeals() runs once on mount via refreshDeals(), which
//    doubles as CrmDealPicker's own onRetry (re-running the same list call
//    after a list-load failure). isBusy drives CrmDealPicker's isLoading
//    prop for BOTH the initial fetch and any in-flight import (see #5).
//    Preserves T53's own HIGH review finding intact: a thrown promise from
//    listHubSpotDeals() (which should always resolve typed ok:false) still
//    resolves to the same typed failure shape via LOAD_DEALS_FAILED_MESSAGE,
//    never stranding the page on "Loading…" forever.
//
// 2. Import: CrmDealPicker's onImport(externalIds) callback calls
//    importHubSpotDeals(externalIds) DIRECTLY, not the useActionState
//    wrapper submitHubSpotImport(state, formData). Read both:
//    importHubSpotDeals() already contains every meaningful server-side
//    guard (auth, missing tenant, HubSpot connection, rate limit, the
//    MAX_HUBSPOT_IMPORT_DEALS cap) and returns them pre-shaped as a
//    CrmImportResult — the exact type ImportResultSummary renders natively.
//    submitHubSpotImport() only adds one thing on top of that: a "no deals
//    selected" guard, which returns a DIFFERENT, incompatible shape
//    (HubSpotImportActionState's { error, result }) built for a raw <form>
//    submission with no client-side precondition. That branch is provably
//    unreachable through CrmDealPicker (its own "Import" button is disabled
//    at zero selections), so nothing is lost by calling importHubSpotDeals()
//    directly — every check that matters stays entirely server-side, none
//    re-implemented here. runImport() still no-ops on an empty selection,
//    mirroring the picker's own disabled-button invariant (a defensive UI
//    nicety, not a re-implementation of server validation).
//
// 3. Result: the returned CrmImportResult renders via ImportResultSummary;
//    its onRetry re-invokes runImport() with the same externalIds. The deal
//    list is refetched only after a successful/partial import
//    (importedCount > 0) — imported deals are filtered server-side, so the
//    picker must re-fetch to reflect the new already-imported set. A fully
//    failed import (0 imported) changed nothing server-side, so it skips the
//    extra list round trip.
//
// 4. Mapping preview: hubspot-field-map.ts exports buildFieldMappings(), a
//    legitimate, already-shipped CrmFieldMapping[] source (the static
//    HubSpot standard-property table T53 ships) — mounted here as a
//    standing "what will map where" reference panel, called with no sample
//    deal (a general reference table, not tied to one selected deal; a
//    per-deal sample view is out of scope/YAGNI for this ticket).
//
// 5. Pending/disabled: isBusy is a single boolean covering "fetching the
//    deal list" AND "an import (plus its post-import refetch) is in
//    flight". CrmDealPicker exposes no separate "importing" prop, so reusing
//    isLoading is the only non-invasive way to make the picker visibly busy
//    (its Slate/wait status swaps in) and fully non-interactive (the
//    checkbox list + button unmount entirely while isLoading) without
//    editing a shared, already-tested T54 component. Flagged in the T54
//    report as a gap worth a dedicated "isImporting" affordance later.

import { useCallback, useEffect, useRef, useState } from "react";
import { CrmDealPicker } from "@/components/crm/crm-deal-picker";
import { CrmMappingPreview } from "@/components/crm/crm-mapping-preview";
import { ImportResultSummary } from "@/components/crm/import-result-summary";
import { HUBSPOT_OAUTH_START_HREF } from "@/components/crm/crm-retry-reconnect-row";
import { buildFieldMappings } from "@/lib/crm-import/hubspot-field-map";
import type { CrmDealListResult, CrmImportResult } from "@/lib/crm-import/types";
import { importHubSpotDeals, listHubSpotDeals } from "./hubspot-import-actions";
import { LOAD_DEALS_FAILED_MESSAGE } from "./hubspot-import-state";
import "./hubspot-import-panel.css";

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
 * hubspot-import-state.ts exports no generic "the import action itself
 * failed unexpectedly" message — only LOAD_DEALS_FAILED_MESSAGE covers the
 * equivalent case for the list call (a T53 gap, flagged in the T54 report
 * rather than papered over with invented copy). importHubSpotDeals() is
 * designed to always resolve a typed CrmImportResult (every guard funnels
 * through guardFailureResult/summarizeCrmImport), so this is pure
 * defense-in-depth for a genuinely unexpected throw, reusing the closest
 * existing canonical message instead of inventing new copy.
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

export function HubSpotImportPanel() {
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
      const result = await listHubSpotDeals();
      if (isMountedRef.current) setListResult(result);
    } catch {
      // Same HIGH review finding T53's own page.tsx documented (decision #1
      // above): a thrown list-load promise must still resolve to the typed
      // failure shape, never strand this page on "Loading…" forever.
      if (isMountedRef.current) setListResult(LOAD_DEALS_THROWN_RESULT);
    } finally {
      if (isMountedRef.current) setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshDeals();
  }, [refreshDeals]);

  // Re-entrancy guard (review finding, HIGH): the retry control inside
  // ImportResultSummary stays mounted and enabled while an import is in
  // flight, so without this a rapid second click starts a concurrent
  // importHubSpotDeals call whose slower, staler response would clobber the
  // fresher result. A ref (not isBusy state) so the guard is immune to
  // stale-closure reads.
  const importInFlightRef = useRef(false);

  const runImport = useCallback(
    async (externalIds: readonly string[]) => {
      // Mirrors CrmDealPicker's own disabled-at-zero invariant — a UI
      // nicety, not a re-implementation of server-side validation (decision
      // #2 above).
      if (externalIds.length === 0) return;
      if (importInFlightRef.current) return;
      importInFlightRef.current = true;

      setLastSelection(externalIds);
      setIsBusy(true);
      try {
        const result = await importHubSpotDeals(externalIds);
        if (!isMountedRef.current) return;
        setImportResult(result);

        if (result.importedCount > 0) {
          // Imported deals are filtered server-side — refetch so the picker
          // reflects the new already-imported set (decision #3).
          // refreshDeals() owns resetting isBusy back to false.
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
  // placeholder for the window before the first listHubSpotDeals() call
  // resolves.
  const pickerResult: CrmDealListResult = listResult ?? { ok: true, deals: [], alreadyImportedCount: 0 };

  return (
    <section className="hip-page" data-surface="hubspot-import-panel" data-testid="hubspot-import-panel">
      <div className="hip-header">
        <h1 className="hip-title">Import deals from HubSpot</h1>
        <p className="hip-intro">Pick deals from HubSpot to bring into Brava as workspaces.</p>
      </div>

      <CrmDealPicker
        result={pickerResult}
        isLoading={isBusy}
        onImport={runImport}
        onRetry={refreshDeals}
        providerLabel="HubSpot"
        reconnectHref={HUBSPOT_OAUTH_START_HREF}
      />

      <div className="hip-mapping">
        <h2 className="hip-section-title">Field mapping</h2>
        <CrmMappingPreview mappings={FIELD_MAPPINGS} />
      </div>

      {importResult ? (
        <ImportResultSummary
          result={importResult}
          onRetry={handleRetryImport}
          providerLabel="HubSpot"
          reconnectHref={HUBSPOT_OAUTH_START_HREF}
        />
      ) : null}
    </section>
  );
}
