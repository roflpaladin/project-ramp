// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Decides which
// CTA the landing page renders: an inline waitlist form ("waitlist", the
// default, ahead of a public launch) or a direct link to /register
// ("signup", once self-serve signup is ready to take live traffic). Modelled
// on lib/plans/stall-threshold.ts's env-sourcing pattern: never throws, an
// unset or unrecognised value falls back to the safe default rather than
// crashing the landing page render, and `env` is injectable so this is
// testable without mutating the real process.env of the test runner.
//
// NEXT_PUBLIC_ (not server-only) on purpose — the mode also has to be
// readable in the client-side WaitlistForm bundle boundary check is
// unnecessary here since neither value is a secret, but the page itself
// (a Server Component) is the only current caller of getLandingMode();
// WaitlistForm never reads the mode itself, it is only rendered when the
// page has already chosen "waitlist".

export type LandingMode = "waitlist" | "signup";

const VALID_MODES: readonly LandingMode[] = ["waitlist", "signup"];
export const DEFAULT_LANDING_MODE: LandingMode = "waitlist";

const ENV_VAR_NAME = "NEXT_PUBLIC_LANDING_MODE";

function isLandingMode(value: string | undefined): value is LandingMode {
  return (VALID_MODES as readonly string[]).includes(value ?? "");
}

/**
 * Pure resolver, unit-testable without touching process.env directly. Any
 * value other than exactly "waitlist" or "signup" (missing, blank, typo'd,
 * or some other string entirely) resolves to DEFAULT_LANDING_MODE — an
 * unrecognised mode must never accidentally expose the signup CTA (or vice
 * versa) before it's ready.
 */
export function resolveLandingMode(rawValue: string | undefined): LandingMode {
  return isLandingMode(rawValue) ? rawValue : DEFAULT_LANDING_MODE;
}

/** Reads NEXT_PUBLIC_LANDING_MODE from the given env (defaults to process.env). */
export function getLandingMode(env: NodeJS.ProcessEnv = process.env): LandingMode {
  return resolveLandingMode(env[ENV_VAR_NAME]);
}
