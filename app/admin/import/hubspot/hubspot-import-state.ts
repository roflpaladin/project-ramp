// Sprint 10, Ticket 53 — HubSpot deal import. Deliberately NOT inside
// hubspot-import-actions.ts's "use server" module, for the exact reason
// app/admin/import/import-state.ts is split from import-actions.ts (that
// file's own header, repeated in short form here): a plain-object export
// from a "use server" module crashes every submit in a production build.
// The useActionState state type + its initial value, and the fixed
// error-copy constants the UI phase (T54) will match on, live here instead.

import { MAX_HUBSPOT_IMPORT_DEALS } from "@/lib/crm-import/import-limits";
import type { CrmImportResult } from "@/lib/crm-import/types";

/**
 * The state submitHubSpotImport()'s useActionState form drives. `result` is
 * set once importHubSpotDeals() ran to completion — a partial-failure batch
 * (some deals imported, some not) is DATA (CrmImportResult itself already
 * carries its own status/failures), not a distinct `error`. `error` here is
 * reserved for a failure that means no CrmImportResult was even attempted —
 * today, only "no deals selected" (a client-side-preventable state; kept as
 * a server-side backstop, same reasoning as every other action file in this
 * codebase that never trusts client-side validation alone).
 */
export interface HubSpotImportActionState {
  readonly error: string | null;
  readonly result: CrmImportResult | null;
}

export const INITIAL_HUBSPOT_IMPORT_STATE: HubSpotImportActionState = { error: null, result: null };

// Fixed, user-facing error copy — shared by both sides of the wire the same
// way app/admin/import/import-state.ts's constants are.
export const UNAUTHENTICATED_MESSAGE = "Sign in to import deals from HubSpot.";
export const MISSING_TENANT_MESSAGE =
  "Your account is missing its workspace home. Sign out and back in, then try again.";
export const NOT_CONNECTED_MESSAGE = "Connect HubSpot before importing deals.";
export const RATE_LIMITED_MESSAGE =
  "You've run several HubSpot imports in a short time. Wait a few minutes, then try again.";
export const NO_DEALS_SELECTED_MESSAGE = "Choose at least one deal to import.";
// Code review (HIGH, security): server-side batch-size cap, mirroring
// import-state.ts's FILE_TOO_LARGE_MESSAGE — a clear, cap-naming message
// rather than a bare rejection.
export const TOO_MANY_DEALS_SELECTED_MESSAGE = `You can import at most ${MAX_HUBSPOT_IMPORT_DEALS} deals at a time. Select fewer deals and try again.`;
// Code review (HIGH, code): page.tsx's initial listHubSpotDeals() load
// renders this if that promise ever rejects outright — listHubSpotDeals()
// itself should always resolve to a typed ok:false result, but this is the
// UI-side backstop so a genuinely unexpected throw never strands the page
// on "Loading…" forever.
export const LOAD_DEALS_FAILED_MESSAGE = "Could not load your HubSpot deals. Please refresh and try again.";
