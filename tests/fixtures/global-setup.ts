// Vitest globalSetup for the "security" project: once per run, before any spec,
// sweep fixture rows that crashed runs left in the shared dev database (see
// sweep-stale-fixtures.ts). Runs in the main vitest process, after
// vitest.config.ts has loaded .env.local. Skips itself, with one printed line,
// when Supabase credentials are absent or SKIP_FIXTURE_SWEEP=1.

import { sweepStaleFixturesFromEnv } from "./sweep-stale-fixtures";

export default async function globalSetup(): Promise<void> {
  await sweepStaleFixturesFromEnv();
}
