// T36-4 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Sources
// computeEngagementSignal's `stallThresholdDays` parameter from
// configuration instead of a magic number at the call site —
// app/admin/workspaces/[id]/page.tsx used to declare a local
// `STALL_THRESHOLD_DAYS = 5` constant and pass that in directly.
//
// AC: this ticket adds ZERO new engagement math. lib/plans/engagement.ts is
// untouched — computeEngagementSignal already takes stallThresholdDays as an
// injected parameter (T31-1); only WHERE that value comes from changes.
//
// No schema/migration change: a per-tenant or per-workspace threshold would
// need a new column, which is out of this ticket's scope. A single
// deployment-level env var is the smallest change that removes the
// call-site magic number, matching this codebase's existing convention of
// sourcing configuration from process.env (see .env.example).

export const DEFAULT_STALL_THRESHOLD_DAYS = 5;

const ENV_VAR_NAME = "PLAN_STALL_THRESHOLD_DAYS";

/**
 * Reads PLAN_STALL_THRESHOLD_DAYS if set, otherwise DEFAULT_STALL_THRESHOLD_DAYS.
 * Never throws: a dashboard render must not 500 over a mistyped env var. An
 * unset or blank value is ordinary (falls back silently); a *present but
 * invalid* value (non-numeric, zero, or negative) is logged so a real
 * misconfiguration is visible server-side, then still falls back.
 *
 * `env` is injectable so this is testable without mutating the real
 * process.env of the test runner.
 */
export function getStallThresholdDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[ENV_VAR_NAME];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_STALL_THRESHOLD_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(
      `[stall-threshold] invalid ${ENV_VAR_NAME}="${raw}" — must be a positive integer; ` +
        `using default ${DEFAULT_STALL_THRESHOLD_DAYS}`,
    );
    return DEFAULT_STALL_THRESHOLD_DAYS;
  }

  return parsed;
}
