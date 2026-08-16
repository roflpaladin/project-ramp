import { createHash, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailApproved } from "@/lib/portal-access";
import { sendAccessCodeEmail } from "@/lib/email/send-access-code";

export const TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes
export const MAX_ATTEMPTS = 5;

// Skip issuing (and emailing) a new code if one was requested for this
// email/workspace within the last minute -- keeps a buyer double-clicking
// "resend" from burning free-tier send quota or spamming their own inbox.
const RESEND_COOLDOWN_MS = 1000 * 60;

export function hashToken(token: string, workspaceId: string, email: string): string {
  return createHash("sha256").update(`${token}.${workspaceId}.${email}`).digest("hex");
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

  const { data: recent } = await supabase
    .from("portal_access_tokens")
    .select("id, created_at")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const elapsedMs = Date.now() - new Date(recent.created_at).getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return { status: "cooldown", retryAfterMs: RESEND_COOLDOWN_MS - elapsedMs };
    }
  }

  const token = String(randomInt(0, 10000)).padStart(4, "0");

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
// token issuance, not two. Always resolves -- never throws -- and never
// reveals *why* nothing was sent (workspace missing, email not approved,
// cooldown active, or a send failure) so every call site can return the
// same uniform response regardless of outcome, avoiding whitelist
// enumeration.
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
