import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveSubkey } from "@/lib/app-encryption-key";
import { isEmailApproved } from "@/lib/portal-access";
import { ACCESS_CODE_LENGTH, isWellFormedAccessCode } from "@/lib/portal-access-code";
import { sendAccessCodeEmail } from "@/lib/email/send-access-code";

export const TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes
export const MAX_ATTEMPTS = 5;

// Skip issuing (and emailing) a new code if one was requested for this
// email/workspace within the last minute -- keeps a buyer double-clicking
// "resend" from burning free-tier send quota or spamming their own inbox.
const RESEND_COOLDOWN_MS = 1000 * 60;

// Sprint 12, Ticket 62 (R7). The stored value used to be a bare
// sha256("<code>.<workspaceId>.<email>"). Every input of that digest is
// either public (the workspace id, the buyer's address -- both already in the
// same row, in plaintext) or drawn from a keyspace a laptop exhausts
// instantly, so a leaked portal_access_tokens table reversed to live codes in
// milliseconds. An HMAC keyed by a secret that is NOT in the database removes
// that offline attack entirely: without APP_ENCRYPTION_KEY the table is just
// noise. Own HKDF subkey, scoped by its own `info` string, exactly as
// lib/hubspot/oauth-state.ts does -- see lib/app-encryption-key.ts's header
// for why two HMAC users must never share raw key bytes.
//
// DEPLOY NOTE (accepted): codes issued under the old scheme stop verifying
// the moment this ships. They live at most TOKEN_TTL_MS (15 minutes), the
// gate's own "request a new code" path is right there, and no migration or
// dual-read window is worth carrying for a 15-minute artefact.
const CODE_HMAC_KEY_BYTES = 32;
const CODE_HKDF_INFO = "portal-access-code-hmac";

/**
 * Keyed digest stored in portal_access_tokens.token_hash. Name and signature
 * are unchanged from the pre-T62 sha256 version, so existing callers and the
 * e2e fixtures that reconstruct it keep compiling; only the algorithm moved.
 * Throws (via deriveSubkey) when APP_ENCRYPTION_KEY is missing or malformed
 * -- a misconfigured deployment must fail loudly, never silently fall back to
 * an unkeyed hash.
 */
export function hashToken(token: string, workspaceId: string, email: string): string {
  const key = deriveSubkey(CODE_HKDF_INFO, CODE_HMAC_KEY_BYTES);
  return createHmac("sha256", key).update(`${token}.${workspaceId}.${email}`).digest("hex");
}

/**
 * Constant-time comparison of two hex digests. `timingSafeEqual` throws on a
 * length mismatch, so that case is answered first -- and it is a real case:
 * rows written by fixtures (and any pre-T62 row) can hold a value that is not
 * 32 bytes of hex at all, which must read as "no match", never as a crash.
 */
function hashesMatch(expectedHex: string, storedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const stored = Buffer.from(storedHex, "hex");
  if (expected.length === 0 || expected.length !== stored.length) return false;
  return timingSafeEqual(expected, stored);
}

// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"). The
// seller-invite flow (app/admin/workspaces/[id]/invite-actions.ts) needs to
// know WHY nothing was sent -- a seller who just clicked "send invite"
// deserves "we're sending you codes too fast" rather than dead silence --
// while issueAccessToken()'s two existing callers (the buyer-facing gate
// form and the send-token API route) must keep never revealing that, to
// avoid an approved-email enumeration oracle. One core implementation
// (issueAccessTokenCore) computes and returns the real outcome; issueAccessToken
// keeps its exact original public contract by discarding everything the core
// function learned.
interface CoreIssueOutcome {
  readonly status: "sent" | "cooldown" | "not-approved" | "send-failed";
  readonly retryAfterMs?: number;
}

async function issueAccessTokenCore(
  workspaceId: string,
  email: string,
  options?: { portalUrl?: string },
): Promise<CoreIssueOutcome> {
  const supabase = createAdminClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("target_domain, approved_emails")
    .eq("id", workspaceId)
    .single();

  if (!workspace || !isEmailApproved(email, workspace.approved_emails ?? [], workspace.target_domain)) {
    return { status: "not-approved" };
  }

  // T62: the cooldown deliberately looks at the newest row REGARDLESS of
  // consumed_at. It used to filter `.is("consumed_at", null)`, which meant a
  // successful verification (which sets consumed_at) instantly cleared the
  // cooldown -- so a verified buyer, or anyone holding a verified session's
  // email, could mint a fresh code every request in a loop. Issuance is an
  // outbound email and a write; it is rate limited by wall clock, not by what
  // happened to the previous code.
  const { data: recent } = await supabase
    .from("portal_access_tokens")
    .select("id, created_at")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const elapsedMs = Date.now() - new Date(recent.created_at).getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return { status: "cooldown", retryAfterMs: RESEND_COOLDOWN_MS - elapsedMs };
    }
  }

  // crypto.randomInt is a CSPRNG (unbiased over the range); the LENGTH is
  // what T62 changed -- see lib/portal-access-code.ts. padStart keeps
  // leading-zero codes (e.g. 000042) exactly ACCESS_CODE_LENGTH characters.
  const token = String(randomInt(0, 10 ** ACCESS_CODE_LENGTH)).padStart(ACCESS_CODE_LENGTH, "0");

  await supabase.from("portal_access_tokens").insert({
    workspace_id: workspaceId,
    email,
    token_hash: hashToken(token, workspaceId, email),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });

  const sendResult = await sendAccessCodeEmail({ to: email, code: token, portalUrl: options?.portalUrl });
  return sendResult.ok ? { status: "sent" } : { status: "send-failed" };
}

