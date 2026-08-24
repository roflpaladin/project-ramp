import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveSubkey } from "@/lib/app-encryption-key";

// Sprint 10, Ticket 52 — signed `state` param for the HubSpot OAuth
// authorize redirect (app/api/integrations/hubspot/oauth/start/route.ts).
// Proves the callback (.../oauth/callback/route.ts) is completing an
// authorization flow WE started for THIS tenant, not a CSRF'd redirect an
// attacker crafted — the standard purpose of OAuth's `state` param, here
// implemented as a small hand-rolled HMAC payload rather than a session
// lookup, mirroring lib/portal-session.ts's shape (single "." separated
// payload + hex HMAC signature, timingSafeEqual comparison) rather than
// introducing a new pattern for one more signed value.
//
// Still ultimately backed by APP_ENCRYPTION_KEY rather than a fourth env
// var (both this and the token cipher exist only to protect this one
// integration's OAuth flow), but T52 code review (MEDIUM) split the two:
// the HMAC key here is now an HKDF subkey (lib/app-encryption-key.ts),
// independent from the AES key lib/encrypt-secret.ts derives for the
// refresh-token ciphertext — see that file's header for why.

const TTL_MS = 10 * 60_000; // 10 minutes — long enough for a user to complete HubSpot's consent screen.
const HMAC_KEY_BYTES = 32;
const HKDF_INFO = "oauth-state-hmac";

function readSigningKey(): Buffer {
  return deriveSubkey(HKDF_INFO, HMAC_KEY_BYTES);
}

function sign(tenantId: string, expiresAt: number): string {
  const payload = `${tenantId}.${expiresAt}`;
  const signature = createHmac("sha256", readSigningKey()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/** Produces the opaque `state` value to pass to HubSpot's authorize URL. */
export function signOAuthState(tenantId: string): string {
  return sign(tenantId, Date.now() + TTL_MS);
}

export interface VerifiedOAuthState {
  readonly tenantId: string;
}

/**
 * Verifies a `state` value returned by HubSpot's OAuth callback. Returns
 * `null` (never throws) on any failure — malformed shape, expired TTL, or a
 * signature that doesn't match — so the callback route can uniformly map
 * every failure mode to the same fixed `?error=` redirect.
 */
export function verifyOAuthState(state: string): VerifiedOAuthState | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [tenantId, expiresAtStr, signature] = parts;
  if (!tenantId || !expiresAtStr || !signature) return null;

  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  let expectedSignature: string;
  try {
    expectedSignature = createHmac("sha256", readSigningKey())
      .update(`${tenantId}.${expiresAtStr}`)
      .digest("hex");
  } catch {
    return null;
  }

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { tenantId };
}
