"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSeller } from "@/lib/plans/require-seller";
import { isEmailApproved } from "@/lib/portal-access";
import { issueAccessTokenForInvite } from "@/lib/portal-access-token";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";
import type { SendInviteState } from "./invite-state";

// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"). Lets a
// seller send a portal invite to ANY email address (including their own
// inbox) and then flip in one click into the REAL buyer portal at
// /portal/[id] — no simulated preview. Deliberately reuses the existing
// workspaces.approved_emails whitelist column (0001) rather than a new
// table/migration: "invite this email" is just "add it to this workspace's
// whitelist, then run the normal Security Gate send path"
// (lib/portal-access-token.ts's issueAccessTokenForInvite, T43).
//
// Both exported actions call requireSeller() as their first line (T28-9's
// contract; statically enforced by tests/security/server-action-auth.spec.ts)
// and touch ONLY seller.client (RLS-scoped) — never the service-role admin
// client — so a seller can invite into, or flip into, only workspaces in
// their own tenant. The "AE manages own tenant workspaces" RLS policy (0001)
// is what actually blocks a cross-tenant workspaceId, the same reliance
// links-actions.ts and chat-url-actions.ts already place on it — there is no
// second, explicit tenant_id check in this file.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
const WORKSPACE_NOT_FOUND_MESSAGE = "Couldn't find this workspace.";
const SEND_FAILED_MESSAGE = "Couldn't send the invite email. Try again in a moment.";
const RATE_LIMITED_MESSAGE = "This workspace reached its invite limit for now. Try again in an hour.";

function normalizeEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

function isPlausibleEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

const FALLBACK_ORIGIN = "https://getbrava.io";

/**
 * `/portal/[id]`'s absolute URL for the invite email's "Open your deal room"
 * link. Security review (T43): forwarded headers are client-influenceable on
 * deployments where no edge proxy overwrites them, and this URL is emailed to
 * a third party — a poisoned host would produce a credible phishing link
 * carried by our own sending identity. So a deploy-configured origin
 * (NEXT_PUBLIC_APP_URL) wins when present; headers are only a dev/preview
 * convenience fallback, and whatever origin results must survive `new URL`
 * with an http(s) scheme or we fall back to the production origin — a real,
 * working link, never a malformed or attacker-shaped one.
 */
async function buildPortalUrl(workspaceId: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = configured?.trim() || (await headerDerivedOrigin());
  return `${sanitizeOrigin(origin)}/portal/${workspaceId}`;
}

async function headerDerivedOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return host ? `${proto}://${host}` : FALLBACK_ORIGIN;
}