// Shared by the portal gate form action (gate-actions.ts) and the
// POST /api/auth/send-token route so there's one implementation of
// token issuance, not two. Never reveals *why* nothing was sent (workspace
// missing, email not approved, cooldown active, or a send failure) so every
// call site can return the same uniform response regardless of outcome,
// avoiding whitelist enumeration.
//
// T62 narrowed "never throws" to "never throws over an outcome": a missing or
// malformed APP_ENCRYPTION_KEY now propagates out of hashToken. That is a
// deployment misconfiguration, identical for every caller and every email, so
// it leaks nothing -- and failing loudly beats writing codes nobody can ever
// verify.
export async function issueAccessToken(workspaceId: string, email: string): Promise<void> {
  await issueAccessTokenCore(workspaceId, email);
}

// Security review (T43): the invite action is the first surface that lets an
// authenticated-but-not-fully-trusted actor (a seller) make the product email
// arbitrary third parties on demand. The per-(workspace, email) cooldown above
// doesn't bound DISTINCT recipients, so without a cap one seller account could
// use our sending identity as a spam/phishing relay. Applied only on the
// invite path -- rate limiting the anonymous gate/route is Session A's T39
// scope, and that path's uniform-response contract must not change here.
export const INVITE_ISSUANCE_WINDOW_MS = 1000 * 60 * 60; // 1 hour
export const INVITE_ISSUANCE_CAP_PER_WORKSPACE = 30;

