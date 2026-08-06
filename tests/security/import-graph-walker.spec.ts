// Positive control for tests/security/support/import-graph.ts, exercised
// before crm-import-boundary.spec.ts's real repo-wide assertion is trusted —
// mirrors this project's established "prove the probe can fail" convention
// (T28-12's positive Tier 2 control; buyer-boundary.spec.ts's Tier 2
// meta-test). A boundary test that can only ever pass is worse than no test:
// this file proves the walker actually detects a transitive forbidden
// import, using a small synthetic in-memory file tree so the proof does not
// depend on (and cannot be defeated by a coincidental absence in) the real
// repo's current file contents.

import { describe, expect, it } from "vitest";
import {
  buildTransitiveImportClosure,
  extractImportSpecifiers,
  resolveSpecifier,
  type ImportGraphFs,
} from "./support/import-graph";

describe("extractImportSpecifiers", () => {
  it("extracts a default import's source", () => {
    // Arrange
    const source = `import Foo from "./foo";`;
    // Act
    const specifiers = extractImportSpecifiers(source);
    // Assert
    expect(specifiers).toEqual(["./foo"]);
  });

  it("extracts a named import's source", () => {
    expect(extractImportSpecifiers(`import { A, B } from "../bar";`)).toEqual(["../bar"]);
  });

  it("extracts a type-only import's source", () => {
    // Type-only imports still couple the file to the module for boundary
    // purposes — this is the stricter, safer reading, matching
    // crm-forecast-strip.tsx's actual `import type { CrmForecastView } from
    // "@/lib/crm/forecast"` line.
    expect(extractImportSpecifiers(`import type { CrmForecastView } from "@/lib/crm/forecast";`)).toEqual([
      "@/lib/crm/forecast",
    ]);
  });

  it("extracts a namespace import's source", () => {
    expect(extractImportSpecifiers(`import * as ns from "./ns";`)).toEqual(["./ns"]);
  });

  it("extracts a bare side-effect import with no bindings", () => {
    expect(extractImportSpecifiers(`import "./styles.css";`)).toEqual(["./styles.css"]);
  });

  it("extracts an export-from re-export's source", () => {
    expect(extractImportSpecifiers(`export { A } from "./a";`)).toEqual(["./a"]);
  });

  it("extracts an export-star re-export's source", () => {
    expect(extractImportSpecifiers(`export * from "./a";`)).toEqual(["./a"]);
  });

  it("extracts a dynamic import() call's source", () => {
    expect(extractImportSpecifiers(`const mod = await import("./lazy");`)).toEqual(["./lazy"]);
  });

  it("extracts multiple specifiers from a multi-line file in appearance order", () => {
    const source = [
      `import type { Metadata } from "next";`,
      `import { cookies } from "next/headers";`,
      `import { createAdminClient } from "@/lib/supabase/admin";`,
    ].join("\n");
    expect(extractImportSpecifiers(source)).toEqual(["next", "next/headers", "@/lib/supabase/admin"]);
  });

  it("returns an empty array for a file with no imports", () => {
    expect(extractImportSpecifiers(`export const x = 1;`)).toEqual([]);
  });
});

describe("resolveSpecifier", () => {
  const repoRoot = "/repo";

  function fakeFs(existingFiles: readonly string[]): ImportGraphFs {
    const set = new Set(existingFiles);
    return {
      fileExists: (p) => set.has(p),
      readFile: () => {
        throw new Error("not needed for resolveSpecifier tests");
      },
    };
  }

  it("resolves an '@/' alias specifier against repoRoot with an implicit .ts extension", () => {
    // Arrange
    const fs = fakeFs(["/repo/lib/crm/forecast.ts"]);
    // Act
    const resolved = resolveSpecifier("/repo/app/admin/page.tsx", "@/lib/crm/forecast", repoRoot, fs);
    // Assert
    expect(resolved).toBe("/repo/lib/crm/forecast.ts");
  });

  it("resolves a relative specifier against the importing file's own directory", () => {
    const fs = fakeFs(["/repo/app/admin/workspaces/[id]/crm-forecast-strip.tsx"]);
    const resolved = resolveSpecifier(
      "/repo/app/admin/workspaces/[id]/page.tsx",
      "./crm-forecast-strip",
      repoRoot,
      fs,
    );
    expect(resolved).toBe("/repo/app/admin/workspaces/[id]/crm-forecast-strip.tsx");
  });

  it("resolves a directory specifier to its index file", () => {
    const fs = fakeFs(["/repo/lib/crm/index.ts"]);
    const resolved = resolveSpecifier("/repo/app/page.tsx", "@/lib/crm", repoRoot, fs);
    expect(resolved).toBe("/repo/lib/crm/index.ts");
  });

  it("returns null for an external package specifier (no leading '.' or '@/')", () => {
    const fs = fakeFs([]);
    expect(resolveSpecifier("/repo/app/page.tsx", "react", repoRoot, fs)).toBeNull();
    expect(resolveSpecifier("/repo/app/page.tsx", "server-only", repoRoot, fs)).toBeNull();
  });

  it("returns null when no candidate file exists on disk", () => {
    const fs = fakeFs([]);
    expect(resolveSpecifier("/repo/app/page.tsx", "./nonexistent", repoRoot, fs)).toBeNull();
  });
});

