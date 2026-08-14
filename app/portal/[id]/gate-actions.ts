"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, issueAccessToken, MAX_ATTEMPTS } from "@/lib/portal-access-token";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";

export async function requestAccess(workspaceId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    redirect(`/portal/${workspaceId}?error=${encodeURIComponent("Enter your email.")}`);
  }

  // issueAccessToken silently no-ops for an unknown workspace or an
  // unapproved email -- redirect the same way regardless, so we never leak
  // which one it was.
  await issueAccessToken(workspaceId, email);

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

  if (!email || !token) {
    failVerify("Enter the 4-digit code.");
    return;
  }

  const supabase = createAdminClient();
  const { data: candidate } = await supabase
    .from("portal_access_tokens")
    .select("id, token_hash, expires_at, attempts")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!candidate || new Date(candidate.expires_at).getTime() < Date.now() || candidate.attempts >= MAX_ATTEMPTS) {
    failVerify("Incorrect or expired code.");
    return;
  }

  if (hashToken(token, workspaceId, email) !== candidate.token_hash) {
    await supabase
      .from("portal_access_tokens")
      .update({ attempts: candidate.attempts + 1 })
      .eq("id", candidate.id);
    failVerify("Incorrect or expired code.");
    return;
  }

  await supabase
    .from("portal_access_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", candidate.id);

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