async function isInviteIssuanceCapped(workspaceId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const windowStart = new Date(Date.now() - INVITE_ISSUANCE_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("portal_access_tokens")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", windowStart);
  return (count ?? 0) >= INVITE_ISSUANCE_CAP_PER_WORKSPACE;
}

/**
 * T43. `sent` carries the invited email back so the invite form can offer
 * an immediate "flip into the portal" action without re-deriving it.
 * `cooldown` carries a retry-after hint (cheap -- issueAccessTokenCore
 * already computed the elapsed time) so the UI can show real wait copy
 * instead of a generic "try later". Unlike issueAccessToken, this is used
 * from an authenticated seller's own invite action, not an anonymous buyer
 * form, so revealing the real outcome here is not an enumeration risk.
 * `rate-limited` (checked before any token is written) is the per-workspace
 * hourly cap documented above isInviteIssuanceCapped.
 */
export type InviteIssueResult =
  | { readonly status: "sent"; readonly email: string }
  | { readonly status: "cooldown"; readonly retryAfterMs: number }
  | { readonly status: "not-approved" }
  | { readonly status: "send-failed" }
  | { readonly status: "rate-limited" };

export async function issueAccessTokenForInvite(
  workspaceId: string,
  email: string,
  options?: { portalUrl?: string },
): Promise<InviteIssueResult> {
  if (await isInviteIssuanceCapped(workspaceId)) {
    return { status: "rate-limited" };
  }

  const outcome = await issueAccessTokenCore(workspaceId, email, options);

  switch (outcome.status) {
    case "sent":
      return { status: "sent", email };
    case "cooldown":
      return { status: "cooldown", retryAfterMs: outcome.retryAfterMs ?? RESEND_COOLDOWN_MS };
    case "not-approved":
      return { status: "not-approved" };
    case "send-failed":
      return { status: "send-failed" };
  }
}

// ---------------------------------------------------------------------------
// Verification (Sprint 12, Ticket 62)
// ---------------------------------------------------------------------------
//
// The guessing budget used to live entirely on the token ROW
// (portal_access_tokens.attempts, capped at MAX_ATTEMPTS = 5). Since a new
// row could be requested every RESEND_COOLDOWN_MS and verification always
// picks the newest unconsumed one, every fresh code handed the attacker five
// fresh guesses: ~5 guesses a minute, forever, against 10,000 codes -- about
// a 72% chance of walking into a given deal room within a day.
//
// So the budget is now ALSO durable per (workspace, email), summed across
// rows inside a rolling window, using the columns the table already has (no
// migration): 10 guesses an hour against 1,000,000 codes is ~0.024% per day.
// The per-row MAX_ATTEMPTS stays as well -- it is what stops one long-lived
// code from absorbing the whole hourly budget by itself.
export const VERIFY_ATTEMPT_WINDOW_MS = 60 * 60_000; // 1 hour
export const MAX_VERIFY_ATTEMPTS_PER_WINDOW = 10;

const TOKENS_TABLE = "portal_access_tokens";

// Uniform-work decoy (see verifyAccessCode). A nil-ish UUID no
// gen_random_uuid() will ever produce, so the update matches zero rows and
// changes nothing; it exists only to cost the same round trip the
// wrong-code branch costs.
const NO_MATCH_SENTINEL_ID = "00000000-0000-4000-8000-000000000000";

type AdminClient = ReturnType<typeof createAdminClient>;

interface PendingToken {
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly attempts: number;
}

/** Supabase hands back untyped JSON; anything that is not a finite number
 *  counts as zero attempts rather than poisoning the arithmetic with NaN. */
function toAttempts(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function isVerifyAttemptCapReached(
  supabase: AdminClient,
  workspaceId: string,
  email: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - VERIFY_ATTEMPT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from(TOKENS_TABLE)
    .select("attempts")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .gte("created_at", windowStart);

  if (error) {
    // Fail CLOSED: if the budget cannot be read, the budget cannot be
    // enforced, and an unenforceable cap is exactly the hole this closes.
    console.error("[portal verify] attempt-cap read failed:", error);
    return true;
  }

  // A multi-row select answers with an array, or with `error` set (handled
  // above). The guard is a shape check on untrusted JSON, not a policy
  // branch: "not an array" is read as "no rows in the window".
  const rows: readonly { readonly attempts?: unknown }[] = Array.isArray(data) ? data : [];
  const spent = rows.reduce((total, row) => total + toAttempts(row.attempts), 0);
  return spent >= MAX_VERIFY_ATTEMPTS_PER_WINDOW;
}

async function readNewestPendingToken(
  supabase: AdminClient,
  workspaceId: string,
  email: string,
): Promise<PendingToken | null> {
  const { data, error } = await supabase
    .from(TOKENS_TABLE)
    .select("id, token_hash, expires_at, attempts")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[portal verify] candidate read failed:", error);
    return null;
  }
  if (!data) return null;

  return {
    id: String(data.id),
    tokenHash: String(data.token_hash ?? ""),
    expiresAt: String(data.expires_at ?? ""),
    attempts: toAttempts(data.attempts),
  };
}

function isUsable(token: PendingToken): boolean {
  return new Date(token.expiresAt).getTime() >= Date.now() && token.attempts < MAX_ATTEMPTS;
}

/** One write-shaped round trip that changes nothing -- see verifyAccessCode. */
async function burnUniformRoundTrip(supabase: AdminClient): Promise<void> {
  const { error } = await supabase
    .from(TOKENS_TABLE)
    .update({ attempts: 0 })
    .eq("id", NO_MATCH_SENTINEL_ID);
  if (error) {
    console.error("[portal verify] uniform-work round trip failed:", error);
  }
}

async function recordFailedAttempt(supabase: AdminClient, token: PendingToken): Promise<void> {
  const { error } = await supabase
    .from(TOKENS_TABLE)
    .update({ attempts: token.attempts + 1 })
    .eq("id", token.id);
  if (error) {
    console.error("[portal verify] attempt increment failed:", error);
  }
}

async function consumeToken(supabase: AdminClient, token: PendingToken): Promise<boolean> {
  const { error } = await supabase
    .from(TOKENS_TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id);
  if (error) {
    // Fail CLOSED: an unconsumed row is a replayable code. Better one buyer
    // retries than a code that stays live after it was used.
    console.error("[portal verify] consuming the token failed:", error);
    return false;
  }
  return true;
}

export type VerifyAccessCodeResult = "verified" | "rejected";

/**
 * The buyer gate's code check, kept here with the rest of the
 * portal_access_tokens data access rather than inline in the server action.
 * Every failure -- malformed code, capped budget, missing row, expired row,
 * locked row, wrong code, failed write -- returns the SAME "rejected", so the
 * caller has nothing to accidentally turn into an oracle.
 *
 * Work done per path is kept as even as is reasonable: the code is hashed
 * before any read (so the HMAC cost, and a missing-key throw, are identical
 * whether or not a row exists), and the no-candidate branch spends the same
 * write-shaped round trip the wrong-code branch spends. Two paths are
 * deliberately shorter: a malformed code (no database contact at all -- it
 * cannot match anything, and refusing it for free is the point) and an
 * already-capped caller (they created that state themselves, so its timing
 * tells them nothing they did not already know).
 */
export async function verifyAccessCode(
  workspaceId: string,
  email: string,
  code: string,
): Promise<VerifyAccessCodeResult> {
  if (!isWellFormedAccessCode(code)) return "rejected";

  const submittedHash = hashToken(code, workspaceId, email);
  const supabase = createAdminClient();

  if (await isVerifyAttemptCapReached(supabase, workspaceId, email)) return "rejected";

  const candidate = await readNewestPendingToken(supabase, workspaceId, email);
  if (!candidate || !isUsable(candidate)) {
    await burnUniformRoundTrip(supabase);
    return "rejected";
  }

  if (!hashesMatch(submittedHash, candidate.tokenHash)) {
    await recordFailedAttempt(supabase, candidate);
    return "rejected";
  }

  return (await consumeToken(supabase, candidate)) ? "verified" : "rejected";
}
