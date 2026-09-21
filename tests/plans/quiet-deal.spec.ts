// Sprint 12, Ticket 60 — the quiet-deal rule (lib/plans/quiet-deal.ts).
//
// Pure, DB-free: runs under the "security" Vitest project purely because that
// is where every tests/**/*.spec.ts file lives, but it touches no Supabase
// project of any kind. `isQuietDeal` takes an already-computed
// EngagementSignal, so there is no clock to freeze here either — the day
// arithmetic belongs to lib/plans/engagement.ts and is tested there.
//
// Covers: the boundary either side of QUIET_DEAL_DAYS, a custom threshold,
// the never-opened case (null days — we must never claim "hasn't opened in N
// days" about a buyer who has no recorded activity at all), and the rule
// that an actively engaged buyer is never quiet.

import { describe, expect, it } from "vitest";

import type { EngagementSignal } from "@/lib/plans/engagement";
import { QUIET_DEAL_DAYS, isQuietDeal } from "@/lib/plans/quiet-deal";

function makeSignal(overrides: Partial<EngagementSignal> = {}): EngagementSignal {
  return {
    state: "stalled",
    lastActivityAt: "2026-09-01T00:00:00.000Z",
    daysSinceLastActivity: 0,
    openBuyerStepCount: 1,
    ...overrides,
  };
}

describe("QUIET_DEAL_DAYS", () => {
  it("is the founder-ruled 14 days, named rather than inlined at the call site", () => {
    expect(QUIET_DEAL_DAYS).toBe(14);
  });
});

describe("isQuietDeal — the threshold boundary", () => {
  it("is not quiet one day below the threshold", () => {
    // Arrange
    const signal = makeSignal({ daysSinceLastActivity: QUIET_DEAL_DAYS - 1 });

    // Act
    const result = isQuietDeal(signal);

    // Assert
    expect(result).toBe(false);
  });

  it("is quiet exactly at the threshold", () => {
    const signal = makeSignal({ daysSinceLastActivity: QUIET_DEAL_DAYS });

    expect(isQuietDeal(signal)).toBe(true);
  });

  it("is quiet well past the threshold", () => {
    const signal = makeSignal({ daysSinceLastActivity: QUIET_DEAL_DAYS + 40 });

    expect(isQuietDeal(signal)).toBe(true);
  });

  it("honours a caller-supplied threshold instead of the default", () => {
    const signal = makeSignal({ daysSinceLastActivity: 5 });

    expect(isQuietDeal(signal, 5)).toBe(true);
    expect(isQuietDeal(signal, 6)).toBe(false);
  });
});

describe("isQuietDeal — a buyer with no recorded activity at all", () => {
  it("is never quiet when daysSinceLastActivity is null", () => {
    // "Your buyer hasn't opened this in N days" would be a claim we cannot
    // make: there is no N. The ordinary stall copy already covers this case.
    const signal = makeSignal({ daysSinceLastActivity: null, lastActivityAt: null });

    expect(isQuietDeal(signal)).toBe(false);
  });
});

describe("isQuietDeal — an engaged buyer", () => {
  it("is never quiet in the active state, whatever the day count says", () => {
    const signal = makeSignal({ state: "active", daysSinceLastActivity: QUIET_DEAL_DAYS + 1 });

    expect(isQuietDeal(signal)).toBe(false);
  });

  it("is quiet in the waiting state too — it is buyer silence, not open buyer steps, that this measures", () => {
    const signal = makeSignal({ state: "waiting", openBuyerStepCount: 0, daysSinceLastActivity: QUIET_DEAL_DAYS });

    expect(isQuietDeal(signal)).toBe(true);
  });
});
