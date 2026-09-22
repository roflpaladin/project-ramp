// Sprint 12, Ticket 65 — "Password Reset Flow". Pure unit coverage for
// lib/auth/recovery-marker.ts: the short-lived signed value /auth/confirm
// sets after a real recovery link is verified, and /auth/reset requires
// before it will change a password. No database, no network — only
// APP_ENCRYPTION_KEY (already required by tests/fixtures/env.ts's callers
// and present in .env.local) is read, via lib/app-encryption-key.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_MARKER_TTL_SECONDS,
  signRecoveryMarker,
  verifyRecoveryMarker,
} from "@/lib/auth/recovery-marker";

const USER_ID = "7e570000-0000-4000-8000-000000006501";
const OTHER_USER_ID = "7e570000-0000-4000-8000-000000006502";
const MS_PER_SECOND = 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("recovery marker", () => {
  it("verifies a freshly signed marker for the same user", () => {
    const marker = signRecoveryMarker(USER_ID);

    expect(verifyRecoveryMarker(marker, USER_ID)).toBe(true);
  });

  it("rejects a marker signed for a different user", () => {
    const marker = signRecoveryMarker(OTHER_USER_ID);

    expect(verifyRecoveryMarker(marker, USER_ID)).toBe(false);
  });

  it("rejects a missing or empty marker", () => {
    expect(verifyRecoveryMarker(undefined, USER_ID)).toBe(false);
    expect(verifyRecoveryMarker("", USER_ID)).toBe(false);
  });

  it("rejects a marker whose signature was tampered with", () => {
    const marker = signRecoveryMarker(USER_ID);
    const lastChar = marker.slice(-1);
    const tampered = `${marker.slice(0, -1)}${lastChar === "0" ? "1" : "0"}`;

    expect(verifyRecoveryMarker(tampered, USER_ID)).toBe(false);
  });

  it("rejects a marker whose expiry was pushed out without re-signing", () => {
    const marker = signRecoveryMarker(USER_ID);
    const [userId, , signature] = marker.split(".");
    const forged = `${userId}.${Date.now() + 365 * 24 * 60 * 60 * MS_PER_SECOND}.${signature}`;

    expect(verifyRecoveryMarker(forged, USER_ID)).toBe(false);
  });

  it("rejects a malformed marker without throwing", () => {
    expect(verifyRecoveryMarker("not-a-marker", USER_ID)).toBe(false);
    expect(verifyRecoveryMarker("a.b", USER_ID)).toBe(false);
    expect(verifyRecoveryMarker("a.b.c.d", USER_ID)).toBe(false);
  });

  it("expires after its time-to-live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T20:00:00Z"));
    const marker = signRecoveryMarker(USER_ID);

    vi.advanceTimersByTime((RECOVERY_MARKER_TTL_SECONDS + 1) * MS_PER_SECOND);

    expect(verifyRecoveryMarker(marker, USER_ID)).toBe(false);
  });
});
