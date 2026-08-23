// Ticket 45 (Sprint 9), Phase 2a — CSV deal import. Deliberately NOT inside
// actions.ts's "use server" module, for the exact reason
// app/admin/onboarding/onboarding-state.ts is split from its actions file: a
// plain-object export from a "use server" module crashes every form submit in
// a production build (Next only allows async-function exports from a "use
// server" file there). The useActionState state type + its initial value, and
// the fixed error-copy constants the UI phase will match on, live here
// instead.

import type { ImportSummary } from "@/lib/import/summarize-import";

/**
 * `summary` is set only once parseCsv + validateImportRows + importDeals all
 * ran to completion — a partial-failure batch (some rows ok, some not) is
 * DATA (this shape), not an `error`. `error` is reserved for failures that
 * mean no per-row summary exists at all (auth, missing/oversized file, rate
 * limit, a structurally malformed CSV that never reached per-row validation).
 */
export interface CsvImportActionState {
  readonly error: string | null;
  readonly summary: ImportSummary | null;
}

export const INITIAL_CSV_IMPORT_STATE: CsvImportActionState = { error: null, summary: null };

// Fixed, user-facing error copy — shared by both sides of the wire the same
// way onboarding-state.ts's constants are, so a future UI phase can match on
// these exact strings rather than re-typing them.
export const UNAUTHENTICATED_MESSAGE = "Sign in to import deals from a CSV file.";
export const MISSING_TENANT_MESSAGE =
  "Your account is missing its workspace home. Sign out and back in, then try again.";
export const MISSING_FILE_MESSAGE = "Choose a CSV file to import.";
export const EMPTY_FILE_MESSAGE = "The CSV file is empty.";
export const FILE_TOO_LARGE_MESSAGE = "The CSV file is too large. Split it into smaller files and try again.";
export const RATE_LIMITED_MESSAGE =
  "You've run several imports in a short time. Wait a few minutes, then try again.";