function sanitizeOrigin(candidate: string): string {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return FALLBACK_ORIGIN;
    return url.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

// SendInviteState / INITIAL_SEND_INVITE_STATE moved to ./invite-state.ts —
// a "use server" file may only export async functions, and the object export
// crashed every invite submit at runtime in production builds (T44 finding;
// see invite-state.ts's header).

/**
 * useActionState-shaped once `workspaceId` is bound: `sendBuyerInvite.bind(null, workspaceId)`
 * produces a `(previousState, formData) => Promise<SendInviteState>` function —
 * exactly the signature React 19's `useActionState` expects for its `action`
 * argument — mirroring links-actions.ts's `addLink(workspaceId, formData)`
 * bound-first-arg idiom together with plan-details-form.tsx's
 * useActionState result-state convention.
 */
export async function sendBuyerInvite(
  workspaceId: string,
  _previousState: SendInviteState,
  formData: FormData,
): Promise<SendInviteState> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");

  const email = normalizeEmail(formData.get("email"));
  if (!isPlausibleEmail(email)) {
    return { status: "error", email: null, message: INVALID_EMAIL_MESSAGE };
  }

  const { data: workspace } = await seller.client
    .from("workspaces")
    .select("id, approved_emails, target_domain")
    .eq("id", workspaceId)
    .single();

  // RLS's "AE manages own tenant workspaces" policy already makes a
  // cross-tenant workspaceId return zero rows here, identically to a
  // genuinely nonexistent one — deliberately not distinguished, the same
  // choice links-actions.ts/chat-url-actions.ts make by relying on RLS
  // rather than a second, explicit tenant check.
  if (!workspace) {
    return { status: "error", email: null, message: WORKSPACE_NOT_FOUND_MESSAGE };
  }

  const approvedEmails = workspace.approved_emails ?? [];
  if (!isEmailApproved(email, approvedEmails, workspace.target_domain)) {
    // Immutable: a NEW array, never a mutation of `approvedEmails`. Safe to
    // simply append — isEmailApproved just proved `email` isn't already
    // present (case-insensitively) or covered by the target_domain match —
    // so this can never introduce a duplicate entry. A second invite to the
    // same email later reaches this same isEmailApproved check, finds it
    // already approved, and skips writing entirely (no duplicate, no-op).
    const { error } = await seller.client
      .from("workspaces")
      .update({ approved_emails: [...approvedEmails, email] })
      .eq("id", workspaceId);
    if (error) {
      return { status: "error", email: null, message: SEND_FAILED_MESSAGE };
    }
  }

  const portalUrl = await buildPortalUrl(workspaceId);
  const outcome = await issueAccessTokenForInvite(workspaceId, email, { portalUrl });

  switch (outcome.status) {
    case "sent":
      revalidatePath(`/admin/workspaces/${workspaceId}`);
      return { status: "sent", email: outcome.email, message: `Invite sent to ${outcome.email}.` };
    case "cooldown": {
      const waitSeconds = Math.max(1, Math.ceil(outcome.retryAfterMs / 1000));
      return {
        status: "cooldown",
        email,
        message: `A code was already sent to this address recently — try again in ${waitSeconds}s.`,
      };
    }
    case "rate-limited":
      return { status: "error", email, message: RATE_LIMITED_MESSAGE };
    // "not-approved" should be unreachable here — the whitelist write above
    // just made this email approved (or it already was) — but a concurrent
    // edit racing this request could still produce it. Treated the same as
    // any other failed send: the UI has no meaningful separate action to
    // offer for either.
    case "not-approved":
    case "send-failed":
      return { status: "error", email, message: SEND_FAILED_MESSAGE };
  }
}

const PORTAL_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

/**
 * One-click flip from the admin workspace page into the REAL buyer portal —
 * no simulated preview. Deliberately skips the Security Gate's code-entry
 * flow entirely: the caller already IS an authenticated seller who has just
 * been proven, via RLS, to own this workspace, and the target email must
 * already be on the workspace's approved list (normally just added by
 * sendBuyerInvite above). That is treated as sufficient proof to mint the
 * same signed portal-session cookie verifyAccess
 * (app/portal/[id]/gate-actions.ts) mints after a successful code check.
 */
export async function flipToBuyerView(workspaceId: string, formData: FormData): Promise<void> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");

  const email = normalizeEmail(formData.get("email"));

  const { data: workspace } = await seller.client
    .from("workspaces")
    .select("id, approved_emails, target_domain")
    .eq("id", workspaceId)
    .single();

  // Same isEmailApproved check sendBuyerInvite uses — including the
  // target_domain match — NOT a bare whitelist-membership test. Review
  // finding (T43): sendBuyerInvite deliberately skips the whitelist append
  // for a domain-approved address, so a literal-membership check here made
  // the flip silently refuse the most common approval path (buyer email on
  // the workspace's own target domain) right after the invite reported sent.
  const isApproved =
    !!workspace && isEmailApproved(email, workspace.approved_emails ?? [], workspace.target_domain);

  if (!workspace || !email || !isApproved) {
    // Refuses without minting a cookie. Deliberately the SAME redirect shape
    // regardless of which check failed (missing workspace via RLS, or an
    // email that was never whitelisted) — the same "don't distinguish why"
    // choice sendBuyerInvite's workspace lookup makes above, so this can
    // never become an approved-email enumeration oracle either.
    redirect(`/admin/workspaces/${workspaceId}`);
  }

  const { value, expiresAt } = createPortalSessionValue(workspaceId, email);
  const cookieStore = await cookies();
  cookieStore.set(portalCookieName(workspaceId), value, {
    ...PORTAL_SESSION_COOKIE_OPTIONS,
    expires: expiresAt,
  });

  // Deliberately NO workspace_analytics `portal_view` insert here, unlike
  // verifyAccess's real-buyer gate entry (app/portal/[id]/gate-actions.ts,
  // lines ~77-82). A seller flipping into their own deal room via this
  // one-click shortcut is not buyer engagement — writing a portal_view row
  // here would pollute the stall-alert and forecast signals (Ticket 36)
  // that treat portal_view as evidence the BUYER actually showed up.

  redirect(`/portal/${workspaceId}`);
}
