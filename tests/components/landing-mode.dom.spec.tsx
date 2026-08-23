// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Unit coverage
// for lib/landing/mode.ts. Deliberately placed under tests/components/ (not
// tests/plans/ or another tests/**/*.spec.ts location) and named
// .dom.spec.tsx: the ticket brief scopes this build to the "components"
// Vitest project only (happy-dom, no Supabase) — the "security" project's
// tests/**/*.spec.ts glob hits a real, currently contended dev database
// that this ticket must not touch. happy-dom is a strict superset of a
// plain node environment for a dependency-free pure function, so nothing
// about testing it here is a compromise.

import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING_MODE, getLandingMode, resolveLandingMode } from "@/lib/landing/mode";

describe("resolveLandingMode", () => {
  it("resolves 'waitlist' to itself", () => {
    expect(resolveLandingMode("waitlist")).toBe("waitlist");
  });

  it("resolves 'signup' to itself", () => {
    expect(resolveLandingMode("signup")).toBe("signup");
  });

  it("falls back to the default ('waitlist') for undefined", () => {
    expect(resolveLandingMode(undefined)).toBe(DEFAULT_LANDING_MODE);
    expect(DEFAULT_LANDING_MODE).toBe("waitlist");
  });

  it("falls back to the default for a blank string", () => {
    expect(resolveLandingMode("")).toBe(DEFAULT_LANDING_MODE);
  });

  it("falls back to the default for an unrecognised value, never throwing", () => {
    expect(resolveLandingMode("SIGNUP")).toBe(DEFAULT_LANDING_MODE);
    expect(resolveLandingMode("open")).toBe(DEFAULT_LANDING_MODE);
    expect(resolveLandingMode("waitlist ")).toBe(DEFAULT_LANDING_MODE);
  });
});

// Spread the real process.env as a base (rather than an arbitrary object
// literal) so the injected value satisfies NodeJS.ProcessEnv's required
// keys without an `as` cast — same pattern as
// tests/plans/stall-threshold.spec.ts's envWith helper.
function envWith(value: string | undefined): NodeJS.ProcessEnv {
  return { ...process.env, NEXT_PUBLIC_LANDING_MODE: value };
}

describe("getLandingMode", () => {
  it("reads NEXT_PUBLIC_LANDING_MODE from the given env", () => {
    expect(getLandingMode(envWith("signup"))).toBe("signup");
  });

  it("defaults to 'waitlist' when the env var is absent", () => {
    expect(getLandingMode(envWith(undefined))).toBe("waitlist");
  });
});