describe("buildTransitiveImportClosure", () => {
  const repoRoot = "/repo";

  function fakeFs(files: Record<string, string>): ImportGraphFs {
    return {
      fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
      readFile: (p) => files[p],
    };
  }

  it("includes a directly-imported forbidden module in the closure", () => {
    // Arrange: root file imports the forbidden module directly.
    const files = {
      "/repo/app/portal/[id]/page.tsx": `import { CrmForecastStrip } from "@/app/admin/workspaces/[id]/crm-forecast-strip";`,
      "/repo/app/admin/workspaces/[id]/crm-forecast-strip.tsx": `export function CrmForecastStrip() {}`,
    };
    const fs = fakeFs(files);
    // Act
    const closure = buildTransitiveImportClosure(["/repo/app/portal/[id]/page.tsx"], repoRoot, fs);
    // Assert
    expect(closure.has("/repo/app/admin/workspaces/[id]/crm-forecast-strip.tsx")).toBe(true);
  });

  it("finds a forbidden module reached only TRANSITIVELY through an intermediate file", () => {
    // Arrange: page.tsx -> a-helper.ts -> b-loader.ts -> lib/crm/forecast.ts.
    // This is the case the direct-import test above cannot prove: a buyer
    // page importing a helper that itself (transitively) reaches the
    // seller-private module.
    const files = {
      "/repo/app/portal/[id]/page.tsx": `import { load } from "./a-helper";`,
      "/repo/app/portal/[id]/a-helper.ts": `import { fetchDeeper } from "./b-loader";`,
      "/repo/app/portal/[id]/b-loader.ts": `import { getCrmForecastForWorkspace } from "@/lib/crm/forecast";`,
      "/repo/lib/crm/forecast.ts": `export async function getCrmForecastForWorkspace() {}`,
    };
    const fs = fakeFs(files);
    // Act
    const closure = buildTransitiveImportClosure(["/repo/app/portal/[id]/page.tsx"], repoRoot, fs);
    // Assert — this is the positive control: proves the walker follows
    // imports transitively, not just one hop, before crm-import-boundary
    // .spec.ts's real "closure does NOT contain the forbidden module"
    // assertion is trusted to mean anything.
    expect(closure.has("/repo/lib/crm/forecast.ts")).toBe(true);
  });

  it("does not include a module that is never imported, directly or transitively", () => {
    const files = {
      "/repo/app/portal/[id]/page.tsx": `import { groupByCategory } from "@/lib/links";`,
      "/repo/lib/links.ts": `export function groupByCategory() {}`,
      "/repo/lib/crm/forecast.ts": `export async function getCrmForecastForWorkspace() {}`,
    };
    const fs = fakeFs(files);
    const closure = buildTransitiveImportClosure(["/repo/app/portal/[id]/page.tsx"], repoRoot, fs);
    expect(closure.has("/repo/lib/crm/forecast.ts")).toBe(false);
  });

  it("terminates on a circular import instead of looping forever", () => {
    const files = {
      "/repo/app/portal/[id]/page.tsx": `import { a } from "./a";`,
      "/repo/app/portal/[id]/a.ts": `import { b } from "./b";`,
      "/repo/app/portal/[id]/b.ts": `import { a } from "./a";`, // cycle back to a.ts
    };
    const fs = fakeFs(files);
    const closure = buildTransitiveImportClosure(["/repo/app/portal/[id]/page.tsx"], repoRoot, fs);
    expect(closure.size).toBe(3);
  });

  it("ignores external package specifiers while still walking internal ones", () => {
    const files = {
      "/repo/app/portal/[id]/page.tsx": `
        import { cookies } from "next/headers";
        import { groupByCategory } from "@/lib/links";
      `,
      "/repo/lib/links.ts": `export function groupByCategory() {}`,
    };
    const fs = fakeFs(files);
    const closure = buildTransitiveImportClosure(["/repo/app/portal/[id]/page.tsx"], repoRoot, fs);
    expect(closure.has("/repo/lib/links.ts")).toBe(true);
    expect(closure.size).toBe(2); // the root + lib/links.ts only; "next/headers" never resolves to a file
  });
});
