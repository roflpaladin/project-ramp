// Sprint 12, Ticket 63 — weekly prod backup (.github/workflows/prod-backup.yml).
// Compares prod's per-table row counts (taken just before the dump) with the
// counts after restoring that dump into a throwaway Postgres. Only numbers
// and table names pass through here — never row data — so the output is safe
// for the Actions log.
//
// Usage: node scripts/backup/compare-counts.mjs <prod-counts.tsv> <restored-counts.tsv>
// Each file: one `schema.table<TAB>count` line per table. Exit 1 on failure.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Writes landing between the count and the dump make small differences
// normal: the backup is not taken in the same snapshot as the counts.
const ABSOLUTE_TOLERANCE = 5;
const RELATIVE_TOLERANCE = 0.01;

/** @param {string} text @returns {Map<string, number>} */
export function parseCounts(text) {
  const counts = new Map();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const match = /^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\t(\d+)$/.exec(line.trim());
    if (!match) throw new Error(`unreadable count on line ${index + 1}`);
    counts.set(match[1], Number(match[2]));
  });
  return counts;
}

/**
 * @param {Map<string, number>} prod
 * @param {Map<string, number>} restored
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function compareCounts(prod, restored) {
  if (prod.size === 0) return { ok: false, problems: ["prod count list is empty"] };

  const problems = [];
  for (const [table, prodCount] of prod) {
    if (!restored.has(table)) {
      problems.push(`${table}: missing from the restore`);
      continue;
    }
    const restoredCount = restored.get(table);
    const tolerance = Math.max(ABSOLUTE_TOLERANCE, Math.floor(prodCount * RELATIVE_TOLERANCE));
    const isEmptyRestore = prodCount > 0 && restoredCount === 0;
    if (isEmptyRestore || Math.abs(prodCount - restoredCount) > tolerance) {
      problems.push(`${table}: restored ${restoredCount} rows, prod has ${prodCount}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function main([prodPath, restoredPath]) {
  const prod = parseCounts(readFileSync(prodPath, "utf8"));
  const restored = parseCounts(readFileSync(restoredPath, "utf8"));
  const { ok, problems } = compareCounts(prod, restored);
  for (const [table, count] of prod) {
    process.stdout.write(`${table}\tprod=${count}\trestored=${restored.get(table) ?? "missing"}\n`);
  }
  if (!ok) {
    for (const problem of problems) process.stderr.write(`RESTORE CHECK FAILED: ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(`Restore check passed: ${prod.size} tables.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
