#!/usr/bin/env node
// Sprint 7 · Ticket 33 — T33-12 (plans/sprint-6-7-replan.md §7).
//
// Static WCAG 2.1 contrast check over the design tokens declared in
// app/globals.css (source of truth mirrored from the live Notion "UI/UX and
// Design Guidelines" page). No browser, no axe, no new CI infrastructure —
// this parses the two theme blocks as plain text and computes contrast
// ratios by hand. Catches the systemic error (a token pairing that was never
// actually AA-compliant), not a one-off pixel regression.
//
// Run directly:  node scripts/contrast-check.mjs
// Also imported (parseThemeTokens/contrastRatio/PAIRS) by
// tests/security/contrast.spec.ts so the exact same math and pair list runs
// under `npm test`, not a second hand-copied implementation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS_PATH = fileURLToPath(new URL("../app/globals.css", import.meta.url));

/** Every `--token: <hex|var(--other)>` declaration inside one `{ ... }` block. */
function tokensFromBlock(cssBlock) {
  const tokens = {};
  for (const m of cssBlock.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

/** Reads app/globals.css and returns { light, dark } token maps. Dark
 *  inherits any token it does not itself redeclare — real CSS custom
 *  property cascade behaviour, not an approximation of it. */
export function parseThemeTokens(css = readFileSync(CSS_PATH, "utf8")) {
  const rootBody = css.match(/:root\s*{([^}]*)}/s)?.[1] ?? "";
  const darkBody = css.match(/\[data-theme="dark"\]\s*{([^}]*)}/s)?.[1] ?? "";
  const light = tokensFromBlock(rootBody);
  const dark = { ...light, ...tokensFromBlock(darkBody) };
  return { light, dark };
}

function resolveHex(name, tokens, seen = new Set()) {
  const value = tokens[name];
  if (!value) throw new Error(`unknown design token --${name}`);
  if (value.startsWith("#")) return value;
  const ref = value.match(/var\(--([\w-]+)\)/)?.[1];
  if (!ref || seen.has(ref)) throw new Error(`cannot resolve --${name}: ${value}`);
  return resolveHex(ref, tokens, new Set(seen).add(ref));
}

function srgbToLinear(channel8bit) {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.1 contrast ratio (1:1 to 21:1) between two hex colours. */
export function contrastRatio(hexA, hexB) {
  const [lighter, darker] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Resolves both token names against `tokens` (a parseThemeTokens() theme
 *  map) and returns their contrast ratio. */
export function contrastForPair(tokens, fgToken, bgToken) {
  return contrastRatio(resolveHex(fgToken, tokens), resolveHex(bgToken, tokens));
}

// ── The documented token pairs (ticket brief's explicit coverage list) ─────
// category "text": body/label text — WCAG 1.4.3 normal-text floor, 4.5:1.
// category "ui": non-text UI components/graphical objects (borders, focus
// rings, decorative fills) — WCAG 1.4.11, 3:1.
export const PAIRS = [
  { label: "body text: ink on paper", fg: "ink", bg: "paper", category: "text", min: 4.5 },
  { label: "label text: slate on paper", fg: "slate", bg: "paper", category: "text", min: 4.5 },
  { label: "label text: slate on mist (rail sections)", fg: "slate", bg: "mist", category: "text", min: 4.5 },
  { label: "Signal button text: signal-fg on signal", fg: "signal-fg", bg: "signal", category: "text", min: 4.5 },
  { label: "Signal border/UI accent on paper", fg: "signal", bg: "paper", category: "ui", min: 3 },
  { label: "waiting state (slate-backed) text on paper", fg: "state-wait", bg: "paper", category: "text", min: 4.5 },
  { label: "done state text on its wash", fg: "state-done", bg: "wash-done", category: "text", min: 4.5 },
  { label: "risk state text on its wash", fg: "state-risk", bg: "wash-risk", category: "text", min: 4.5 },
  { label: "seller marker text on seller tint", fg: "seller-marker", bg: "seller-tint", category: "text", min: 4.5 },
  { label: "buyer marker text on buyer tint", fg: "buyer-marker", bg: "buyer-tint", category: "text", min: 4.5 },
];

function main() {
  const { light, dark } = parseThemeTokens();
  let anyFailed = false;

  for (const [themeName, tokens] of [["light", light], ["dark", dark]]) {
    console.log(`\n${themeName} theme`);
    for (const pair of PAIRS) {
      const ratio = contrastForPair(tokens, pair.fg, pair.bg);
      const pass = ratio >= pair.min;
      anyFailed ||= !pass;
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${pair.label} (--${pair.fg} on --${pair.bg}) = ` +
          `${ratio.toFixed(2)}:1, needs >= ${pair.min}:1`,
      );
    }
  }

  process.exitCode = anyFailed ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
