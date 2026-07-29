// Environment contract for the test suites.
//
// The buyer-boundary suite is a merge gate. A gate that quietly skips itself
// when its credentials are absent is worse than no gate at all: CI goes green
// and everyone reads that as "the boundary holds." So this throws, loudly, and
// names every variable that is missing rather than only the first one.

export interface TestEnv {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly portalSessionSecret: string;
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PORTAL_SESSION_SECRET",
] as const;

export function requireTestEnv(): TestEnv {
  const missing = REQUIRED.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required test environment variable(s): ${missing.join(", ")}.\n` +
        "Locally these come from .env.local (loaded by vitest.config.ts).\n" +
        "In CI they come from repository secrets on the `test` job.\n" +
        "This is a hard failure by design — a security suite that skips is not a gate.",
    );
  }

  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    portalSessionSecret: process.env.PORTAL_SESSION_SECRET as string,
  };
}
