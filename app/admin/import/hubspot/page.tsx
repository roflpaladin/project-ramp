"use client";

// Sprint 10, Ticket 53 — bare list+submit wired to the real server actions
// (hubspot-import-actions.ts). Presentation (styling, the field-mapping
// preview, the failures/unmapped-fields breakdown) is the peer T54 session's
// job — this page exists so the pipeline is exercisable end to end, kept
// minimal on purpose, same "middleware.ts already auth-gates every
// /admin/** route" reasoning as app/admin/import/page.tsx's own header.

import { useActionState, useEffect, useState } from "react";

import type { CrmDealListResult } from "@/lib/crm-import/types";
import { listHubSpotDeals, submitHubSpotImport } from "./hubspot-import-actions";
import { INITIAL_HUBSPOT_IMPORT_STATE, LOAD_DEALS_FAILED_MESSAGE } from "./hubspot-import-state";

export default function HubSpotImportPage() {
  const [listResult, setListResult] = useState<CrmDealListResult | null>(null);
  const [importState, formAction] = useActionState(submitHubSpotImport, INITIAL_HUBSPOT_IMPORT_STATE);

  useEffect(() => {
    let cancelled = false;
    listHubSpotDeals()
      .then((result) => {
        if (!cancelled) setListResult(result);
      })
      // Code review (HIGH, code): listHubSpotDeals() should always resolve
      // to a typed ok:false result rather than throw, but a thrown error
      // anywhere in the chain above it (a genuinely unexpected failure)
      // must still not strand this page on "Loading…" forever — render the
      // same failure UI an ok:false result would.
      .catch(() => {
        if (!cancelled) {
          setListResult({ ok: false, reason: "unknown", message: LOAD_DEALS_FAILED_MESSAGE, reconnectRequired: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (listResult === null) {
    return <p>Loading HubSpot deals…</p>;
  }

  if (!listResult.ok) {
    return <p role="alert">{listResult.message}</p>;
  }

  return (
    <form action={formAction}>
      <p>{listResult.alreadyImportedCount} deal(s) already imported and hidden from this list.</p>
      <ul>
        {listResult.deals.map((deal) => (
          <li key={deal.externalId}>
            <label>
              <input type="checkbox" name="externalId" value={deal.externalId} />
              {deal.name} — {deal.companyName ?? "Unknown company"} — {deal.stage}
              {deal.amount !== null ? ` — ${deal.amount}` : ""}
            </label>
          </li>
        ))}
      </ul>
      <button type="submit">Import selected deals</button>
      {importState.error ? <p role="alert">{importState.error}</p> : null}
      {importState.result ? (
        <p>
          Imported {importState.result.importedCount} of {importState.result.totalCount}.
        </p>
      ) : null}
    </form>
  );
}
