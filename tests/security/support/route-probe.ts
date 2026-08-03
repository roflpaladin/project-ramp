// Route-existence probes for Tier 2 (sprint plan §2.1). A Tier 2 assertion is
// meaningless against a route that does not exist yet — Ticket 26 is written
// before Tickets 28 and 35 land. Checking the filesystem for the route handler
// is more reliable than an HTTP heuristic: an HTTP 404 is ambiguous (it could
// mean "route absent" or "this request correctly 404s"), but the presence of
// app/api/.../route.ts on disk is not.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** `relativePath` is repo-root-relative, e.g. "app/api/plans/[ws]/route.ts". */
export function routeFileExists(relativePath: string): boolean {
  return existsSync(path.join(REPO_ROOT, relativePath));
}

export function pendingReason(routeDescription: string, ticket: string): string {
  return `PENDING: ${routeDescription} — Ticket ${ticket}`;
}

/**
 * T28-13 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Recursively
 * lists every file under `root` (repo-root-relative, e.g. "app/admin") whose
 * basename ends in "-actions.ts" — the server-action auth coverage probe's
 * equivalent of routeFileExists() above: derived from the filesystem every
 * run, so a new action file is picked up automatically rather than requiring
 * anyone to remember to register it.
 */
export function listActionFiles(root: string): string[] {
  const absRoot = path.join(REPO_ROOT, root);
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith("-actions.ts")) {
        results.push(path.relative(REPO_ROOT, fullPath));
      }
    }
  }

  walk(absRoot);
  return results;
}
