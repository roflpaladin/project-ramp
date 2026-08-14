// Sprint 7 · Ticket 33 — T33-12 (plans/sprint-6-7-replan.md §7).
//
// Runs scripts/contrast-check.mjs's exact math and PAIRS list under `npm
// test` (this file lives under tests/**/*.spec.ts, which the "security"
// Vitest project already globs — see vitest.config.ts — so no new CI
// infrastructure is needed to wire it in). The standalone script remains
// runnable on its own via `npm run check:contrast` for a human/manual pass
// that prints every pair's ratio, pass or fail; this spec is the same
// computation asserted per-pair so a regression names exactly which token
// pairing broke, in which theme, rather than only a script exit code.
//
// No browser, no axe: WCAG 2.1 contrast ratios computed from the hex values
// declared in app/globals.css's :root and [data-theme="dark"] blocks — the
// documented design tokens (source of truth: the live Notion "UI/UX and
// Design Guidelines" page; app/globals.css is the mirror, per that file's own
// header comment). Catches the systemic error — an entire token PAIRING that
// was never actually AA-compliant — which is the error that actually
// happens, as opposed to a one-off pixel regression a screenshot diff would
// catch instead.
//
// Two contrast floors, matching WCAG 1.4.3 (text) and 1.4.11 (non-text UI
// components/graphical objects):
//   "text" pairs (body copy, labels, badge/status text) >= 4.5:1
//   "ui"   pairs (borders, focus rings, decorative fills, no text drawn
//          directly in the foreground colour) >= 3:1

import { describe, expect, it } from "vitest";
import { contrastForPair, parseThemeTokens, PAIRS } from "../../scripts/contrast-check.mjs";

const { light, dark } = parseThemeTokens();

describe("WCAG static contrast — documented token pairs (T33-12)", () => {
  it("parses a non-empty token set for both themes (positive control — an empty theme would pass every pair vacuously)", () => {
    expect(Object.keys(light).length).toBeGreaterThan(10);
    expect(Object.keys(dark).length).toBeGreaterThan(10);
  });

  it("covers every pair named explicitly in the ticket brief", () => {
    const covered = PAIRS.map((pair) => `${pair.fg}/${pair.bg}`);
    expect(covered).toEqual(
      expect.arrayContaining([
        "ink/paper",
        "slate/paper",
        "slate/mist",
        "signal-fg/signal",
        "signal/paper",
        "state-done/wash-done",
        "state-risk/wash-risk",
        "seller-marker/seller-tint",
        "buyer-marker/buyer-tint",
      ]),
    );
  });

  describe.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme", (themeName, tokens) => {
    it.each(PAIRS)("$label meets its WCAG floor ($min:1) in the " + themeName + " theme", (pair) => {
      const ratio = contrastForPair(tokens, pair.fg, pair.bg);
      expect(ratio).toBeGreaterThanOrEqual(pair.min);
    });
  });
});
