// Sprint 12, Ticket 62 (R7 hardening) — the two primitives behind the buyer
// portal's Security Gate: the CODE itself (length + well-formedness) and the
// KEYED hash the code is stored under.
//
// DB-free: @/lib/supabase/admin is mocked to nothing at all, because
// lib/portal-access-token.ts imports it at module scope (and it carries
// `import "server-only"`), while nothing in this file's assertions ever
// reaches a query.
//
// APP_ENCRYPTION_KEY is stubbed per test rather than read from .env.local, so
// these assertions hold identically on a laptop and in CI — and so the
// "same inputs, different key ⇒ different hash" case can actually swap keys.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("access-code.spec.ts must never reach the database");
  },
}));

const { ACCESS_CODE_LENGTH, isWellFormedAccessCode } = await import("@/lib/portal-access-code");
const { hashToken } = await import("@/lib/portal-access-token");

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const WORKSPACE_ID = "7e620000-0000-4000-8000-000000000001";
const EMAIL = "buyer@access-code-test.invalid";
const CODE = "426913";

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", KEY_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("access code shape (T62 — 4 digits was 10,000 possibilities)", () => {
  it("is six digits long", () => {
    expect(ACCESS_CODE_LENGTH).toBe(6);
  });

  it("accepts exactly ACCESS_CODE_LENGTH digits, including a leading-zero code", () => {
    expect(isWellFormedAccessCode("426913")).toBe(true);
    expect(isWellFormedAccessCode("000000")).toBe(true);
  });

  it.each(["", "12345", "1234567", "12a456", "12 456", "  426913  ", "١٢٣٤٥٦"])(
    "rejects %o",
    (value) => {
      expect(isWellFormedAccessCode(value)).toBe(false);
    },
  );
});

describe("stored code hash is keyed (T62 — a leaked table must not be brute-forceable offline)", () => {
  it("is never the bare sha256 of the same joined input", () => {
    const bare = createHash("sha256").update(`${CODE}.${WORKSPACE_ID}.${EMAIL}`).digest("hex");

    expect(hashToken(CODE, WORKSPACE_ID, EMAIL)).not.toBe(bare);
  });

  it("produces a different hash for the same inputs under a different key", () => {
    const underKeyA = hashToken(CODE, WORKSPACE_ID, EMAIL);

    vi.stubEnv("APP_ENCRYPTION_KEY", KEY_B);
    const underKeyB = hashToken(CODE, WORKSPACE_ID, EMAIL);

    expect(underKeyB).not.toBe(underKeyA);
  });

  it("is deterministic for the same key and inputs, and is 64 hex characters", () => {
    const first = hashToken(CODE, WORKSPACE_ID, EMAIL);
    const second = hashToken(CODE, WORKSPACE_ID, EMAIL);

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stays scoped to the workspace and the email, not just the code", () => {
    const baseline = hashToken(CODE, WORKSPACE_ID, EMAIL);

    expect(hashToken(CODE, "7e620000-0000-4000-8000-0000000000ff", EMAIL)).not.toBe(baseline);
    expect(hashToken(CODE, WORKSPACE_ID, "someone.else@access-code-test.invalid")).not.toBe(baseline);
  });

  it("fails loudly when APP_ENCRYPTION_KEY is absent instead of falling back to an unkeyed hash", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");

    expect(() => hashToken(CODE, WORKSPACE_ID, EMAIL)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
