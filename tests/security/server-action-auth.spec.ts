// T28-13 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6). Server-action
// auth coverage, layer A. Extends the Tier 2 filesystem-derived-probe concept
// (support/route-probe.ts) from route files to action files: every exported
// function in app/admin/**/*-actions.ts must either call requireSeller() or
// sit on an explicit, reviewed ALLOWLIST entry below.
//
// This is a static coverage check, not a behavioural one — it catches
// OMISSION, the failure mode T28-9's require-seller.ts exists to standardise
// against ("First line of every mutating action"). A function that forgets
// the guard entirely produces no wrong status code to assert on; the only
// way to catch it is to look at whether the guard is there at all.
//
// The extraction below is regex-based, not an AST parse — consistent with
// this project's existing preference for pattern-based checks over a
// hand-maintained list (see buyer-boundary.spec.ts's FORBIDDEN array comment)
// and proportionate to this codebase's flat, non-nested "use server" action
// file style (confirmed by reading every file the glob currently matches).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listActionFiles } from "./support/route-probe";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ACTION_GLOB_ROOT = "app/admin";

interface AllowlistEntry {
  /** Repo-root-relative, e.g. "app/admin/workspaces/[id]/links-actions.ts". */
  readonly file: string;
  readonly functionName: string;
  /** Why this function is exempt — reviewed, not a rubber stamp. */
  readonly reason: string;
}

/**
 * Every entry here is a DELIBERATE, reviewed exception, never a place to
 * quiet a failing probe. Deliberately empty: nothing found so far earns an
 * exemption from requireSeller() — see this file's own test run for what
 * that means about the files it currently covers.
 */
const ALLOWLIST: readonly AllowlistEntry[] = [];

interface ExportedFunction {
  readonly name: string;
  readonly body: string;
}

/**
 * Splits a "use server" action file into its top-level exported functions,
 * by regex position rather than a full parse. Each function's "body" runs
 * from its own `export ... function NAME` line to the START of the next
 * export (or EOF) — deliberately generous (it can absorb trailing comments)
 * rather than deliberately narrow, because a false NEGATIVE here (missing a
 * real requireSeller() call) is the failure mode this file exists to avoid;
 * a false positive from an unrelated comment mentioning "requireSeller(" is
 * not a realistic risk in this codebase's actual file contents.
 */
function extractExportedFunctions(source: string): ExportedFunction[] {
  const declarationPattern = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
  const constPattern = /^export\s+const\s+(\w+)\s*[:=]/gm;

  const matches: { name: string; index: number }[] = [];
  for (const pattern of [declarationPattern, constPattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      matches.push({ name: match[1], index: match.index });
    }
  }
  matches.sort((a, b) => a.index - b.index);

  return matches.map((entry, position) => {
    const end = position + 1 < matches.length ? matches[position + 1].index : source.length;
    return { name: entry.name, body: source.slice(entry.index, end) };
  });
}

function findAllowlistEntry(file: string, functionName: string): AllowlistEntry | undefined {
  return ALLOWLIST.find((entry) => entry.file === file && entry.functionName === functionName);
}

describe("server-action auth coverage — app/admin/**/*-actions.ts (T28-13)", () => {
  const actionFiles = listActionFiles(ACTION_GLOB_ROOT);

  it("finds every action file this probe is meant to cover", () => {
    // Re-derived from the filesystem, not hardcoded — a regression here means
    // the glob itself broke, not that the file list changed. Names the two
    // files known to exist at the time this probe was written so a silent
    // "found zero files" is caught rather than passing vacuously.
    expect(actionFiles).toContain("app/admin/workspaces/[id]/plan/plan-actions.ts");
    expect(actionFiles).toContain("app/admin/workspaces/[id]/links-actions.ts");
  });

  it("registers no manual enable/disable override that could desync the allowlist from its own reasons", () => {
    // Mirrors buyer-boundary.spec.ts's Tier 2 meta-test: the allowlist is the
    // ONLY sanctioned bypass, and every entry on it must carry a reason —
    // there is no separate "skip" flag anyone could add instead.
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  for (const file of actionFiles) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    const functions = extractExportedFunctions(source);

    describe(file, () => {
      it("exports at least one function for this probe to check", () => {
        // Guards against the regex silently matching nothing (e.g. the file's
        // export style changes) and every per-function check below vacuously
        // never running.
        expect(functions.length).toBeGreaterThan(0);
      });

      for (const fn of functions) {
        it(`${fn.name} calls requireSeller() or sits on a reviewed allowlist entry`, () => {
          const callsRequireSeller = /requireSeller\s*\(/.test(fn.body);
          const allowlisted = findAllowlistEntry(file, fn.name);

          if (!callsRequireSeller && !allowlisted) {
            throw new Error(
              `${file}::${fn.name} calls neither requireSeller() nor sits on an explicit ALLOWLIST ` +
                "entry in tests/security/server-action-auth.spec.ts. Either add the requireSeller() " +
                "guard (T28-9) as the function's first line, or add a reviewed allowlist entry that " +
                "states why this function is exempt.",
            );
          }

          expect(callsRequireSeller || Boolean(allowlisted)).toBe(true);
        });
      }
    });
  }
});
