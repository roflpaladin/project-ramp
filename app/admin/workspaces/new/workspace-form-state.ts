// Ticket 45 (Sprint 9), Phase 2b — manual workspace creation. Deliberately
// NOT inside new-workspace-actions.ts's "use server" module: a plain-object
// export from a "use server" file crashes every form submit in a production
// build (Next only allows async-function exports from a "use server" file
// there) — same reason app/admin/onboarding/onboarding-state.ts,
// app/admin/import/import-state.ts and
// app/admin/workspaces/[id]/invite-state.ts are all split from their own
// actions files.

export interface NewWorkspaceActionState {
  readonly error: string | null;
}

export const INITIAL_NEW_WORKSPACE_STATE: NewWorkspaceActionState = { error: null };

// Fixed, user-facing error copy — shared by BOTH sides of the wire
// (new-workspace-actions.ts returns these exact strings; new-workspace-form.tsx
// compares against the same constants (===) to map a message back to the
// field it describes for aria-invalid), mirroring onboarding-state.ts's
// documented rationale. Replaces the old app/admin/workspaces/new/actions.ts,
// which leaked the raw Postgres `error.message` straight into a redirect
// query string on an insert failure (that file's own doc comment flagged
// it) — every failure here is this file's own fixed copy instead.
export const MISSING_NAME_MESSAGE = "Company name is required.";
export const INVALID_DOMAIN_MESSAGE = "Enter a valid domain, e.g. acme.com.";
export const MISSING_TENANT_MESSAGE =
  "Your account is missing its workspace home. Sign out and back in, then try again.";
export const INSERT_FAILED_MESSAGE = "Couldn't create the workspace. Try again in a moment.";
