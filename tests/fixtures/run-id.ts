// Run-scoped ids for every test fixture.
//
// CI, local session A and local session B all point at ONE dev Supabase
// project. Fixtures used to carry fixed ids and fixed emails, so a second run's
// teardown deleted the first run's rows mid-test. Every id and email below now
// carries a per-run token, so a run's seed, assertions and teardown only ever
// reach its own rows.
//
// The token is minted ONCE per run by vitest.config.ts / playwright.config.ts
// (`process.env.TEST_RUN_ID ??= ...`) and inherited by every worker. It is
// never generated here: each module load would otherwise get a different value
// and a spec could no longer find the rows its fixture seeded.
//
// Legacy fixed-id fixtures are the same shape with the run token
// `0000-0000-4000` (e.g. 7e570000-0000-4000-8000-000000000002). The stale-row
// sweep (sweep-stale-fixtures.ts) relies on that to clear leftovers from before
// this change.

const RUN_ID_PATTERN = /^[0-9a-f]{11}$/;
const SUFFIX_PATTERN = /^[0-9a-f]{12}$/;

function readRunId(): string {
  const value = process.env.TEST_RUN_ID;
  if (value === undefined || value === "") {
    throw new Error("TEST_RUN_ID not set — run through vitest/playwright config");
  }
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(`TEST_RUN_ID must be 11 lowercase hex chars, got "${value}"`);
  }
  return value;
}

export const TEST_RUN_ID: string = readRunId();

/** Fixture families — each prefix owns one uuid range so the sweep can find them. */
export type RunIdPrefix = "7e57" | "7e58" | "7e59" | "7e5a";

/**
 * A uuid shaped `<prefix><run 0-4>-<run 4-8>-4<run 8-11>-8000-<suffix12>`.
 * Version nibble 4 and variant nibble 8 are kept so zod's `.uuid()` and the
 * app's own validators still accept it.
 */
export function runScopedId(prefix: RunIdPrefix, suffix12: string): string {
  if (!SUFFIX_PATTERN.test(suffix12)) {
    throw new Error(`runScopedId suffix must be 12 lowercase hex chars, got "${suffix12}"`);
  }
  const r = TEST_RUN_ID;
  return `${prefix}${r.slice(0, 4)}-${r.slice(4, 8)}-4${r.slice(8, 11)}-8000-${suffix12}`;
}

/** `local+<run>@domain` — a plus-tag keeps the address deliverable-shaped and unique per run. */
export function runScopedEmail(local: string, domain: string): string {
  return `${local}+${TEST_RUN_ID}@${domain}`;
}
