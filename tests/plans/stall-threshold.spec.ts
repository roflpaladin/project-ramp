// T36-4 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Threshold
// parameter plumbing: proves the stall threshold now comes from
// configuration rather than a call-site constant, without touching
// lib/plans/engagement.ts's own math (already covered by
// tests/security/engagement.spec.ts and left unmodified by this ticket).

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STALL_THRESHOLD_DAYS, getStallThresholdDays } from "@/lib/plans/stall-threshold";

function envWith(value: string | undefined): NodeJS.ProcessEnv {
  return { ...process.env, PLAN_STALL_THRESHOLD_DAYS: value } as NodeJS.ProcessEnv;
}

describe("getStallThresholdDays", () => {
  it("returns the default when the env var is unset", () => {
    expect(getStallThresholdDays(envWith(undefined))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
  });

  it("returns the default when the env var is blank", () => {
    expect(getStallThresholdDays(envWith("  "))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
  });

  it("returns the configured value when the env var is a valid positive integer", () => {
    expect(getStallThresholdDays(envWith("10"))).toBe(10);
  });

  it("falls back to the default and logs when the env var is non-numeric", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getStallThresholdDays(envWith("not-a-number"))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("falls back to the default and logs when the env var is zero", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getStallThresholdDays(envWith("0"))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("falls back to the default and logs when the env var is negative", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getStallThresholdDays(envWith("-3"))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("falls back to the default and logs when the env var is a non-integer", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getStallThresholdDays(envWith("2.5"))).toBe(DEFAULT_STALL_THRESHOLD_DAYS);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("defaults to reading process.env when no env object is injected", () => {
    const original = process.env.PLAN_STALL_THRESHOLD_DAYS;
    process.env.PLAN_STALL_THRESHOLD_DAYS = "7";

    expect(getStallThresholdDays()).toBe(7);

    if (original === undefined) {
      delete process.env.PLAN_STALL_THRESHOLD_DAYS;
    } else {
      process.env.PLAN_STALL_THRESHOLD_DAYS = original;
    }
  });
});
