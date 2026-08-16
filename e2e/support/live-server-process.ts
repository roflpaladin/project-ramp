// Thin out-of-process wrapper around
// tests/security/support/live-server.ts's startLiveServer()/stop(), invoked
// via `npx tsx` from e2e/support/global-setup.ts.
//
// Why this indirection exists: live-server.ts computes REPO_ROOT via
// `import.meta.url`, which is valid only under real ESM. Playwright Test's
// own TS loader pre-transforms every file it loads — confirmed for BOTH a
// static `import` and a dynamic `import()` — to CommonJS, because this
// repo's root package.json has no `"type": "module"`. Both forms throw
// before any test runs (a plain SyntaxError for the static form; a Node
// "Cannot require() ES Module ... in a cycle" error for the dynamic form,
// since Playwright's loader intercepts dynamic import() too). Running this
// file as its OWN process via `npx tsx` — a real ESM-aware runtime, entirely
// outside Playwright's transform pipeline — is the mechanism this arrived at
// to reuse startLiveServer() unmodified rather than reimplementing any part
// of its build/boot/readiness/teardown logic. This wrapper contains no
// server-lifecycle logic of its own; it only calls the real functions and
// forwards readiness/shutdown across the process boundary to
// e2e/support/global-setup.ts.

import { startLiveServer } from "../../tests/security/support/live-server";

async function main() {
  // T44: forward the Next server's own output through this wrapper so
  // global-setup.ts can tee it to e2e/.logs/live-server.log — the only place
  // a prod-build server action's real stack (browser shows just a digest)
  // can be recovered from a failed run.
  process.env.LIVE_SERVER_FORWARD_OUTPUT = "1";
  const server = await startLiveServer();
  // Signals global-setup.ts (reading this process's stdout) that the real,
  // already-built Next.js server is actually accepting connections.
  process.stdout.write(`READY ${server.baseUrl}\n`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`live-server-process failed: ${message}\n`);
  process.exit(1);
});
