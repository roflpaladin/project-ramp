import { CsvImportPanel } from "./csv-import-panel";

// Ticket 45 (Sprint 9), Phase 2b — kept minimal, mirroring
// app/admin/onboarding/page.tsx: middleware.ts already auth-gates every
// /admin/** route, so this server component has nothing to check itself —
// all the state (useActionState, client-side size precheck) lives in the
// client component below it.
export default function ImportPage() {
  return <CsvImportPanel />;
}
