// Preconditions for the buyer-boundary gate.
//
// Ticket 26's suite lands in Sprint 5 Step 6 and will live in this directory.
// These tests exist now because every one of them guards a way the gate could go
// green while proving nothing:
//
//   - credentials absent        -> the suite would skip, and a skipped gate reads
//                                  as a passing gate on the PR page;
//   - forbidden set emptied     -> "no forbidden value leaked" becomes vacuous;
//   - forbidden value too short -> it matches incidental page text and passes for
//                                  the wrong reason;
//   - a literal shared between the forbidden and visible sets -> the grep fails on
//                                  *correct* behaviour, and the natural fix is to
//                                  weaken the assertion.
//
// The last one is not hypothetical. While writing the fixture, crm_close_date and
// the plan's target_date were both 2026-09-30 — a value-level grep for the private
// close date would have matched the buyer-visible target date. Caught by hand;
// encoded here so it cannot recur.

import { describe, expect, it } from "vitest";

import { requireTestEnv } from "../fixtures/env";
import {
  EXPECTED_VISIBLE_VALUES,
  FORBIDDEN_VALUES,
  LEAK_TOKEN,
  VISIBLE_TOKEN,
} from "../fixtures/seed-leaky-workspace";

const MIN_GREPPABLE_LENGTH = 6;

describe("security suite preconditions", () => {
  it("has every credential the gate needs, and fails loudly rather than skipping", () => {
    const env = requireTestEnv();

    expect(env.supabaseUrl).toMatch(/^https?:\/\//);
    expect(env.serviceRoleKey.length).toBeGreaterThan(20);
    expect(env.portalSessionSecret.length).toBeGreaterThan(0);
  });

  it("declares a non-empty forbidden set and a non-empty visible set", () => {
    expect(FORBIDDEN_VALUES.length).toBeGreaterThan(0);
    expect(EXPECTED_VISIBLE_VALUES.length).toBeGreaterThan(0);
  });

  it("keeps every forbidden value distinctive enough to grep for", () => {
    const tooShort = FORBIDDEN_VALUES.filter((value) => value.length < MIN_GREPPABLE_LENGTH);

    expect(
      tooShort,
      `Forbidden values shorter than ${MIN_GREPPABLE_LENGTH} characters risk matching ` +
        `incidental text and passing for the wrong reason: ${tooShort.join(", ")}`,
    ).toEqual([]);
  });

  it("never shares a literal between the forbidden and the visible set", () => {
    const overlap = FORBIDDEN_VALUES.filter((forbidden) =>
      EXPECTED_VISIBLE_VALUES.some(
        (visible) => visible.includes(forbidden) || forbidden.includes(visible),
      ),
    );

    expect(
      overlap,
      "A literal that is both forbidden and expected-visible makes the value-level " +
        `grep fail on correct behaviour: ${overlap.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the leak and visible tokens disjoint", () => {
    expect(LEAK_TOKEN).not.toBe(VISIBLE_TOKEN);
    expect(EXPECTED_VISIBLE_VALUES.some((value) => value.includes(LEAK_TOKEN))).toBe(false);
    expect(FORBIDDEN_VALUES.some((value) => value.includes(VISIBLE_TOKEN))).toBe(false);
  });
});
