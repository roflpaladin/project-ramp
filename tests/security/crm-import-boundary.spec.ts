// T31-7 (Sprint 6, Ticket 31; plans/sprint-6-7-replan.md §6, §10 "31").
// Import-graph boundary test: no file under app/portal/** or app/view/**
// transitively imports the seller-private CRM strip component
// (app/admin/workspaces/[id]/crm-forecast-strip.tsx) or the seller-private
// forecast data module (lib/crm/forecast.ts).
//
// WHY THIS TEST, NOT A `server-only` BUILD-ERROR CLAIM: lib/crm/forecast.ts
// carries `import "server-only"` (T31-2), which fails the build the moment a
// CLIENT bundle imports it. But app/portal/[id]/page.tsx and
// app/view/[id]/page.tsx are React SERVER components — `server-only` does
// nothing to stop a server component importing a server-only module; that
// import compiles and runs fine, and would quietly ship all six cached
// crm_* fields (plus the seller-private internal_chat_url reveal control,
// T31-6) into a buyer's RSC render tree. Since both buyer routes are server
// components, "the build fails if a buyer surface imports this" is FALSE —
// this static import-graph check is the real guard for that claim.
//
// No pre-existing import-graph helper was found in tests/ (grepped for
// transitive/import-graph/importGraph/parseImports/walkImports/
// buildImportGraph before writing tests/security/support/import-graph.ts).
// That walker's own correctness — including that it follows imports
// TRANSITIVELY, not just one hop — is proven by the synthetic fixtures in
// tests/security/import-graph-walker.spec.ts before this file's real
// repo-wide assertion is trusted.

import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTransitiveImportClosure, listSourceFiles } from "./support/import-graph";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const FORBIDDEN_MODULES: readonly { readonly label: string; readonly absPath: string }[] = [
  {
    label: "lib/crm/forecast.ts (seller-private forecast data module)",
    absPath: path.join(REPO_ROOT, "lib/crm/forecast.ts"),
  },
  {
    label: "app/admin/workspaces/[id]/crm-forecast-strip.tsx (seller-private CRM strip component)",
    absPath: path.join(REPO_ROOT, "app/admin/workspaces/[id]/crm-forecast-strip.tsx"),
  },
];

describe("buyer surfaces never import the seller-private CRM/forecast module (T31-7)", () => {
  const buyerRoots = [...listSourceFiles("app/portal", REPO_ROOT), ...listSourceFiles("app/view", REPO_ROOT)];

  it("finds the buyer surface entry files this probe is meant to cover", () => {
    // Derived from the filesystem, not hardcoded — a regression here would
    // mean the walk itself broke (e.g. a renamed directory), not that the
    // file list changed. Named so a silent "found zero files" cannot pass
    // the forbidden-module assertions below vacuously.
    const relative = buyerRoots.map((f) => path.relative(REPO_ROOT, f));
    expect(relative).toContain(path.join("app", "portal", "[id]", "page.tsx"));
    expect(relative).toContain(path.join("app", "view", "[id]", "page.tsx"));
    expect(buyerRoots.length).toBeGreaterThan(0);
  });

  const closure = buildTransitiveImportClosure(buyerRoots, REPO_ROOT);

  it.each(FORBIDDEN_MODULES)("does not transitively import $label", ({ absPath }) => {
    expect(closure.has(absPath)).toBe(false);
  });

  it("confirms real forbidden-module files exist on disk (so the assertion above is not vacuous)", () => {
    // If these files were ever renamed without updating this test, the
    // "does not transitively import" assertions above would trivially pass
    // for the wrong reason (a path that resolves to nothing can never be in
    // anyone's import closure). This guards against that.
    for (const { absPath } of FORBIDDEN_MODULES) {
      expect(buildTransitiveImportClosure([absPath], REPO_ROOT).has(absPath)).toBe(true);
    }
  });
});
