// Sprint 10, Ticket 52 — unit coverage for lib/hubspot/oauth-state.ts's
// signed OAuth `state` param: round trip, tamper detection, and TTL expiry.
// vi.useFakeTimers() drives the TTL test deterministically rather than a
// real sleep.
//
// T52 code review (MEDIUM): the HMAC key is now an HKDF subkey
// (lib/app-encryption-key.ts's deriveSubkey), not APP_ENCRYPTION_KEY raw —
// this file's round-trip/tamper/TTL coverage below is unaffected, and the
// key-separation property itself is covered by
// tests/hubspot/app-encryption-key.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOAuthState, verifyOAuthState } from "@/lib/hubspot/oauth-state";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

describe("signOAuthState / verifyOAuthState", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "b".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("round-trips: a freshly signed state verifies back to the same tenantId", () => {
    const state = signOAuthState(TENANT_ID);
    expect(verifyOAuthState(state)).toEqual({ tenantId: TENANT_ID });
  });

  it("rejects a state with an altered tenantId segment", () => {
    const state = signOAuthState(TENANT_ID);
    const [tenantId, expiresAt, signature] = state.split(".");
    const tampered = `22222222-2222-2222-2222-222222222222.${expiresAt}.${signature}`;
    expect(verifyOAuthState(tampered)).toBeNull();
    // sanity: the original tenantId segment really was where we think it is
    expect(tenantId).toBe(TENANT_ID);
  });

  it("rejects a state with an altered signature", () => {
    const state = signOAuthState(TENANT_ID);
    const [tenantId, expiresAt, signature] = state.split(".");
    const tamperedSignature = signature.slice(0, -1) + (signature.at(-1) === "a" ? "b" : "a");
    expect(verifyOAuthState(`${tenantId}.${expiresAt}.${tamperedSignature}`)).toBeNull();
  });

  it("rejects a malformed state string", () => {
    expect(verifyOAuthState("not-a-valid-state")).toBeNull();
  });

  it("accepts a state right up to its TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOAuthState(TENANT_ID);

    vi.setSystemTime(new Date("2026-01-01T00:09:59Z")); // 9m59s later, within the 10-min TTL.
    expect(verifyOAuthState(state)).toEqual({ tenantId: TENANT_ID });
  });

  it("rejects a state past its 10-minute TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOAuthState(TENANT_ID);

    vi.setSystemTime(new Date("2026-01-01T00:10:01Z")); // just past the 10-min TTL.
    expect(verifyOAuthState(state)).toBeNull();
  });
});
