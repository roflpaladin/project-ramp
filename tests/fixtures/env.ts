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
  /**
   * The public anon key — already shipped to every browser, so not a secret in
   * any meaningful sense. Required because proving RLS *holds* (Ticket 24) needs
   * a client that is actually subject to it; the service-role key bypasses RLS
   * and so can never demonstrate it working.
   */
  readonly anonKey: string;
  /**
   * Sprint 12, Ticket 62. The buyer portal's access-code hash is now an HMAC
   * keyed by an HKDF subkey of APP_ENCRYPTION_KEY (lib/portal-access-token.ts),
   * so the live buyer-gate specs — tests/api/send-token.spec.ts,
   * tests/api/issue-access-token-invite.spec.ts,
   * tests/security/invite-actions.spec.ts — cannot issue or verify a single
   * code without it. It was already passed to the CI `test` job
   * (.github/workflows/ci.yml) for the CRM token cipher, but was NOT asserted
   * here, so a run missing it would have failed deep inside a crypto call
   * instead of naming the variable.
   */
  readonly appEncryptionKey: string;
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PORTAL_SESSION_SECRET",
  "APP_ENCRYPTION_KEY",
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
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY as string,
  };
}
