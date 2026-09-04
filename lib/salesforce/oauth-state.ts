import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveSubkey } from "@/lib/app-encryption-key";

// Sprint 11, Ticket 55 — signed `state` param for the Salesforce OAuth
// authorize redirect (app/api/integrations/salesforce/oauth/start/route.ts),
// verified by .../oauth/callback/route.ts. Byte-for-byte the same shape and
// purpose as lib/hubspot/oauth-state.ts (that file's header is the canonical
// explanation of the design — HMAC payload, single "." separated, hex
// signature, timingSafeEqual comparison, 10-minute TTL) — repeated here as a
// SEPARATE module, not a shared one, for one deliberate reason: the HMAC
// subkey below is derived with its OWN, DISTINCT HKDF info string
// ("salesforce-oauth-state-hmac", vs HubSpot's "oauth-state-hmac"). A state
// value signed for one provider's OAuth flow must never verify as valid for
// the other's — sharing the subkey would make that true by coincidence
// rather than by design, and this ticket's brief calls it out explicitly as
// a requirement, not an optimization to defer.

const TTL_MS = 10 * 60_000; // 10 minutes — long enough for a user to complete Salesforce's own consent screen.
const HMAC_KEY_BYTES = 32;
const HKDF_INFO = "salesforce-oauth-state-hmac";

function readSigningKey(): Buffer {
  return deriveSubkey(HKDF_INFO, HMAC_KEY_BYTES);
}

function sign(tenantId: string, expiresAt: number): string {
  const payload = `${tenantId}.${expiresAt}`;
  const signature = createHmac("sha256", readSigningKey()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/** Produces the opaque `state` value to pass to Salesforce's authorize URL. */
export function signOAuthState(tenantId: string): string {
  return sign(tenantId, Date.now() + TTL_MS);
}

export interface VerifiedOAuthState {
  readonly tenantId: string;
}

/**
 * Verifies a `state` value returned by Salesforce's OAuth callback. Returns
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
