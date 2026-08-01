// Spins up a real Next.js production server so buyer-boundary.spec.ts can grep
// actual HTTP responses. The RSC flight-payload leak — the whole reason Ticket
// 26 exists — is invisible to a unit test that only calls toBuyerPayload
// directly; it only shows up in what the server actually sends over the wire.
//
// Runs `next start` against a real production build rather than `next dev`.
// Dev mode ships extra debug data in the RSC flight that a production build
// strips (confirmed in this project's own operating notes: "next dev page
// source can show data production strips"), so asserting "not exposed" against
// dev output would prove the wrong thing. If `.next` has not been built yet,
// this builds it first.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 250;
const SHUTDOWN_GRACE_MS = 5_000;
const PREFLIGHT_TIMEOUT_MS = 1_000;

function isBuilt(): boolean {
  return existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"));
}

function buildApp(): void {
  execFileSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

/** True if anything at all answers on the suite's port before we start ours. */
async function somethingIsListening(): Promise<boolean> {
  try {
    await fetch(`${BASE_URL}/`, { redirect: "manual", signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Server not accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`live Next.js server did not become ready within ${READY_TIMEOUT_MS}ms`);
}

export interface LiveServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Builds (if needed) and starts a production Next.js server on a fixed local
 * port, dedicated to this suite. Callers own calling `stop()` — normally from
 * an `afterAll` wrapped in try/finally so a failing assertion still tears the
 * server down.
 */
export async function startLiveServer(): Promise<LiveServer> {
  // waitUntilReady() cannot tell OUR server from a stranger's — it only knows
  // that something answered on the port. A server left behind by an earlier
  // run (or a developer's own `next start`) would therefore be adopted
  // silently, and every assertion in this gate would then be made against
  // whatever build that process is serving rather than the code under test. A
  // suite that green-lights a stale build is exactly the "green and worthless"
  // outcome Ticket 26 exists to prevent, so refuse rather than guess.
  if (await somethingIsListening()) {
    throw new Error(
      `${BASE_URL} is already serving something. This suite refuses to run against a server it did not ` +
        "start, because it cannot verify which build that server is running. Stop it and re-run.",
    );
  }

  if (!isBuilt()) {
    buildApp();
  }

  const child: ChildProcess = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "pipe",
  });

  const startupErrors: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => startupErrors.push(chunk.toString()));

  try {
    await waitUntilReady();
  } catch (error) {
    child.kill();
    throw new Error(`${(error as Error).message}\nServer stderr:\n${startupErrors.join("")}`);
  }

  return {
    baseUrl: BASE_URL,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        // Belt-and-braces: a hung child would otherwise leave the process
        // unable to exit and the whole suite hanging.
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, SHUTDOWN_GRACE_MS).unref();
      }),
  };
}
