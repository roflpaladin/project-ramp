// Sprint 12, Ticket 62 (R7 hardening) — behavioural coverage for the buyer
// portal's Security Gate server actions (app/portal/[id]/gate-actions.ts) and
// the issuance/verification data layer behind them
// (lib/portal-access-token.ts).
//
// What this ticket changed, and therefore what is pinned here:
//   - the emailed code is six digits, not four;
//   - brute force is bounded per (workspace, email) ACROSS token rows, not
//     only per row — before T62 a new code could be requested every 60s and
//     each one bought five fresh guesses against 10,000 possibilities;
//   - both actions are rate limited per caller IP;
//   - a just-verified buyer cannot immediately mint another code;
//   - every failure mode gives the buyer the SAME sentence, so the gate is
//     not an approved-email / pending-code oracle.
//
// DB-free, like tests/security/portal-session-cookie.spec.ts and
// tests/api/waitlist.spec.ts, but with a stateful fake
// (./support/fake-supabase-admin.ts) rather than one canned answer per
// table — every assertion below is about state carried across calls. The
// durable limiter (@/lib/rate-limit-durable) is mocked because it is the
// other slice's code and talks to Postgres; @/lib/client-ip is NOT mocked,
// so the real header parsing decides the key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PORTAL_VERIFY_RATE_LIMIT, SEND_TOKEN_RATE_LIMIT } from "@/lib/rate-limit";
import { ACCESS_CODE_LENGTH, isWellFormedAccessCode } from "@/lib/portal-access-code";
import { createFakeAdminDb, type FakeAdminDb, type FakeRow } from "./support/fake-supabase-admin";

interface SendCall {
  readonly to: string;
  readonly code: string;
}

interface LimiterCall {
  readonly key: string;
  readonly budget: { readonly limit: number; readonly windowMs: number };
}

const {
  dbRef,
  redirectSentinel,
  redirectUrls,
  cookieSets,
  sendCalls,
  limiterCalls,
  limiterDecision,
} = vi.hoisted(() => ({
  dbRef: { value: null as unknown as { client: { from(table: string): unknown } } },
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectUrls: [] as string[],
  cookieSets: [] as string[],
  sendCalls: [] as SendCall[],
  limiterCalls: [] as LimiterCall[],
  limiterDecision: { allowed: true },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string) => {
      cookieSets.push(name);
    },
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.42" })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    redirectUrls.push(url);
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => dbRef.value.client,
}));

vi.mock("@/lib/email/send-access-code", () => ({
  sendAccessCodeEmail: async ({ to, code }: SendCall) => {
    sendCalls.push({ to, code });
    return { ok: true };
  },
}));

// The tenant email cap (lib/email/send-guard.ts, T62) is a separate guard
// with its own spec (tests/email/send-guard.spec.ts); here it is a switch, so
// issuance can be tested with and without its refusal.
const sendGuardDecision = { allowed: true };
const sendGuardCalls: Array<{ tenantId: string | null }> = [];
vi.mock("@/lib/email/send-guard", () => ({
  reserveEmailSend: async ({ tenantId }: { tenantId: string | null }) => {
    sendGuardCalls.push({ tenantId });
    return sendGuardDecision.allowed ? { allowed: true } : { allowed: false, reason: "tenant_hourly" };
  },
}));

vi.mock("@/lib/rate-limit-durable", () => ({
  checkDurableRateLimit: async (key: string, budget: LimiterCall["budget"]) => {
    limiterCalls.push({ key, budget });
    return limiterDecision.allowed
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: 42 };
  },
}));

const db: FakeAdminDb = createFakeAdminDb({
  // Mirrors supabase/migrations/0002_portal_access_tokens.sql's column defaults.
  portal_access_tokens: { attempts: 0, consumed_at: null },
});
dbRef.value = db;

const { requestAccess, verifyAccess } = await import("@/app/portal/[id]/gate-actions");
const {
  hashToken,
  MAX_ATTEMPTS,
  MAX_VERIFY_ATTEMPTS_PER_WINDOW,
  VERIFY_ATTEMPT_WINDOW_MS,
} = await import("@/lib/portal-access-token");

