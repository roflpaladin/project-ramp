// T34-5 / T34-6 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7).
//
// Generalises B5 (§3) mechanically instead of re-fixing it one occurrence at
// a time: B5 was one specific case ("generateMetadata returns `{}`, which
// overrides nothing") of a general shape — a Next.js convention Next invokes
// on its own, independently of the page's own inline session check, that can
// touch Supabase before any session has been verified. This file re-derives,
// from the filesystem, every export in either buyer surface directory that
// fits that shape, and requires each one to be provably safe or explicitly
// recorded as an exception. A brand-new file dropped into either directory —
// the ticket's own example is `opengraph-image.tsx` — is picked up the next
// time this file runs without anyone remembering to add a line here.
//
// Audits PATHS, not serializers: this never inspects what a function
// RETURNS (that is toBuyerPayload's job and tests/security/buyer-
// boundary.spec.ts's), only whether it reaches Supabase before it reaches a
// portal-session check.
//
// Static source analysis only — reads files off disk, imports nothing,
// starts no server. Mirrors tests/security/support/route-probe.ts's
// filesystem-derived idiom (routeFileExists, listActionFiles) rather than
// inventing a second style of "derive from disk, not from memory."
//
// The extraction below is a lightweight TEXTUAL heuristic, not a real
// parser: it assumes top-level declarations start at column 0 (true of
// every file in these two directories today, and enforced by this
// codebase's formatting) and that no `export`/`function`/`const` keyword
// inside a string, comment or JSX expression is mistaken for a real
// declaration boundary (also true of these files — see the classifier unit
// tests below, which prove the MECHANISM independently of today's file
// contents, rather than only trusting that this paragraph stays accurate).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Repo-root-relative. Exactly the two directories the ticket names. */
const BUYER_SURFACE_DIRS = ["app/view/[id]", "app/portal/[id]"] as const;

// Next.js conventions that run independently of — and are not gated by — a
// page's own inline session check. `generateImageMetadata` is included
// alongside the ticket's literal list because it is the same family as
// `opengraph-image`'s default export (image-route metadata).
const NAMED_PRE_AUTH_EXPORTS = [
  "generateMetadata",
  "generateViewport",
  "generateStaticParams",
  "generateImageMetadata",
] as const;

/** Next's special image-route filenames (any of the four accepted extensions). */
function isSpecialImageFile(basename: string): boolean {
  return /^(opengraph-image|twitter-image|icon|apple-icon)(\.[a-z0-9]+)?\.(tsx?|jsx?)$/.test(basename);
}

/**
 * Files whose DEFAULT export Next invokes unconditionally, regardless of
 * which branch a page's own inline session check takes:
 *   - layout.tsx wraps every branch of the segment below it (this is
 *     literally B5's fix — the layout is the one place Next merges as the
 *     base for the whole subtree).
 *   - loading.tsx renders while the segment is suspended, before the page's
 *     own body — including its own session check — has had a chance to run.
 *   - page.tsx's own default export is not named in the ticket's literal
 *     parenthetical list, but Next invokes it unconditionally on every
 *     request exactly like layout/loading, and it is precisely where T34-6's
 *     recorded exception lives (app/view/[id]/page.tsx fetches the workspace
 *     and renders its name in the unauthenticated gate body before checking
 *     the session inline) — so it is audited here on the same basis.
 *   - the special image-route files above.
 */
function hasDefaultExportSignificance(basename: string): boolean {
  return (
    /^page\.(tsx?|jsx?)$/.test(basename) ||
    /^layout\.(tsx?|jsx?)$/.test(basename) ||
    /^loading\.(tsx?|jsx?)$/.test(basename) ||
    isSpecialImageFile(basename)
  );
}

interface PreAuthCandidate {
  readonly file: string; // repo-root-relative
  readonly exportName: string;
}

interface AllowlistEntry extends PreAuthCandidate {
  readonly reason: string;
}

/**
 * RECORDED EXCEPTIONS (T34-6). Anything resolved here is a deliberate,
 * documented decision — not an oversight. A candidate that is neither
 * provably safe (session-checked before any Supabase touch) nor listed here
 * fails resolveCandidate() below, which is what makes this list load-bearing
 * rather than decorative.
 */
