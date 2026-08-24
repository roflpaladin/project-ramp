// Sprint 10, Ticket 52 — unit coverage for lib/encrypt-secret.ts's
// AES-256-GCM round trip. APP_ENCRYPTION_KEY is read lazily on every call
// (not cached at module load), so a plain vi.stubEnv per test is enough —
// no module reset/dynamic re-import needed.
//
// T52 code review (MEDIUM): the AES key is now an HKDF subkey
// (lib/app-encryption-key.ts's deriveSubkey), not APP_ENCRYPTION_KEY raw —
// this file's round-trip/tamper coverage below is unaffected (it never
// asserted anything about the key's own bytes), and the key-separation
// property itself is covered by tests/hubspot/app-encryption-key.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/encrypt-secret";

const VALID_KEY_HEX = "a".repeat(64); // 32 bytes, hex-encoded — a valid AES-256 key.

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", VALID_KEY_HEX);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips plaintext through encrypt then decrypt", () => {
    const ciphertext = encryptSecret("refresh-token-value");
    expect(decryptSecret(ciphertext)).toBe("refresh-token-value");
  });

  it("produces a colon-delimited base64url iv:tag:data ciphertext", () => {
    const ciphertext = encryptSecret("hello");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("uses a distinct IV per call — two encryptions of the same plaintext differ", () => {
    const first = encryptSecret("same-value");
    const second = encryptSecret("same-value");
    expect(first).not.toBe(second);
    expect(first.split(":")[0]).not.toBe(second.split(":")[0]);
  });

  /**
   * Flips a character NOT in the last position of a base64url segment.
   * Base64's final character of a group can encode padding bits a decoder
   * ignores — flipping only that bit (as the segment's very last character
   * sometimes does) can decode to the identical byte, a false negative for
   * a tamper-detection test. A middle character has no such ambiguity.
   */
  function flipMiddleChar(segment: string): string {
    const index = Math.floor(segment.length / 2);
    const original = segment[index];
    const replacement = original === "A" ? "B" : "A";
    return segment.slice(0, index) + replacement + segment.slice(index + 1);
  }

  it("throws when the ciphertext's auth tag has been tampered with", () => {
    const [iv, tag, data] = encryptSecret("tamper-me").split(":");
    expect(() => decryptSecret(`${iv}:${flipMiddleChar(tag)}:${data}`)).toThrow();
  });

  it("throws when the ciphertext's data segment has been tampered with", () => {
    const [iv, tag, data] = encryptSecret("tamper-me-too").split(":");
    expect(() => decryptSecret(`${iv}:${tag}:${flipMiddleChar(data)}`)).toThrow();
  });

  it("throws a clear error on encrypt when APP_ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("value")).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws a clear error on decrypt when APP_ENCRYPTION_KEY is missing", () => {
    const ciphertext = encryptSecret("value");
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(() => decryptSecret(ciphertext)).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws a clear error when APP_ENCRYPTION_KEY is not 64 hex characters", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "not-hex-and-too-short");
    expect(() => encryptSecret("value")).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws on decrypt given a malformed ciphertext shape", () => {
    expect(() => decryptSecret("not-the-right-shape")).toThrow();
  });
});
