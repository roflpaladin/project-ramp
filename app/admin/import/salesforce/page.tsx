import { SalesforceImportPanel } from "./salesforce-import-panel";

// Sprint 11, Ticket 56 — kept minimal, mirroring
// app/admin/import/hubspot/page.tsx byte-for-byte (s/HubSpot/Salesforce/):
// middleware.ts already auth-gates every /admin/** route, so this server
// component has nothing to check itself — all the state (deal-list fetch,
// import wiring, refetch-after-import) lives in the client component below
// it.
export default function SalesforceImportPage() {
  return <SalesforceImportPanel />;
}
