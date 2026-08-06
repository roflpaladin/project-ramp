// T31-7 (Sprint 6, Ticket 31; plans/sprint-6-7-replan.md §6). Transitive
// static import-graph walker.
//
// WHY THIS EXISTS: `lib/crm/forecast.ts` carries `import "server-only"`
// (T31-2), which fails the *build* the moment a CLIENT bundle imports it. But
// `app/portal/[id]/page.tsx` and `app/view/[id]/page.tsx` are React SERVER
// components — `server-only` does nothing to stop a server component
// importing a server-only module; that import compiles and runs fine, and
// would quietly ship the six cached `crm_*` fields (plus the seller-private
// `internal_chat_url` reveal) into a buyer's RSC render tree. A STATIC
// IMPORT-GRAPH CHECK is the only thing that actually guards this boundary, so
// that is what this module builds: given a set of entry files, which repo
// source files do they transitively pull in via `import`/`export ... from`/
// dynamic `import()`?
//
// Regex-based extraction, not an AST parse — consistent with this project's
// existing preference (see tests/security/server-action-auth.spec.ts's own
// comment on this tradeoff) and proportionate to a static, additive-only
// safety net: a false NEGATIVE (missing a real import) is the failure mode
// that matters, and every resolution step is exercised by
// tests/security/import-graph-walker.spec.ts's synthetic fixtures before the
// real repo-wide assertion in crm-import-boundary.spec.ts is trusted.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The two filesystem operations the walker needs. Injectable so the walker's
 * resolution/traversal logic can be proven correct against a small synthetic
 * in-memory file tree — no real files, no temp directories — mirroring this
 * codebase's existing "injectable client" testability pattern (e.g.
 * lib/crm/forecast.ts's `ForecastReadClient`, lib/plans/queries.ts's
 * `PlanReadClient`). Production callers omit this and get the real fs.
 */
export interface ImportGraphFs {
  /** True only for an actual resolvable file at this exact absolute path. */
  fileExists(absPath: string): boolean;
  /** Reads the file's source text. Only ever called after fileExists() is true. */
  readFile(absPath: string): string;
}

const REAL_FS: ImportGraphFs = {
  fileExists(absPath) {
    return existsSync(absPath) && statSync(absPath).isFile();
  },
  readFile(absPath) {
    return readFileSync(absPath, "utf8");
  },
};

/**
 * Extracts every statically-visible module specifier from a TS/TSX source
 * string: `import ... from "x"`, `export ... from "x"` (covers both value and
 * `type` variants — a type-only import still means "this file is coupled to
 * that module" for boundary purposes, and is the stricter, safer reading),
 * bare side-effect imports (`import "./x.css"`), dynamic `import("x")`, and
 * `require("x")` (defensive; this codebase is ESM throughout).
 *
 * Four separate patterns rather than one combined regex, matching the
 * multi-pattern-then-merge style already used in
 * tests/security/server-action-auth.spec.ts's extractExportedFunctions.
 */
export function extractImportSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g, // import/export ... from "x" (incl. `type`)
    /\bimport\s+["']([^"']+)["']/g, // bare side-effect import "x"
    /\bimport\(\s*["']([^"']+)["']/g, // dynamic import("x")
    /\brequire\(\s*["']([^"']+)["']/g, // require("x")
  ];

  const specifiers: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/**
 * Resolves a module specifier found in `fromFile` to an absolute repo file
 * path, or `null` if it is an external package (no leading "." and no "@/"
 * alias) or cannot be resolved to any file this walker can see. `repoRoot`
 * anchors the "@/*" alias exactly as tsconfig.json's `paths` maps it.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  repoRoot: string,
  fs: ImportGraphFs = REAL_FS,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(repoRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.join(path.dirname(fromFile), specifier);
  } else {
    return null; // external package — react, next/*, server-only, @supabase/*, etc.
  }

  const candidates = [
    base,
    ...RESOLVABLE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVABLE_EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
  ];

  for (const candidate of candidates) {
    if (fs.fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Breadth-first traversal from `rootFiles`, returning the full set of repo
 * source files reachable by transitively following every resolvable import.
 * The returned set INCLUDES the root files themselves.
 */
export function buildTransitiveImportClosure(
  rootFiles: readonly string[],
  repoRoot: string,
  fs: ImportGraphFs = REAL_FS,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [...rootFiles];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    if (!fs.fileExists(file)) continue;
    visited.add(file);

    const source = fs.readFile(file);
    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, specifier, repoRoot, fs);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

/**
 * Recursively lists every .ts/.tsx file under `root` (repo-root-relative,
 * e.g. "app/portal"). Mirrors tests/security/support/route-probe.ts's
 * listActionFiles walk — derived from the filesystem every run, so a new
 * buyer-surface file is picked up automatically as an entry point rather
 * than requiring anyone to remember to register it.
 */
export function listSourceFiles(root: string, repoRoot: string): string[] {
  const absRoot = path.join(repoRoot, root);
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        results.push(fullPath);
      }
    }
  }

  walk(absRoot);
  return results;
}
