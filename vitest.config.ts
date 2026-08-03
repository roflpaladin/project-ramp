import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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

// Shared by every project — "@/*" mirrors the tsconfig.json path mapping, and
// server-only's empty.js keeps `import "server-only"`-gated modules importable
// under test (see the security project's own note below).
const sharedAlias = {
  "@": repoRoot,
  "server-only": `${repoRoot}node_modules/server-only/empty.js`,
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx"],
      // Deliberately no threshold gate this sprint (Ticket 23 says so outright).
      // Coverage is reported to be looked at, not to fail a build on a number
      // that would only invite tests written to satisfy the number.
    },

    // Two projects (Ticket 29, T29-7). "security" below is byte-for-byte the
    // pre-Ticket-29 root config that used to live directly under `test` here
    // (same include, same node env, same fileParallelism:false, same
    // resolve.alias) — only relocated under `projects` so a second,
    // happy-dom project can run component-level DOM assertions without
    // altering this one's semantics (real Supabase DDL, serial execution)
    // in any way.
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: "security",
          environment: "node",
          include: ["tests/**/*.spec.ts"],

          // Every test here talks to a real Supabase project — a mock cannot
          // prove an RLS bypass, which is the entire point of the buyer-
          // boundary suite. The security tests additionally run DDL (adding
          // and dropping a column) against that shared database, so running
          // files in parallel would race them against each other. Serial is
          // not a performance oversight; it is the correctness requirement.
          // CI enforces the same thing at the job level via
          // `concurrency: security-suite`.
          fileParallelism: false,

          // Network round trips to Supabase, not local computation.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // tsconfig.json sets "jsx": "preserve" for Next's own SWC pipeline —
        // left as-is, so plain esbuild/oxc leave JSX untransformed here,
        // which Node can't execute. @vitejs/plugin-react gives this project
        // (only) a real JSX transform, the same fix Vitest's own docs use
        // for testing React components.
        plugins: [react()],
        resolve: { alias: sharedAlias },
        test: {
          name: "components",
          environment: "happy-dom",
          // .dom.spec.tsx (not .spec.ts) so this glob can never capture a
          // tests/**/*.spec.ts security/plan file even by accident — every
          // file the "security" project owns ends in plain .spec.ts, and a
          // JSX component test needs the .tsx extension anyway.
          include: ["tests/components/**/*.dom.spec.tsx"],
          setupFiles: ["./tests/components/setup.ts"],
        },
      },
    ],
  },
});