const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: "app/view/[id]/page.tsx",
    exportName: "default",
    reason:
      "T34-6 (plans/sprint-6-7-replan.md §7): the unauthenticated gate " +
      "branch renders workspace.target_company_name, plus a favicon derived " +
      "from workspace.target_domain, before any portal session is verified " +
      "(getViewPayload() runs ahead of the inline verifyPortalSessionValue() " +
      "check in this file). RECORDED EXCEPTION, not a fix — the replan's " +
      "default for this open item is to record it, not remove it (removal " +
      "would be a product change, not a QA task). Rationale, verbatim from " +
      "the replan: this is 'demo-tenant-scoped, behind a gate that " +
      "announces itself as a demo' — /view/[id] is hard-scoped to " +
      "DEMO_TENANT_ID (getViewPayload's requireTenantId), so the only names " +
      "this can ever disclose are demo deal rooms, and the gate's own copy " +
      "reads 'Demo mode: any email works -- no verification code required.' " +
      "The real magic-link gate at /portal/[id] carries no equivalent " +
      "disclosure — its page.tsx default export resolves as verified-safe " +
      "below, not allowlisted, and stays that way; if a future edit makes " +
      "it fetch data ahead of its session check too, that is a NEW failure " +
      "this file should catch, not something this entry should be widened " +
      "to cover.",
  },
];

// ── Marker-based ordering classifier ────────────────────────────────────

const SESSION_CHECK_MARKER = "verifyPortalSessionValue(";

/** Calls that reach Supabase directly. Never edited to make a specific file
 *  pass — see derivedTouchMarkersFor() for how a local wrapper (e.g.
 *  app/view/[id]/page.tsx's own getViewPayload) is picked up without being
 *  named here. */
const HARD_SUPABASE_TOUCH_MARKERS = [
  "createAdminClient(",
  ".from(",
  "loadBuyerPayload(",
  "getPlanForBuyer(",
] as const;

/** Column-0 (top-level) declaration starts only — deliberately excludes
 *  anything indented, so an internal `const`/`function` inside a function
 *  body is never mistaken for the next top-level boundary. */
const TOP_LEVEL_BOUNDARY_RE = /\n(?:export\s|(?:async\s+)?function\s+\w+\s*\(|const\s+\w+\s*[:=])/;

/**
 * Returns the slice of `content` from `startIndex` up to (but excluding)
 * the next top-level declaration boundary, or to the end of the file if
 * there is none. This is what turns "the whole file" into "this one
 * function's own body" for both the exported candidates below and the
 * local-helper pre-pass.
 */
function sliceToNextTopLevelDeclaration(content: string, startIndex: number): string {
  const rest = content.slice(startIndex + 1);
  const match = TOP_LEVEL_BOUNDARY_RE.exec(rest);
  if (!match) return content.slice(startIndex);
  return content.slice(startIndex, startIndex + 1 + match.index);
}

function findDefaultExportIndex(content: string): number {
  const match = /export\s+default\b/.exec(content);
  if (!match) throw new Error("pre-auth-paths.spec.ts: default export not found in content already detected as having one");
  return match.index;
}

function findNamedExportIndex(content: string, name: string): number {
  const re = new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
  const match = re.exec(content);
  if (!match) throw new Error(`pre-auth-paths.spec.ts: export "${name}" not found in content already detected as having it`);
  return match.index;
}

function hasNamedExport(content: string, name: string): boolean {
  const re = new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
  return re.test(content);
}

interface DerivedTouchSource {
  /** The function's own name, so resolveCandidate() can exclude a
   *  candidate's self-reference (its own name trivially appears in its own
   *  declaration line, which is not a meaningful "touches Supabase" signal). */
  readonly name: string;
  readonly markers: readonly string[];
}

/**
 * Finds every top-level function declaration (exported or not) in `content`
 * and returns BOTH a call-style marker (`name(`) and a JSX-style marker
 * (`<name`) for each one whose OWN body directly contains a hard Supabase
 * touch. This is how a local wrapper — e.g. app/view/[id]/page.tsx's
 * `getViewPayload`, or app/portal/[id]/page.tsx's `GrantedPortal` — is
 * picked up as Supabase-touching for the OTHER exports in the same file,
 * without hardcoding either name here: a next engineer's differently-named
 * wrapper is derived the same way.
 */
function derivedTouchMarkersFor(content: string): DerivedTouchSource[] {
  const declRe = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  const derived: DerivedTouchSource[] = [];
  let match: RegExpExecArray | null;
  while ((match = declRe.exec(content)) !== null) {
    const name = match[1];
    const body = sliceToNextTopLevelDeclaration(content, match.index);
    if (HARD_SUPABASE_TOUCH_MARKERS.some((marker) => body.includes(marker))) {
      derived.push({ name, markers: [`${name}(`, `<${name}`] });
    }
  }
  return derived;
}

/** The local function name backing a candidate — "generateMetadata" for a
 *  named export, or the real identifier after `function` for a default
 *  export (e.g. "ViewPage", "PortalLayout"). Falls back to null for an
 *  anonymous default export, which none of today's files have. */
function localNameOf(candidate: PreAuthCandidate, content: string): string | null {
  const startIndex =
    candidate.exportName === "default"
      ? findDefaultExportIndex(content)
      : findNamedExportIndex(content, candidate.exportName);
  // The signature line is short; 200 chars comfortably covers even a
  // multi-parameter destructured signature without risking a match inside
  // the function BODY below it.
  const header = content.slice(startIndex, startIndex + 200);
  const match = /function\s+(\w+)\s*\(/.exec(header);
  return match ? match[1] : null;
}

function firstIndexOfAny(text: string, markers: readonly string[]): number {
  let earliest = -1;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index !== -1 && (earliest === -1 || index < earliest)) earliest = index;
  }
  return earliest;
}

