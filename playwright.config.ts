import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Ticket 29, T29-8 (QA). Local-run only per decision 10 — this config is not
// wired into any CI job. If these specs are ever promoted to CI, they get
// their OWN job, never the secret-gated `test` job that runs vitest's
// "security" project (tests/security/support/live-server.ts's own header
// comment makes the same point about that job).
//
// Mirrors vitest.config.ts's own local .env.local loading so
// tests/security/support/live-server.ts's spawned `next start` child (which
// inherits `env: process.env`) and this file's Supabase-talking specs see
// the same three variables locally that arrive as CI secrets in other jobs.
// Playwright loads this config as CommonJS (no "type": "module" in
// package.json), so import.meta.url is unavailable here — __dirname is the
// CJS-safe equivalent and this file always lives at the repo root.
const localEnvFile = path.join(__dirname, ".env.local");
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

export default defineConfig({
  testDir: "./e2e",
  // Boots the real live server exactly once for the whole run, via a
  // deliberately out-of-process wrapper — see e2e/support/global-setup.ts's
  // header comment for why startLiveServer() can't be called in-process from
  // a Playwright spec/config file directly.
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // startLiveServer() builds the app (via `npm run build`) inside a
  // beforeAll before the first test in the file runs — minutes, not
  // seconds, on a cold .next/ dir. Generous on purpose.
  timeout: 10 * 60 * 1000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
});
