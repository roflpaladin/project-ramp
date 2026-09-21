import "server-only";

// Sprint 12, Ticket 65 — "Password Reset Flow" (security review HIGH-1).
// A durable, instance-independent per-account brake on reset emails.
//
// Why it exists: lib/auth/password-reset.ts mints the recovery link with
// admin.generateLink, which skips GoTrue's own per-user send throttle, and
// lib/rate-limit.ts is in-memory per serverless instance (and keyed on a
// spoofable header until Ticket 62). Without this, an anonymous caller could
// flood one seller's inbox and burn the Resend quota that buyer access-code
// emails share.
//
// How: GoTrue itself stamps `recovery_sent_at` on the user every time a
// recovery link is generated, so that timestamp IS the durable state — no
// table, no migration. Same idea as lib/portal-access-token.ts's DB-backed
// resend cooldown. Both GoTrue behaviours relied on here are pinned live in
// tests/security/password-reset.spec.ts.
//
// The check runs BEFORE generateLink on purpose: generating a second token
// would silently invalidate the link already in the seller's inbox.
//
// Fails OPEN (returns false) when the lookup itself fails: this is a brake,
// not a gate, and failing closed would mean nobody can reset a password
// while the lookup is down. The in-memory limits still apply.

export const RECOVERY_COOLDOWN_SECONDS = 120;

const MS_PER_SECOND = 1000;
const ADMIN_USERS_PATH = "/auth/v1/admin/users";
// `filter` is a substring match; a handful of rows is enough to find the
// exact address among look-alikes (jim+bob@x.com vs bob@x.com).
const LOOKUP_PAGE_SIZE = 50;

interface AdminUserRow {
  readonly email?: string | null;
  readonly recovery_sent_at?: string | null;
}

function isRecent(sentAt: string | null | undefined): boolean {
  if (!sentAt) return false;
  const sentAtMs = Date.parse(sentAt);
  if (!Number.isFinite(sentAtMs)) return false;
  return Date.now() - sentAtMs < RECOVERY_COOLDOWN_SECONDS * MS_PER_SECOND;
}

async function findUserByEmail(email: string): Promise<AdminUserRow | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase admin env vars are not configured");

  const url = new URL(ADMIN_USERS_PATH, supabaseUrl);
  url.searchParams.set("filter", email);
  url.searchParams.set("per_page", String(LOOKUP_PAGE_SIZE));

  const response = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`admin users lookup returned ${response.status}`);

  const body: unknown = await response.json();
  const users = (body as { users?: AdminUserRow[] } | null)?.users ?? [];
  return users.find((user) => user.email?.toLowerCase() === email) ?? null;
}

/** `email` must already be trimmed and lower-cased by the caller. */
export async function isWithinRecoveryCooldown(email: string): Promise<boolean> {
  try {
    const user = await findUserByEmail(email);
    return isRecent(user?.recovery_sent_at);
  } catch (error) {
    // Name/message only — never the email (enumeration record) or the key.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    console.error("[password-reset] cooldown lookup failed; continuing without it:", detail);
    return false;
  }
}
