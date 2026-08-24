import { hkdfSync } from "node:crypto";

// Sprint 10, Ticket 52 code-review fix (MEDIUM) — key separation via HKDF.
// lib/encrypt-secret.ts (AES-256-GCM, HubSpot refresh-token ciphertext) and
// lib/hubspot/oauth-state.ts (HMAC, OAuth `state` signing) both used to key
// off APP_ENCRYPTION_KEY directly, raw — the exact same bytes doing two
// cryptographically different jobs. A single env var still configures the
// app (no new secret to provision/rotate), but each consumer now derives
// its own INDEPENDENT subkey via HKDF-SHA256, scoped by a distinct `info`
// string: a weakness discovered in one derived use (e.g. some future HMAC
// oracle against oauth-state.ts) can no longer be leveraged against the
// other (the AES key actually protecting the refresh token), and vice
// versa. Safe to introduce with no migration/rotation step: no ciphertext
// exists anywhere yet under the old raw-key scheme (dev's crm_connections
// table is empty; nothing has shipped to prod).

const APP_ENCRYPTION_KEY_HEX_LENGTH = 64; // 32 bytes, hex-encoded.
const HKDF_DIGEST = "sha256";
// HKDF's `salt` is optional entropy separate from the input key material.
// APP_ENCRYPTION_KEY is already a full-entropy, 32-byte secret (validated
// below), so an empty salt loses nothing here — `info` is what actually
// separates the two derived subkeys from each other and from the master key.
const EMPTY_SALT = Buffer.alloc(0);

// Read lazily, inside the function, not cached at module load — mirrors
// this module's two callers' own prior precedent (each read
// process.env.APP_ENCRYPTION_KEY lazily before this extraction) and
// lib/portal-session.ts's PORTAL_SESSION_SECRET reads, so a missing key
// fails loud at first USE rather than crashing every import of a module
// that transitively imports this one.
function readAppEncryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length !== APP_ENCRYPTION_KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not configured — expected a 64-character hex string " +
        "(generate with `openssl rand -hex 32`). See docs/environments.md.",
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Derives an independent `keyLengthBytes`-byte subkey from APP_ENCRYPTION_KEY
 * via HKDF-SHA256, scoped to `info`. Deterministic: the same (master key,
 * info, length) always derives the same subkey — callers rely on this for
 * decrypt/verify to work at all. Two different `info` strings always
 * produce two unrelated subkeys from the same master key — see this file's
 * header for why that separation matters.
 */
export function deriveSubkey(info: string, keyLengthBytes: number): Buffer {
  const masterKey = readAppEncryptionKey();
  const derived = hkdfSync(HKDF_DIGEST, masterKey, EMPTY_SALT, info, keyLengthBytes);
  return Buffer.from(derived);
}
