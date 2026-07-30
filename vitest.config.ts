import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

// Local runs read .env.local. CI has no such file — the same three variables
// arrive as job-level secrets already on process.env. Guarded so a missing file
// is a no-op rather than a throw; "are the secrets actually present?" is asserted
// in tests/fixtures/env.ts, where the failure can name what is missing.
const localEnvFile = `${repoRoot}.env.local`;
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],

    // Every test here talks to a real Supabase project — a mock cannot prove an
    // RLS bypass, which is the entire point of the buyer-boundary suite. The
    // security tests additionally run DDL (adding and dropping a column) against
    // that shared database, so running files in parallel would race them against
    // each other. Serial is not a performance oversight; it is the correctness
    // requirement. CI enforces the same thing at the job level via
    // `concurrency: security-suite`.
    fileParallelism: false,

    // Network round trips to Supabase, not local computation.
    testTimeout: 30_000,
    hookTimeout: 60_000,

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx"],
      // Deliberately no threshold gate this sprint (Ticket 23 says so outright).
      // Coverage is reported to be looked at, not to fail a build on a number
      // that would only invite tests written to satisfy the number.
    },
  },

  resolve: {
    alias: {
      // Mirrors the "@/*" -> "./*" mapping in tsconfig.json, so tests import
      // application code by the same specifier the app itself uses.
      "@": repoRoot,

      // lib/portal-payload.ts is marked `import "server-only"` so it can never
      // be pulled into a client component. That package's default export throws
      // on import by design; only Next's "react-server" condition resolves it to
      // the empty module. Vitest does not set that condition, so without this
      // alias every test of the buyer boundary would die at import time. Points
      // at the package's own empty.js rather than a hand-rolled stub, so the
      // guard stays real in the app and inert only under test.
      "server-only": `${repoRoot}node_modules/server-only/empty.js`,
    },
  },
});
