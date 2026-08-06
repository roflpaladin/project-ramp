// Display formatting for the seller-private CRM/forecast strip (Ticket 31,
// T31-3). `lib/crm/forecast.ts` deliberately returns unformatted data — "this
// module returns data, not presentation" — so currency/date formatting lives
// here, on the FE side of that boundary.

const STALE_FALLBACK = "—"; // em dash, matches wsl-* fields' empty-value convention

/**
 * `crm_amount` formatted as USD currency (T31-3: "Geist Mono formatted as
 * currency" — the Geist Mono font is applied by the caller's className, this
 * only produces the string). Whole dollars only: illustrative mock deal sizes
 * don't need cent precision and it keeps the Geist Mono column skimmable.
 */
export function formatCrmAmount(amount: number | null): string {
  if (amount === null) return STALE_FALLBACK;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** `crm_close_date` (Postgres `date`, "YYYY-MM-DD") as a short human date. */
export function formatCrmCloseDate(closeDate: string | null): string {
  if (!closeDate) return STALE_FALLBACK;
  const parsed = new Date(`${closeDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return STALE_FALLBACK;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

/**
 * `crm_synced_at` rendered as "as of <time>" (T31-3) so staleness is visible
 * rather than silently wrong — a seller reading this strip should be able to
 * tell at a glance whether the mock sync happened five minutes or five weeks
 * ago. A workspace that has never synced (timestamp null, though source is
 * non-null) reads as "never synced" rather than a blank.
 */
export function formatSyncedAt(syncedAt: string | null): string {
  if (!syncedAt) return "never synced";
  const parsed = new Date(syncedAt);
  if (Number.isNaN(parsed.getTime())) return "never synced";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
