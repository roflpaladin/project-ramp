// Sprint 11, Ticket 56 — Salesforce Opportunity import. Deliberately NOT
// inside salesforce-import-actions.ts's "use server" module, for the exact
// reason app/admin/import/hubspot/hubspot-import-state.ts is split from its
// own actions file (that file's own header, repeated in short form here): a
// plain-object export from a "use server" module crashes every submit in a
// production build. The useActionState state type + its initial value, and
// the fixed error-copy constants a later UI phase builds against, live here
// instead.

import { MAX_CRM_IMPORT_DEALS } from "@/lib/crm-import/import-limits";
import type { CrmImportResult } from "@/lib/crm-import/types";

/**
 * The state submitSalesforceImport()'s useActionState form drives. Mirrors
 * app/admin/import/hubspot/hubspot-import-state.ts's HubSpotImportActionState
 * shape byte-for-byte — see that file's own header for the full reasoning
 * behind `result` vs `error`.
 */
export interface SalesforceImportActionState {
  readonly error: string | null;
  readonly result: CrmImportResult | null;
}

export const INITIAL_SALESFORCE_IMPORT_STATE: SalesforceImportActionState = { error: null, result: null };

// Fixed, user-facing error copy — same wording pattern as
// hubspot-import-state.ts's own constants, s/HubSpot/Salesforce/ where the
// provider name itself matters.
export const UNAUTHENTICATED_MESSAGE = "Sign in to import deals from Salesforce.";
export const MISSING_TENANT_MESSAGE =
  "Your account is missing its workspace home. Sign out and back in, then try again.";
export const NOT_CONNECTED_MESSAGE = "Connect Salesforce before importing deals.";
export const RATE_LIMITED_MESSAGE =
  "You've run several Salesforce imports in a short time. Wait a few minutes, then try again.";
export const NO_DEALS_SELECTED_MESSAGE = "Choose at least one deal to import.";
export const TOO_MANY_DEALS_SELECTED_MESSAGE = `You can import at most ${MAX_CRM_IMPORT_DEALS} deals at a time. Select fewer deals and try again.`;
export const LOAD_DEALS_FAILED_MESSAGE = "Could not load your Salesforce deals. Please refresh and try again.";