type ResolutionStatus = "verified-safe" | "allowlisted";

interface ResolvedCandidate extends PreAuthCandidate {
  readonly status: ResolutionStatus;
}

/**
 * The FAIL/PASS mechanism the ticket asks for: a candidate is safe if it
 * never touches Supabase at all, or if the first session-check marker in
 * its own body appears before the first Supabase-touch marker. Anything
 * else must be on ALLOWLIST, or this throws — which is what makes an
 * unresolved new export a failing test rather than a silent gap.
 */
function resolveCandidate(candidate: PreAuthCandidate, content: string): ResolvedCandidate {
  const startIndex =
    candidate.exportName === "default"
      ? findDefaultExportIndex(content)
      : findNamedExportIndex(content, candidate.exportName);
  const body = sliceToNextTopLevelDeclaration(content, startIndex);

  const ownName = localNameOf(candidate, content);
  const derivedMarkers = derivedTouchMarkersFor(content)
    .filter((source) => source.name !== ownName)
    .flatMap((source) => source.markers);
  const allMarkers = [...HARD_SUPABASE_TOUCH_MARKERS, ...derivedMarkers];
  const touchIndex = firstIndexOfAny(body, allMarkers);
  const sessionIndex = body.indexOf(SESSION_CHECK_MARKER);

  const provablySafe = touchIndex === -1 || (sessionIndex !== -1 && sessionIndex < touchIndex);
  if (provablySafe) {
    return { ...candidate, status: "verified-safe" };
  }

  const allowlisted = ALLOWLIST.find((entry) => entry.file === candidate.file && entry.exportName === candidate.exportName);
  if (!allowlisted) {
    const marker = allMarkers.find((m) => body.includes(m));
    throw new Error(
      `${candidate.file} export "${candidate.exportName}" touches Supabase (via "${marker}") before verifying the ` +
        "portal session, and is not on the ALLOWLIST in tests/security/pre-auth-paths.spec.ts. Either verify the " +
        "session (verifyPortalSessionValue) before the Supabase call, or add a RECORDED EXCEPTION entry to " +
        "ALLOWLIST with a rationale — see T34-6 for the shape.",
    );
  }
  return { ...candidate, status: "allowlisted" };
}

// ── Filesystem discovery ────────────────────────────────────────────────

