import { HubSpotImportPanel } from "./hubspot-import-panel";

// Sprint 10, Ticket 54, Phase 3 — kept minimal, mirroring
// app/admin/import/page.tsx (which itself mirrors app/admin/onboarding/
// page.tsx): middleware.ts already auth-gates every /admin/** route, so
// this server component has nothing to check itself — all the state
// (deal-list fetch, import wiring, refetch-after-import) lives in the
// client component below it. Replaces T53's deliberately-bare page.tsx now
// that the T54 presentation components are wired to the real server
// actions — see hubspot-import-panel.tsx's own header for the wiring
// decisions.
export default function HubSpotImportPage() {
  return <HubSpotImportPanel />;
}
