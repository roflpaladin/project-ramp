"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CrmDealListResult, CrmDealSummary } from "@/lib/crm/import-ui-types";
import { formatCrmAmount } from "@/app/admin/workspaces/[id]/crm-format";
import { HUBSPOT_OAUTH_START_HREF } from "./crm-retry-reconnect-row";
import "./crm-deal-picker.css";

/**
 * Sprint 10, Ticket 54, Phase 2 — the CRM deal picker. PROVISIONAL /
 * mock-seamed: T53's server actions do not exist yet, so this component
 * takes CrmDealListResult (lib/crm/import-ui-types.ts) plus callbacks as
 * props. No API call lives here.
 *
 * One Signal per decision scope (design system MUST): when deals are
 * listed, "Import N deals" is the sole Signal. When the list call failed
 * (ok: false), import isn't on offer at all, so the reconnect/retry action
 * takes over as the scope's one Signal instead (reconnect wins over retry
 * when both would apply, same ruling as crm-retry-reconnect-row.tsx).
 *
 * The "no deals" case is genuinely ambiguous from a bare empty array alone
 * (nothing in HubSpot vs. everything already imported), so the contract
 * carries `alreadyImportedCount` (amended 2026-08-24, binding) and this
 * component renders one of two calm, neutral copy states off of it — never
 * a single blended message.
 */
export interface CrmDealPickerProps {
  readonly result: CrmDealListResult;
  readonly isLoading?: boolean;
  readonly onImport: (externalIds: readonly string[]) => void;
  readonly onRetry: () => void;
}

function formatDealCount(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function CrmDealPickerLoading() {
  return (
    <p className="cdp-status" data-tone="wait" role="status">
      <span className="cdp-status-dot" aria-hidden="true" />
      <span>Loading deals from HubSpot…</span>
    </p>
  );
}

interface CrmDealPickerErrorProps {
  readonly result: Extract<CrmDealListResult, { readonly ok: false }>;
  readonly onRetry: () => void;
}

/** rate_limited reads as Slate/wait (a transient condition to wait out),
 * mirroring crm-failure-detail-list.tsx's reasoning; token_expired and
 * unknown read as risk. Reconnect (when required) is always the Signal,
 * retry only stands in as the Signal when reconnect is not required. */
function CrmDealPickerError({ result, onRetry }: CrmDealPickerErrorProps) {
  const tone = result.reason === "rate_limited" ? "wait" : "risk";

  return (
    <div data-testid="crm-deal-picker-error">
      <p className="cdp-status" data-tone={tone} role="status">
        <span className="cdp-status-dot" aria-hidden="true" />
        <span>{result.message}</span>
      </p>
      <div className="cdp-actions">
        {result.reconnectRequired ? (
          <a href={HUBSPOT_OAUTH_START_HREF} className="cdp-btn cdp-btn-primary" data-signal="true">
            Reconnect HubSpot
          </a>
        ) : (
          <button type="button" onClick={onRetry} className="cdp-btn cdp-btn-primary" data-signal="true">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Ambiguity raised with the T53 owner and since resolved (2026-08-24): a
 * bare empty deal list used to be one blended neutral message; it is now
 * two, keyed off `alreadyImportedCount`, so a seller can tell "nothing in
 * HubSpot yet" apart from "already fully imported" at a glance. Both
 * branches stay calm/neutral (not an error, not a Slate waiting state).
 */
function CrmDealPickerEmpty({ alreadyImportedCount }: { alreadyImportedCount: number }) {
  if (alreadyImportedCount > 0) {
    const noun = formatDealCount(alreadyImportedCount, "deal", "deals");
    return (
      <p className="cdp-empty" data-testid="crm-deal-picker-empty">
        All caught up — <span className="cdp-mono">{alreadyImportedCount}</span> {noun} already imported.
      </p>
    );
  }

  return (
    <p className="cdp-empty" data-testid="crm-deal-picker-empty">
      Nothing to import yet — no deals found in HubSpot.
    </p>
  );
}

interface CrmDealRowProps {
  readonly deal: CrmDealSummary;
  readonly isSelected: boolean;
  readonly onToggle: (externalId: string) => void;
}

function CrmDealRow({ deal, isSelected, onToggle }: CrmDealRowProps) {
  return (
    <li className="cdp-row">
      <label className="cdp-row-label">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(deal.externalId)}
          // Company name in the accessible name: deal names aren't unique in
          // HubSpot data, and two checkboxes announcing identically leaves a
          // screen-reader user no way to tell them apart (review finding).
          aria-label={
            deal.companyName ? `Select ${deal.name} (${deal.companyName})` : `Select ${deal.name}`
          }
        />
        <span className="cdp-name">{deal.name}</span>
      </label>
      <span className="cdp-company">{deal.companyName ?? "—"}</span>
      <span className="cdp-amount cdp-mono">{formatCrmAmount(deal.amount)}</span>
      <span className="cdp-stage">{deal.stage}</span>
    </li>
  );
}

interface CrmDealListProps {
  readonly deals: readonly CrmDealSummary[];
  readonly onImport: (externalIds: readonly string[]) => void;
}

function CrmDealList({ deals, onImport }: CrmDealListProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = deals.length > 0 && selectedIds.size === deals.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleDeal(externalId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((previous) => (previous.size === deals.length ? new Set() : new Set(deals.map((d) => d.externalId))));
  }

  const importLabel =
    selectedIds.size === 0
      ? "Import selected"
      : `Import ${selectedIds.size} ${formatDealCount(selectedIds.size, "deal", "deals")}`;

  return (
    <div className="cdp-list-wrap">
      <div className="cdp-table-scroll">
        <ul className="cdp-list">
          <li className="cdp-row cdp-row-header">
            <label className="cdp-row-label">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Select all deals"
              />
              <span>Name</span>
            </label>
            <span>Company</span>
            <span>Amount</span>
            <span>Stage</span>
          </li>
          {deals.map((deal) => (
            <CrmDealRow key={deal.externalId} deal={deal} isSelected={selectedIds.has(deal.externalId)} onToggle={toggleDeal} />
          ))}
        </ul>
      </div>
      <div className="cdp-actions">
        <button
          type="button"
          className="cdp-btn cdp-btn-primary"
          disabled={selectedIds.size === 0}
          data-signal="true"
          onClick={() => onImport(Array.from(selectedIds))}
        >
          {importLabel}
        </button>
      </div>
    </div>
  );
}

export function CrmDealPicker({ result, isLoading = false, onImport, onRetry }: CrmDealPickerProps) {
  const deals = useMemo(() => (result.ok ? result.deals : []), [result]);

  return (
    <section className="cdp-card" data-surface="crm-deal-picker" data-testid="crm-deal-picker">
      {isLoading ? <CrmDealPickerLoading /> : null}
      {!isLoading && !result.ok ? <CrmDealPickerError result={result} onRetry={onRetry} /> : null}
      {!isLoading && result.ok && deals.length === 0 ? (
        <CrmDealPickerEmpty alreadyImportedCount={result.alreadyImportedCount} />
      ) : null}
      {!isLoading && result.ok && deals.length > 0 ? <CrmDealList deals={deals} onImport={onImport} /> : null}
    </section>
  );
}
