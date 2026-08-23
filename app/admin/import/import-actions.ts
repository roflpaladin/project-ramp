"use server";

// Ticket 45 (Sprint 9), Phase 2a — CSV deal import server action. Wires
// lib/import/parse-csv.ts -> validate-rows.ts -> import-deals.ts ->
// summarize-import.ts behind one useActionState-shaped action, the same
// composition order QA/UI (a later phase) will drive from a
// `<form action={...}>`. NO UI in this phase — app/admin/onboarding/*.tsx is
// untouched.
//
// Named import-actions.ts, not actions.ts (code review, Phase 2a): the
// server-action auth coverage probe (tests/security/support/route-probe.ts's
// listActionFiles) only walks files whose basename ends in "-actions.ts" —
// mirrors every other action file in app/admin/** (plan-actions.ts,
// links-actions.ts, onboarding-actions.ts, invite-actions.ts). A plain
// actions.ts would silently sit outside that probe's coverage.
//
// Order of operations mirrors app/admin/onboarding/onboarding-actions.ts
// exactly: requireSeller() first, then field-level/cheap validation, then
// checkRateLimit (after cheap checks so a malformed/missing upload never
// burns budget, before any parse/write work), then the actual work.
//
// UNAUTHENTICATED is a returned error state here, not a redirect — unlike
// onboarding-actions.ts's two actions (which redirect to /admin/login on a
// null session). Deliberate: CSV import is called from an authenticated
// admin surface via useActionState, not a public entry point a signed-out
// visitor could land on mid-flow, and the ticket's own AC frames this case
// as "unauthenticated -> UNAUTHENTICATED" (a state, not a navigation side
// effect) for the test to assert against directly.
//
// Never surfaces raw Postgres/Supabase/CSV-internals text: requireSeller's
// null case and the size/rate-limit checks below use this file's own fixed
// copy (./import-state.ts); parse failures surface parseCsv's own `message`,
// which is already app-authored per lib/import/errors.ts's contract; and
// per-row DB failures arrive from lib/import/import-deals.ts already mapped
// through lib/plans/errors.ts's mapPostgrestError discipline. A partial-
// failure batch (some rows ok, some not) is returned as `summary` — DATA, not
// an `error` — per the ticket's explicit "never silently drop failed rows"
// requirement.

import { MAX_CSV_BYTES } from "@/lib/import/csv-limits";
import { importDeals } from "@/lib/import/import-deals";
import { parseCsv } from "@/lib/import/parse-csv";
import { summarizeImport } from "@/lib/import/summarize-import";
import { validateImportRows } from "@/lib/import/validate-rows";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CSV_IMPORT_RATE_LIMIT } from "@/lib/rate-limit";
import {
  EMPTY_FILE_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  MISSING_FILE_MESSAGE,
  MISSING_TENANT_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  type CsvImportActionState,
} from "./import-state";

// MAX_CSV_BYTES is 512KB (lib/import/csv-limits.ts) — deliberately well under
// Next's default 1MB server-action request body limit, so a legitimate
// upload at the CSV cap still leaves headroom for the rest of the
// multipart/form-data envelope around it. Do NOT raise that platform limit
// via a next.config `serverActions.bodySizeLimit` override to "fit" a larger
// CSV — the cap stays under the platform limit by construction; grow
// MAX_CSV_BYTES only with a matching review of that headroom.

export async function importDealsFromCsv(
  _previousState: CsvImportActionState,
  formData: FormData,
): Promise<CsvImportActionState> {
  const seller = await requireSeller();
  if (!seller) {
    return { error: UNAUTHENTICATED_MESSAGE, summary: null };
  }
  if (!seller.tenantId) {
    return { error: MISSING_TENANT_MESSAGE, summary: null };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: MISSING_FILE_MESSAGE, summary: null };
  }
  if (file.size === 0) {
    return { error: EMPTY_FILE_MESSAGE, summary: null };
  }
  // Checked against File.size BEFORE arrayBuffer() below, so an oversized
  // upload is never read into memory at all.
  if (file.size > MAX_CSV_BYTES) {
    return { error: FILE_TOO_LARGE_MESSAGE, summary: null };
  }

  // Placed after the cheap checks above (a missing/empty/oversized upload
  // never burns budget) and before any parse/write work — same placement
  // onboarding-actions.ts uses for ONBOARDING_RATE_LIMIT. Stricter budget
  // than onboarding's (lib/rate-limit.ts's CSV_IMPORT_RATE_LIMIT comment):
  // one call here can write up to MAX_CSV_ROWS workspace+plan pairs.
  const limit = checkRateLimit(
    `csv-import:${seller.userId}`,
    CSV_IMPORT_RATE_LIMIT.limit,
    CSV_IMPORT_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMITED_MESSAGE, summary: null };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parseResult = parseCsv(buffer);
  if (!parseResult.ok) {
    return { error: parseResult.message, summary: null };
  }

  const validationResults = validateImportRows(parseResult.rows);
  const writeResults = await importDeals(
    validationResults,
    { tenantId: seller.tenantId, userId: seller.userId },
    seller.client,
  );

  return { error: null, summary: summarizeImport(writeResults) };
}