const WORKSPACE_ID = "7e620000-0000-4000-8000-000000000010";
const TENANT_ID = "7e620000-0000-4000-8000-000000000001";
const BUYER_EMAIL = "buyer@gate-test.invalid";
const CORRECT_CODE = "426913";
const WRONG_CODE = "000001";
const UNIFORM_FAILURE = "Incorrect or expired code.";
const TOKENS = "portal_access_tokens";

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", "a".repeat(64));
  db.reset();
  redirectUrls.length = 0;
  cookieSets.length = 0;
  sendCalls.length = 0;
  limiterCalls.length = 0;
  limiterDecision.allowed = true;
  sendGuardCalls.length = 0;
  sendGuardDecision.allowed = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function seedWorkspace(): void {
  db.seed("workspaces", [
    { id: WORKSPACE_ID, tenant_id: TENANT_ID, target_domain: "gate-test.invalid", approved_emails: [BUYER_EMAIL] },
  ]);
}

function seedToken(overrides: FakeRow = {}): void {
  db.seed(TOKENS, [
    {
      id: `token-${db.rowsOf(TOKENS).length}`,
      workspace_id: WORKSPACE_ID,
      email: BUYER_EMAIL,
      token_hash: hashToken(CORRECT_CODE, WORKSPACE_ID, BUYER_EMAIL),
      attempts: 0,
      consumed_at: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      ...overrides,
    },
  ]);
}

/** Runs a server action to its redirect (the only way either action ends) and
 *  returns the URL it redirected to. */
async function runToRedirect(action: Promise<void>): Promise<string> {
  await expect(action).rejects.toBe(redirectSentinel);
  return redirectUrls[redirectUrls.length - 1];
}

function submitCode(code: string, email: string = BUYER_EMAIL): Promise<string> {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("token", code);
  return runToRedirect(verifyAccess(WORKSPACE_ID, formData));
}

function askForCode(email: string = BUYER_EMAIL): Promise<string> {
  const formData = new FormData();
  formData.set("email", email);
  return runToRedirect(requestAccess(WORKSPACE_ID, formData));
}

function tokenRows(): readonly FakeRow[] {
  return db.rowsOf(TOKENS);
}

