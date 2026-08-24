// Sprint 10, Ticket 52 code-review fix (MEDIUM) — unit coverage for
// lib/app-encryption-key.ts's deriveSubkey: the HKDF split that gives
// lib/encrypt-secret.ts and lib/hubspot/oauth-state.ts independent subkeys
// from the same APP_ENCRYPTION_KEY. See that file's header for the "why".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveSubkey } from "@/lib/app-encryption-key";

const VALID_KEY_HEX = "c".repeat(64); // 32 bytes, hex-encoded.

describe("deriveSubkey", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", VALID_KEY_HEX);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is deterministic — the same (info, length) derives the same subkey twice", () => {
    const first = deriveSubkey("crm-token-encryption", 32);
    const second = deriveSubkey("crm-token-encryption", 32);
    expect(first.equals(second)).toBe(true);
  });

  it("derives an unrelated subkey for a different info string — key separation", () => {
    const encryptionSubkey = deriveSubkey("crm-token-encryption", 32);
    const oauthStateSubkey = deriveSubkey("oauth-state-hmac", 32);
    expect(encryptionSubkey.equals(oauthStateSubkey)).toBe(false);
  });

  it("returns a buffer of the requested length", () => {
    expect(deriveSubkey("some-info", 32)).toHaveLength(32);
    expect(deriveSubkey("some-info", 16)).toHaveLength(16);
  });

  it("never returns the raw master key bytes verbatim", () => {
    const masterKeyBytes = Buffer.from(VALID_KEY_HEX, "hex");
    const subkey = deriveSubkey("crm-token-encryption", 32);
    expect(subkey.equals(masterKeyBytes)).toBe(false);
  });

  it("throws a clear error when APP_ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(() => deriveSubkey("crm-token-encryption", 32)).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws a clear error when APP_ENCRYPTION_KEY is not 64 hex characters", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "not-hex-and-too-short");
    expect(() => deriveSubkey("crm-token-encryption", 32)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
