// Brand rule: one family (Geist, Geist Mono for data) at weights 400/500/600,
// actually loaded via next/font — and the root tab title says Brava, not the
// internal codename. Source-text assertions: next/font/google only resolves
// inside the Next compiler, so layout.tsx cannot be imported under Vitest.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return full.endsWith(".css") ? [full] : [];
  });
}

const ALL_CSS = ["app", "components"].flatMap((d) => cssFiles(join(ROOT, d)));

describe("root layout", () => {
  const layout = read("app/layout.tsx");

  it("loads Geist and Geist Mono via next/font/google at 400/500/600", () => {
    expect(layout).toContain('from "next/font/google"');
    expect(layout).toMatch(/Geist\(/);
    expect(layout).toMatch(/Geist_Mono\(/);
    expect(layout.match(/weight: \["400", "500", "600"\]/g)).toHaveLength(2);
    expect(layout).toContain('--font-geist-sans');
    expect(layout).toContain('--font-geist-mono');
    // The variables only resolve if both classes land on <html>.
    expect(layout).toContain("className={`${geistSans.variable} ${geistMono.variable}`}");
  });

  it("uses Brava as the default tab title and never the codename", () => {
    expect(layout).toMatch(/title: "Brava"/);
    expect(layout).not.toMatch(/title:\s*\{/);
    expect(layout).not.toContain("Project Ramp");
  });
});

describe("font tokens", () => {
  it("globals.css base font-family resolves through the next/font variable", () => {
    expect(read("app/globals.css")).toMatch(
      /font-family:\s*var\(--font-sans\)/,
    );
    expect(read("app/globals.css")).toMatch(/--font-sans:\s*var\(--font-geist-sans\)/);
    expect(read("app/globals.css")).toMatch(/--font-mono:\s*var\(--font-geist-mono\)/);
  });

  it("no stylesheet names Geist literally in a font-family", () => {
    const offenders = ALL_CSS.filter((f) =>
      /font-family:[^;]*["']Geist/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no stylesheet uses a font-weight outside 400/500/600", () => {
    const offenders = ALL_CSS.filter((f) =>
      [...readFileSync(f, "utf8").matchAll(/font-weight:\s*(\w+)/g)].some(
        (m) => !["400", "500", "600"].includes(m[1]),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
