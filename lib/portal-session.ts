import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, httpOnly cookie proving a buyer passed the Security Gate for one
// specific workspace. Not a Supabase Auth session — buyers never get one —
// so this is a small hand-rolled equivalent scoped to a single workspace_id.

const COOKIE_PREFIX = "portal_session_";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function sign(workspaceId: string, expiresAt: number): string {
  const secret = process.env.PORTAL_SESSION_SECRET!;
  const payload = `${workspaceId}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function portalCookieName(workspaceId: string): string {
  return `${COOKIE_PREFIX}${workspaceId}`;
}

export function createPortalSessionValue(
  workspaceId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { value: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs;
  return { value: sign(workspaceId, expiresAtMs), expiresAt: new Date(expiresAtMs) };
}

export function verifyPortalSessionValue(workspaceId: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;

  const [id, expiresAtStr, signature] = cookieValue.split(".");
  if (id !== workspaceId || !expiresAtStr || !signature) return false;

  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;

  const expectedSignature = createHmac("sha256", process.env.PORTAL_SESSION_SECRET!)
    .update(`${id}.${expiresAtStr}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