describe("verifyAccess — a correct code", () => {
  it("grants a session and consumes the row", async () => {
    seedToken();

    const url = await submitCode(CORRECT_CODE);

    expect(url).toBe(`/portal/${WORKSPACE_ID}`);
    expect(cookieSets).toHaveLength(1);
    expect(tokenRows()[0].consumed_at).toEqual(expect.any(String));
  });

  it("cannot be replayed once consumed", async () => {
    seedToken();
    await submitCode(CORRECT_CODE);
    cookieSets.length = 0;

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(cookieSets).toHaveLength(0);
  });

  it("is refused once the row has expired", async () => {
    seedToken({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(cookieSets).toHaveLength(0);
  });
});

describe("verifyAccess — wrong codes", () => {
  it("increments the row's attempts and gives the uniform failure", async () => {
    seedToken();

    const url = await submitCode(WRONG_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(tokenRows()[0].attempts).toBe(1);
    expect(cookieSets).toHaveLength(0);
  });

  it(`locks the row after ${MAX_ATTEMPTS} wrong guesses, even for the correct code`, async () => {
    seedToken();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await submitCode(WRONG_CODE);
    }
    expect(tokenRows()[0].attempts).toBe(MAX_ATTEMPTS);

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(cookieSets).toHaveLength(0);
  });

  it("survives a stored hash that is not valid hex without throwing", async () => {
    // Real rows of this shape exist: the invite-cap fixture writes
    // `cap-filler-hash-N`. A length-mismatched buffer must be a mismatch, not
    // a crash.
    seedToken({ token_hash: "cap-filler-hash-0" });

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
  });

  it("refuses a malformed code before touching the database", async () => {
    seedToken();
    const callsBefore = db.calls.length;

    for (const malformed of ["12345", "1234567", "abcdef", "", "12 456"]) {
      const url = await submitCode(malformed);
      expect(url).toContain(encodeURIComponent(`${ACCESS_CODE_LENGTH}-digit`));
    }

    expect(db.calls.length).toBe(callsBefore);
    expect(isWellFormedAccessCode(CORRECT_CODE)).toBe(true);
  });
});

describe("verifyAccess — attempt cap per (workspace, email) across rows (T62)", () => {
  function seedSpentAttempts(createdAt: string): void {
    // Two burnt-out rows: MAX_ATTEMPTS wrong guesses each, which is the cap.
    for (let index = 0; index < MAX_VERIFY_ATTEMPTS_PER_WINDOW / MAX_ATTEMPTS; index += 1) {
      seedToken({
        id: `spent-${index}`,
        attempts: MAX_ATTEMPTS,
        consumed_at: null,
        created_at: createdAt,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
    }
  }

  // Five minutes ago: inside VERIFY_ATTEMPT_WINDOW_MS, and unambiguously
  // older than the fresh row (the candidate read orders by created_at).
  const RECENTLY = new Date(Date.now() - 5 * 60_000).toISOString();

  it("refuses even the CORRECT code on a fresh row once the window's attempts are spent", async () => {
    seedSpentAttempts(RECENTLY);
    seedToken({ id: "fresh" });

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(cookieSets).toHaveLength(0);
  });

  it("does not burn further attempts once capped", async () => {
    seedSpentAttempts(RECENTLY);
    seedToken({ id: "fresh" });

    await submitCode(WRONG_CODE);

    const fresh = tokenRows().find((row) => row.id === "fresh");
    expect(fresh?.attempts).toBe(0);
  });

  it("ignores failures older than the window", async () => {
    seedSpentAttempts(new Date(Date.now() - VERIFY_ATTEMPT_WINDOW_MS - 60_000).toISOString());
    seedToken({ id: "fresh" });

    const url = await submitCode(CORRECT_CODE);

    expect(url).toBe(`/portal/${WORKSPACE_ID}`);
    expect(cookieSets).toHaveLength(1);
  });
});

describe("verifyAccess — rate limiting (T62)", () => {
  it("refuses over-budget callers with the uniform failure and never touches the database", async () => {
    seedToken();
    limiterDecision.allowed = false;

    const url = await submitCode(CORRECT_CODE);

    expect(url).toContain(encodeURIComponent(UNIFORM_FAILURE));
    expect(db.calls).toHaveLength(0);
    expect(cookieSets).toHaveLength(0);
  });

  it("keys the budget per caller IP under the portal-verify budget", async () => {
    seedToken();

    await submitCode(CORRECT_CODE);

    expect(limiterCalls).toHaveLength(1);
    expect(limiterCalls[0].key).toMatch(/^portal-verify:ip:/);
    expect(limiterCalls[0].budget).toEqual(PORTAL_VERIFY_RATE_LIMIT);
  });
});

describe("requestAccess — issuance", () => {
  it(`emails a ${ACCESS_CODE_LENGTH}-digit code`, async () => {
    seedWorkspace();

    await askForCode();

    expect(sendCalls).toHaveLength(1);
    expect(isWellFormedAccessCode(sendCalls[0].code)).toBe(true);
    expect(sendCalls[0].code).toHaveLength(ACCESS_CODE_LENGTH);
  });

  it("keys the budget per caller IP under the send-token budget", async () => {
    seedWorkspace();

    await askForCode();

    expect(limiterCalls).toHaveLength(1);
    expect(limiterCalls[0].key).toMatch(/^portal-request:ip:/);
    expect(limiterCalls[0].budget).toEqual(SEND_TOKEN_RATE_LIMIT);
  });

  it("still applies the resend cooldown immediately after a successful verify (T62)", async () => {
    seedWorkspace();
    await askForCode();
    const issuedCode = sendCalls[0].code;
    await submitCode(issuedCode);
    expect(cookieSets).toHaveLength(1);

    await askForCode();

    expect(sendCalls).toHaveLength(1);
    expect(tokenRows()).toHaveLength(1);
  });

  it("sends nothing when over budget, and redirects exactly as it always does", async () => {
    seedWorkspace();
    const allowedUrl = await askForCode();
    const callsAfterAllowed = db.calls.length;

    limiterDecision.allowed = false;
    const refusedUrl = await askForCode();

    // Byte-identical redirect: the refusal is invisible to the caller, which
    // is the same non-enumeration property every other outcome here has.
    expect(refusedUrl).toBe(allowedUrl);
    expect(sendCalls).toHaveLength(1);
    expect(db.calls.length).toBe(callsAfterAllowed);
  });

  it("charges the workspace's tenant against the email cap before writing a row (T62)", async () => {
    seedWorkspace();

    await askForCode();

    expect(sendGuardCalls).toEqual([{ tenantId: TENANT_ID }]);
  });

  it("sends nothing and writes no row when the tenant's email cap is spent (T62)", async () => {
    seedWorkspace();
    sendGuardDecision.allowed = false;

    const url = await askForCode();

    expect(sendCalls).toHaveLength(0);
    expect(tokenRows()).toHaveLength(0);
    expect(url).toContain("stage=verify");
  });

  it("still refuses an empty email before anything else", async () => {
    const url = await askForCode("");

    expect(url).toContain(encodeURIComponent("Enter your email."));
    expect(sendCalls).toHaveLength(0);
  });
});