function discoverCandidates(relPath: string, content: string): PreAuthCandidate[] {
  const basename = path.basename(relPath);
  const candidates: PreAuthCandidate[] = [];

  if (hasDefaultExportSignificance(basename) && /export\s+default\b/.test(content)) {
    candidates.push({ file: relPath, exportName: "default" });
  }

  for (const name of NAMED_PRE_AUTH_EXPORTS) {
    if (hasNamedExport(content, name)) {
      candidates.push({ file: relPath, exportName: name });
    }
  }

  return candidates;
}

interface DiscoveredFile {
  readonly relPath: string;
  readonly content: string;
  readonly candidates: PreAuthCandidate[];
}

function discoverSurface(surfaceDir: string): DiscoveredFile[] {
  const absDir = path.join(REPO_ROOT, surfaceDir);
  const filenames = readdirSync(absDir).filter((name) => statSync(path.join(absDir, name)).isFile());

  return filenames
    .filter((name) => /\.(tsx?|jsx?)$/.test(name))
    .map((name) => {
      const relPath = path.posix.join(surfaceDir, name);
      const content = readFileSync(path.join(absDir, name), "utf8");
      return { relPath, content, candidates: discoverCandidates(relPath, content) };
    });
}

const discoveredFiles: DiscoveredFile[] = BUYER_SURFACE_DIRS.flatMap(discoverSurface);

// ── The audit itself — one test per discovered candidate ───────────────

describe("pre-auth-paths — every export Next can invoke before the gate is resolved (T34-5)", () => {
  for (const file of discoveredFiles) {
    for (const candidate of file.candidates) {
      it(`${candidate.file} — export "${candidate.exportName}" is session-verified before any Supabase call, or explicitly allowlisted`, () => {
        const resolved = resolveCandidate(candidate, file.content);
        expect(["verified-safe", "allowlisted"] satisfies ResolutionStatus[]).toContain(resolved.status);
      });
    }
  }
});

describe("pre-auth-paths — meta-tests (guard against a vacuous scan)", () => {
  it("actually discovered files under both buyer surface directories", () => {
    for (const dir of BUYER_SURFACE_DIRS) {
      expect(discoveredFiles.some((f) => f.relPath.startsWith(dir))).toBe(true);
    }
  });

  it("discovers generateMetadata on both surfaces' page.tsx (proves the named-export scan isn't vacuous)", () => {
    const candidates = discoveredFiles.flatMap((f) => f.candidates);
    expect(candidates).toContainEqual({ file: "app/view/[id]/page.tsx", exportName: "generateMetadata" });
    expect(candidates).toContainEqual({ file: "app/portal/[id]/page.tsx", exportName: "generateMetadata" });
  });

  it("discovers the page.tsx default export on both surfaces (proves the default-export scan isn't vacuous)", () => {
    const candidates = discoveredFiles.flatMap((f) => f.candidates);
    expect(candidates).toContainEqual({ file: "app/view/[id]/page.tsx", exportName: "default" });
    expect(candidates).toContainEqual({ file: "app/portal/[id]/page.tsx", exportName: "default" });
  });

  it("discovers the layout.tsx default export on both surfaces", () => {
    const candidates = discoveredFiles.flatMap((f) => f.candidates);
    expect(candidates).toContainEqual({ file: "app/view/[id]/layout.tsx", exportName: "default" });
    expect(candidates).toContainEqual({ file: "app/portal/[id]/layout.tsx", exportName: "default" });
  });

  it("resolves every ALLOWLIST entry against a candidate that was actually discovered on disk", () => {
    // Guards against a stale allowlist entry — e.g. a future rename of
    // app/view/[id]/page.tsx that leaves T34-6's exception pointing at a
    // file that no longer exists, silently discarding the record.
    const candidates = discoveredFiles.flatMap((f) => f.candidates);
    for (const entry of ALLOWLIST) {
      expect(candidates).toContainEqual({ file: entry.file, exportName: entry.exportName });
    }
  });

  it("has exactly the T34-6 exception on the allowlist — every OTHER discovered candidate resolves as verified-safe", () => {
    // The strong form of "this test fails if a new pre-auth export appears
    // that is neither verified nor allowlisted": today, that set is exactly
    // one entry. A second entry appearing here without a corresponding
    // ALLOWLIST addition means resolveCandidate() itself would have thrown
    // during collection above — this assertion additionally pins the COUNT,
    // so a silent widening of ALLOWLIST (adding an entry nobody meant to
    // need) is visible as a diff here too.
    expect(ALLOWLIST.length).toBe(1);
    expect(ALLOWLIST[0]?.file).toBe("app/view/[id]/page.tsx");
    expect(ALLOWLIST[0]?.exportName).toBe("default");
  });
});

