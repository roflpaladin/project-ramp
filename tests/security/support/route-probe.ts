// Route-existence probes for Tier 2 (sprint plan §2.1). A Tier 2 assertion is
// meaningless against a route that does not exist yet — Ticket 26 is written
// before Tickets 28 and 35 land. Checking the filesystem for the route handler
// is more reliable than an HTTP heuristic: an HTTP 404 is ambiguous (it could
// mean "route absent" or "this request correctly 404s"), but the presence of
// app/api/.../route.ts on disk is not.

import { existsSync } from "node:fs";
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
