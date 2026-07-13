import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, httpOnly cookie proving a buyer passed the Security Gate for one
// specific workspace. Not a Supabase Auth session — buyers never get one —
// so this is a small hand-rolled equivalent scoped to a single workspace_id.
//
// Also carries the verified buyer email (base64url-encoded so it can't
// collide with the "." field separator), so server-side consumers like
// /api/track (Sprint 2, Ticket 11) can derive buyer_email from the signed
// session instead of trusting a client-supplied value.

const COOKIE_PREFIX = "portal_session_";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function sign(workspaceId: string, email: string, expiresAt: number): string {
  const secret = process.env.PORTAL_SESSION_SECRET!;
  const emailB64 = Buffer.from(email).toString("base64url");
  const payload = `${workspaceId}.${emailB64}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function portalCookieName(workspaceId: string): string {
  return `${COOKIE_PREFIX}${workspaceId}`;
}

export function createPortalSessionValue(
  workspaceId: string,
  email: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { value: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs;
  return { value: sign(workspaceId, email, expiresAtMs), expiresAt: new Date(expiresAtMs) };
}

export function verifyPortalSessionValue(
  workspaceId: string,
  cookieValue: string | undefined,
): { email: string } | null {
  if (!cookieValue) return null;

  const [id, emailB64, expiresAtStr, signature] = cookieValue.split(".");
  if (id !== workspaceId || !emailB64 || !expiresAtStr || !signature) return null;

  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  const expectedSignature = createHmac("sha256", process.env.PORTAL_SESSION_SECRET!)
    .update(`${id}.${emailB64}.${expiresAtStr}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { email: Buffer.from(emailB64, "base64url").toString() };
}