describe("resolveCandidate — classifier unit tests (prove the FAIL/PASS mechanism itself, not just today's files)", () => {
  it("resolves as verified-safe when the session check appears before any Supabase touch", () => {
    const content = [
      "export async function generateMetadata() {",
      "  const session = verifyPortalSessionValue(id, cookie);",
      "  if (!session) return {};",
      "  const row = await createAdminClient().from(\"workspaces\").select(\"*\");",
      "  return {};",
      "}",
    ].join("\n");

    const resolved = resolveCandidate({ file: "synthetic.tsx", exportName: "generateMetadata" }, content);
    expect(resolved.status).toBe("verified-safe");
  });

  it("resolves as verified-safe when the export never touches Supabase at all", () => {
    const content = ["export default function Layout({ children }) {", "  return children;", "}"].join("\n");

    const resolved = resolveCandidate({ file: "synthetic.tsx", exportName: "default" }, content);
    expect(resolved.status).toBe("verified-safe");
  });

  it("THROWS for an unverified, unlisted Supabase touch — this is the FAIL condition T34-5 asks for", () => {
    const content = [
      "export async function generateMetadata() {",
      "  const row = await createAdminClient().from(\"workspaces\").select(\"*\");",
      "  return {};",
      "}",
    ].join("\n");

    expect(() => resolveCandidate({ file: "synthetic.tsx", exportName: "generateMetadata" }, content)).toThrow(
      /touches Supabase.*before verifying the portal session/,
    );
  });

  it("picks up a LOCAL WRAPPER's Supabase touch for a different export in the same file, without the wrapper's name being hardcoded anywhere in this file", () => {
    const content = [
      "async function fetchSomethingNewEngineerAddsHere(id) {",
      "  return createAdminClient().from(\"workspaces\").select(\"*\");",
      "}",
      "",
      "export default async function Page() {",
      "  const data = await fetchSomethingNewEngineerAddsHere(id);",
      "  return data;",
      "}",
    ].join("\n");

    expect(() => resolveCandidate({ file: "synthetic.tsx", exportName: "default" }, content)).toThrow();
  });

  it("resolves as allowlisted for the real T34-6 exception, and the rationale names the replan's stated reasoning", () => {
    const content = readFileSync(path.join(REPO_ROOT, "app/view/[id]/page.tsx"), "utf8");
    const resolved = resolveCandidate({ file: "app/view/[id]/page.tsx", exportName: "default" }, content);
    expect(resolved.status).toBe("allowlisted");

    const entry = ALLOWLIST.find((e) => e.file === resolved.file && e.exportName === resolved.exportName);
    expect(entry?.reason).toMatch(/demo-tenant-scoped/i);
    expect(entry?.reason).toMatch(/announces itself as a demo/i);
  });

  it("resolves the real /portal/[id]/page.tsx default export as verified-safe, NOT allowlisted", () => {
    // The asymmetry that matters: /portal's default export checks the
    // session before ever rendering the Supabase-touching GrantedPortal
    // component (JSX usage, not a function call — this is exactly why
    // derivedTouchMarkersFor() also emits the "<Name" form, not only
    // "Name("). If a future edit made this fetch ahead of the session
    // check too, this assertion (not the allowlist) is what would fail.
    const content = readFileSync(path.join(REPO_ROOT, "app/portal/[id]/page.tsx"), "utf8");
    const resolved = resolveCandidate({ file: "app/portal/[id]/page.tsx", exportName: "default" }, content);
    expect(resolved.status).toBe("verified-safe");
  });
});
