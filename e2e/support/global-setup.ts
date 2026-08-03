// Playwright globalSetup: boots the real live server exactly once for the
// whole run, via e2e/support/live-server-process.ts's out-of-process
// wrapper (see that file's header comment for why the out-of-process
// indirection exists). Returns the teardown closure Playwright calls once
// after every spec file has finished — this is the ONLY place this suite's
// server process is spawned or killed.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.join(__dirname, "..", "..");
const READY_TIMEOUT_MS = 5 * 60 * 1000; // startLiveServer() builds the app first — minutes, not seconds.
const SHUTDOWN_GRACE_MS = 5_000;

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== "number") return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH (group already exited) or similar — nothing left to signal.
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const child = spawn("npx", ["tsx", "e2e/support/live-server-process.ts"], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const output: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `live-server-process did not report READY within ${READY_TIMEOUT_MS}ms.\nOutput so far:\n${output.join("")}`,
        ),
      );
    }, READY_TIMEOUT_MS);

    function onData(chunk: Buffer): void {
      if (chunk.toString().includes("READY")) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        resolve();
      }
    }
    child.stdout?.on("data", onData);

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`live-server-process exited before READY (code=${code}, signal=${signal}).\nOutput:\n${output.join("")}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return async () => {
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      killProcessGroup(child, "SIGTERM");
      setTimeout(() => {
        killProcessGroup(child, "SIGKILL");
        resolve();
      }, SHUTDOWN_GRACE_MS).unref();
    });
  };
}
