// Seller-private CRM forecast read (Ticket 31, T31-2).
//
// The `import "server-only"` guard lives HERE, on the data module, not on the
// fenced-strip component that consumes it. A component file is a magnet for
// "use client" the moment someone adds an onClick; if that happens to the
// component, nothing stops it. Putting the guard on this module instead means
// that same edit fails the build loudly — because the component would still
// be importing a server-only module — rather than silently making these seven
// crm_* fields part of a client bundle.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient as createSellerClient } from "@/lib/supabase/server";

/**
 * Any Supabase client. Injectable so this read path can be tested — the
 * production client is built from next/headers cookies(), which throws
 * outside a request context — mirroring lib/plans/queries.ts's
 * PlanReadClient pattern. Production callers omit it.
 */
export type ForecastReadClient = SupabaseClient;

// Only the six crm_* forecast columns. Never select("*") — workspaces also
// carries approved_emails, internal_chat_url and other seller-private fields
// that have no business being fetched by a forecast-strip read.
const CRM_FORECAST_SELECT =
  "crm_source, crm_stage, crm_amount, crm_close_date, crm_forecast_category, crm_synced_at" as const;

/** The shape PostgREST returns for the narrow select above. */
interface RawCrmForecastRow {
  crm_source: string | null;
  crm_stage: string | null;
  crm_amount: number | string | null;
  crm_close_date: string | null;
  crm_forecast_category: string | null;
  crm_synced_at: string | null;
}

/**
 * Normalized, unformatted view of a workspace's cached CRM fields. No
 * currency or date formatting happens here — that is the FE's job (Geist
 * Mono, "as of <time>", etc.). This module returns data, not presentation.
 *
 * `source: null` is the "no CRM data" signal (crm_source IS NULL): every
 * Sprint 1/2 workspace was created manually and has never synced. The FE
 * hides the strip cleanly on that value rather than rendering empty fields.
 */
export interface CrmForecastView {
  readonly source: string | null;
  readonly stage: string | null;
  /** Raw numeric value, no currency formatting. */
  readonly amount: number | null;
  /** Postgres `date`, serialized "YYYY-MM-DD". */
  readonly closeDate: string | null;
  readonly forecastCategory: string | null;
  /** timestamptz ISO string — the staleness marker; unformatted. */
  readonly syncedAt: string | null;
}

/**
 * numeric(14,2) columns can come back from PostgREST as either a JSON number
 * or a string (precision-preserving) depending on client/driver version.
 * Normalizing here keeps the view-model's type honest without doing any
 * display formatting.
 */
function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toForecastView(raw: RawCrmForecastRow): CrmForecastView {
  return {
    source: raw.crm_source,
    stage: raw.crm_stage,
    amount: toNullableNumber(raw.crm_amount),
    closeDate: raw.crm_close_date,
    forecastCategory: raw.crm_forecast_category,
    syncedAt: raw.crm_synced_at,
  };
}

/**
 * Reads the cached CRM forecast fields for a workspace.
 *
 * RLS-scoped (seller/AE read path) — mirrors getPlanForSeller's client
 * default. Returns null when the workspace does not exist or is not visible
 * to the caller's tenant (RLS yields zero rows in that case, not an error).
 * Returns a populated CrmForecastView with source: null when the workspace
 * exists but has never synced from a CRM — the "no CRM data" case, distinct
 * from "workspace not found".
 */
export async function getCrmForecastForWorkspace(
  workspaceId: string,
  client?: ForecastReadClient,
): Promise<CrmForecastView | null> {
  const supabase = client ?? (await createSellerClient());

  const { data, error } = await supabase
    .from("workspaces")
    .select(CRM_FORECAST_SELECT)
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load CRM forecast for workspace ${workspaceId}: ${error.message}`);
  }

  if (!data) return null;

  return toForecastView(data as unknown as RawCrmForecastRow);
}
