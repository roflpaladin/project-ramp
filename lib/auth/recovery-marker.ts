import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveSubkey } from "@/lib/app-encryption-key";

// Sprint 12, Ticket 65 — "Password Reset Flow". A short-lived signed value
// app/auth/confirm/route.ts sets right after it verifies a real recovery
// link, and app/auth/reset requires before it will change a password.
//
// Why it exists: a verified recovery link leaves the seller with an ordinary
// signed-in session, and Supabase's updateUser({ password }) does not ask
// for the old password. Without this marker, /auth/reset would let ANY
// signed-in browser (a borrowed laptop, a hijacked session) set a new
// password and lock the real owner out. The marker proves "this browser
// clicked a reset link for THIS user in the last few minutes".
//
// Same shape as lib/hubspot/oauth-state.ts (single "." separated payload +
// hex HMAC, timingSafeEqual, HKDF subkey of APP_ENCRYPTION_KEY scoped by its
// own `info`) rather than a new pattern for one more signed value.

export const RECOVERY_MARKER_COOKIE = "brava_recovery";
export const RECOVERY_MARKER_TTL_SECONDS = 15 * 60;

const MS_PER_SECOND = 1000;
const HMAC_KEY_BYTES = 32;
const HKDF_INFO = "password-recovery-marker-hmac";
const MARKER_PART_COUNT = 3;

function signatureFor(payload: string): string {
  const key = deriveSubkey(HKDF_INFO, HMAC_KEY_BYTES);
  return createHmac("sha256", key).update(payload).digest("hex");
}

export function signRecoveryMarker(userId: string): string {
  const expiresAt = Date.now() + RECOVERY_MARKER_TTL_SECONDS * MS_PER_SECOND;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${signatureFor(payload)}`;
}

/**
 * True only for an unexpired marker signed by us for exactly `userId`.
 * Returns false (never throws) on any failure, so callers map every failure
 * mode to the same "request a new link" outcome.
 */
export function verifyRecoveryMarker(marker: string | undefined, userId: string): boolean {
  if (!marker) return false;

  const parts = marker.split(".");
  if (parts.length !== MARKER_PART_COUNT) return false;
  const [markerUserId, expiresAtStr, signature] = parts;
  if (!markerUserId || !expiresAtStr || !signature) return false;
  if (markerUserId !== userId) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  let expectedSignature: string;
  try {
    expectedSignature = signatureFor(`${markerUserId}.${expiresAtStr}`);
  } catch {
    return false;
  }

  const expected = Buffer.from(expectedSignature, "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
