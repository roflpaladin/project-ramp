import { NewWorkspaceForm } from "./new-workspace-form";

// Ticket 45 (Sprint 9), Phase 2b. Kept minimal on purpose, mirroring
// app/admin/onboarding/page.tsx: middleware.ts already auth-gates every
// /admin/** route, so this server component has nothing to check itself —
// all the state (useActionState, controlled fields) lives in the client
// component below it.
export default function NewWorkspacePage() {
  return <NewWorkspaceForm />;
}
