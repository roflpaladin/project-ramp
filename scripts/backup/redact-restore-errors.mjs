// Sprint 12, Ticket 63 — weekly prod backup (.github/workflows/prod-backup.yml).
// Prints pg_restore's error lines in a form that is safe for the Actions log.
// pg_restore's stderr can quote row data, so:
//   - only the `error:` lines are kept; the DETAIL / CONTEXT / "Command was"
//     lines that follow them (which can quote whole rows) are dropped;
//   - a quoted part survives only if it looks like a Postgres identifier
//     (schema, table, role, extension name); anything else becomes [redacted];
//   - each line is capped at MAX_LINE_LENGTH characters.
//
// Usage: node scripts/backup/redact-restore-errors.mjs <errors.log>

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_LINE_LENGTH = 200;
const IDENTIFIER = /^[a-z_][a-z0-9_$.]{0,62}$/;

/** @param {string} line @returns {string} */
function redactLine(line) {
  const redacted = line.replace(/"([^"]*)"/g, (whole, inner) =>
    IDENTIFIER.test(inner) ? whole : '"[redacted]"',
  );
  return redacted.length > MAX_LINE_LENGTH ? `${redacted.slice(0, MAX_LINE_LENGTH - 1)}…` : redacted;
}

/** @param {string} log @returns {string[]} */
export function redactRestoreErrors(log) {
  return log
    .split("\n")
    .filter((line) => line.includes("error:"))
    .map(redactLine);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const line of redactRestoreErrors(readFileSync(process.argv[2], "utf8"))) {
    console.log(`  ${line}`);
  }
}
