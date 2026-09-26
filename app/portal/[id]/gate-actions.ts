"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/client-ip";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";
import { PORTAL_VERIFY_RATE_LIMIT, SEND_TOKEN_RATE_LIMIT } from "@/lib/rate-limit";
import { ACCESS_CODE_LENGTH, isWellFormedAccessCode } from "@/lib/portal-access-code";
import { issueAccessToken, verifyAccessCode } from "@/lib/portal-access-token";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";

// Sprint 12, Ticket 62 (R7 hardening). These two server actions are the buyer
// portal's entire front door, and until this ticket neither had a rate limit
// of any kind -- the REST twin (app/api/auth/send-token/route.ts) got one in
// Sprint 8, while the form action beside it, a stable POST endpoint any
// script can replay, got none. Both are anonymous, so the budget is keyed by
// caller IP (lib/client-ip.ts) and counted in the shared store
// (lib/rate-limit-durable.ts), not per instance.
//
// Neither refusal is visible to the caller: an over-budget request redirects
// byte-identically to a successful one, and an over-budget verification gives
// the same sentence a wrong code gives. A rate limiter that announces itself
// is a probe for "does this deal room exist / is this email approved".
const VERIFY_FAILURE_MESSAGE = "Incorrect or expired code.";
const CODE_FORMAT_MESSAGE = `Enter the ${ACCESS_CODE_LENGTH}-digit code from your email.`;

async function callerIp(): Promise<string> {
  return clientIp(await headers());
}

export async function requestAccess(workspaceId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    redirect(`/portal/${workspaceId}?error=${encodeURIComponent("Enter your email.")}`);
  }

  // issueAccessToken silently no-ops for an unknown workspace or an
  // unapproved email, and an over-budget caller skips it entirely --
  // redirect the same way regardless, so we never leak which it was.
  const { allowed } = await checkDurableRateLimit(
    `portal-request:ip:${await callerIp()}`,
    SEND_TOKEN_RATE_LIMIT,
  );
  if (allowed) {
    await issueAccessToken(workspaceId, email);
  }

  redirect(`/portal/${workspaceId}?stage=verify&email=${encodeURIComponent(email)}`);
}

export async function verifyAccess(workspaceId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();

  const failVerify = (message: string) => {
    redirect(
      `/portal/${workspaceId}?stage=verify&email=${encodeURIComponent(email)}&error=${encodeURIComponent(message)}`,
    );
  };

  // Shape check first, for free: a submission that cannot be a code should
  // cost neither a database round trip nor one of this buyer's hourly
  // attempts. It says what to type, because the problem is the typing -- it
  // reveals nothing about the server's state, unlike every message below.
  if (!email || !isWellFormedAccessCode(token)) {
    failVerify(CODE_FORMAT_MESSAGE);
    return;
  }

  const { allowed } = await checkDurableRateLimit(
    `portal-verify:ip:${await callerIp()}`,
    PORTAL_VERIFY_RATE_LIMIT,
  );
  if (!allowed) {
    failVerify(VERIFY_FAILURE_MESSAGE);
    return;
  }

  if ((await verifyAccessCode(workspaceId, email, token)) !== "verified") {
    failVerify(VERIFY_FAILURE_MESSAGE);
    return;
  }

  const supabase = createAdminClient();

  // Engagement signal for the seller dashboard (Ticket 20), written HERE —
  // gate entry, once per successful verification — rather than during
  // app/portal/[id]/page.tsx's render (T34-4). An RSC render can re-run,
  // which made the old render-time write an occasional duplicate; this
  // matches /view/[id]/gate-actions.ts's enterView, which has always fired
  // portal_view exactly once, at the same lifecycle point. Service-role
  // write — buyers have no Supabase Auth session and bypass RLS, per the
  // portal model. Best-effort: a failed insert must not block the buyer's
  // entry.
  const { error: viewError } = await supabase
    .from("workspace_analytics")
    .insert({ workspace_id: workspaceId, buyer_email: email, action_type: "portal_view" });
  if (viewError) {
    console.error("[portal verifyAccess portal_view] analytics insert failed:", viewError);
  }

  // Signed, workspace-scoped session cookie (Sprint 1 primitive). Path "/" — not
  // /portal/[id] — so the SAME cookie is sent to /api/track when the buyer clicks
  // a resource link, and later to /api/steps/[id]/complete.
  const { value, expiresAt } = createPortalSessionValue(workspaceId, email);
  const cookieStore = await cookies();
  cookieStore.set(portalCookieName(workspaceId), value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  redirect(`/portal/${workspaceId}`);
}
