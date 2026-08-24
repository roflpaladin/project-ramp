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
// Sprint 10, Ticket 52: widened from "app/admin" alone to also cover
// "app/settings" — the new HubSpot disconnect action
// (app/settings/integrations/hubspot-actions.ts) lives there, and a probe
// that only ever looked at app/admin would never have caught it (or any
// future app/settings/**/*-actions.ts file) missing its requireSeller()
// guard.
const ACTION_GLOB_ROOTS = ["app/admin", "app/settings"] as const;

interface AllowlistEntry {
  /** Repo-root-relative, e.g. "app/admin/workspaces/[id]/links-actions.ts". */
  readonly file: string;
  readonly functionName: string;
  /** Why this function is exempt — reviewed, not a rubber stamp. */
  readonly reason: string;
}

/**
 * Every entry here is a DELIBERATE, reviewed exception, never a place to
 * quiet a failing probe.
 */
const ALLOWLIST: readonly AllowlistEntry[] = [
  // The former INITIAL_SEND_INVITE_STATE entry is gone: the constant moved
  // to invite-state.ts (T44 finding — a "use server" file may only export
  // async functions; the object export crashed every invite submit on
  // production builds). An action file needing a data-constant exemption
  // here is now a signal the constant is in the wrong file.

  // 2026-08-24 (Sprint 10, Ticket 52 — widening this probe to app/settings
  // surfaced this pre-existing gap; not otherwise touched by this ticket).
  // saveTriggerStage predates require-seller.ts's extraction (T28-9) and
  // still uses the inline equivalent that comment itself names as this
  // file's own established pattern ("mirrors app/admin/workspaces/new/
  // actions.ts and app/settings/integrations/actions.ts already use inline
  // (createClient -> auth.getUser() -> bail if absent)"): createClient(),
  // auth.getUser(), and an explicit `if (!user) redirect("/admin/login")`
  // bail-out, immediately as its first two statements. Functionally
  // equivalent auth coverage to requireSeller() — allowlisted rather than
  // refactored to keep this ticket's diff to what it actually needs to
  // touch; a real refactor to requireSeller() is a fine, low-risk follow-up
  // but is out of scope here.
  {
    file: "app/settings/integrations/actions.ts",
    functionName: "saveTriggerStage",
    reason:
      "Pre-existing inline auth.getUser() + redirect guard (predates requireSeller()'s T28-9 extraction) — " +
      "functionally equivalent coverage, not an omission. See dated comment above.",
  },
];

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

describe("server-action auth coverage — app/admin/**/*-actions.ts + app/settings/**/*-actions.ts (T28-13, widened T52)", () => {
  // Flattened, de-duplicated across both roots — a file glob-matched by
  // both would otherwise get double describe/it blocks below.
  const actionFiles = Array.from(new Set(ACTION_GLOB_ROOTS.flatMap((root) => listActionFiles(root))));

  it("finds every action file this probe is meant to cover", () => {
    // Re-derived from the filesystem, not hardcoded — a regression here means
    // the glob itself broke, not that the file list changed. Names files
    // known to exist at the time this probe (T28-13) and its T52 widening
    // were written so a silent "found zero files" is caught rather than
    // passing vacuously.
    expect(actionFiles).toContain("app/admin/workspaces/[id]/plan/plan-actions.ts");
    expect(actionFiles).toContain("app/admin/workspaces/[id]/links-actions.ts");
    expect(actionFiles).toContain("app/settings/integrations/hubspot-actions.ts");
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
