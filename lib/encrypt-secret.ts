import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { deriveSubkey } from "@/lib/app-encryption-key";

// Sprint 10, Ticket 52 — AES-256-GCM helpers for at-rest encryption of the
// HubSpot refresh token before it's written to crm_connections
// (lib/crm-connections/token-store.ts). GCM (not CBC) so tampering with the
// ciphertext is detected on decrypt rather than silently producing garbage
// plaintext — decryptSecret throws on any modification to iv/tag/data.
//
// T52 code review (MEDIUM): the AES key is an HKDF subkey derived from
// APP_ENCRYPTION_KEY (lib/app-encryption-key.ts), not the raw master key —
// see that file's header for why this key needs to be independent from the
// one lib/hubspot/oauth-state.ts derives for its own, unrelated HMAC job.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's recommended/standard nonce length.
const AES_256_KEY_BYTES = 32;
const HKDF_INFO = "crm-token-encryption";

function readEncryptionKey(): Buffer {
  return deriveSubkey(HKDF_INFO, AES_256_KEY_BYTES);
}

/**
 * Encrypts `plaintext` with a fresh random 12-byte IV. Output shape is
 * `base64url(iv):base64url(authTag):base64url(ciphertext)` — a single,
 * self-contained string safe to store in a text column, matching this
 * project's existing preference for a single-column signed/encrypted
 * payload over multiple sibling columns (lib/portal-session.ts).
 */
export function encryptSecret(plaintext: string): string {
  const key = readEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((buf) => buf.toString("base64url")).join(":");
}

/** Reverses encryptSecret(). Throws if the key is missing, the ciphertext is
 * malformed, or the auth tag doesn't verify (tampered iv/tag/data). */
export function decryptSecret(ciphertext: string): string {
  const key = readEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext — expected iv:tag:data.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
