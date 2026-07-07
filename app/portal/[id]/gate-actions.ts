"use server";

import { createHash, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailApproved } from "@/lib/portal-access";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";

const TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes
const MAX_ATTEMPTS = 5;

function hashToken(token: string, workspaceId: string, email: string): string {
  return createHash("sha256").update(`${token}.${workspaceId}.${email}`).digest("hex");
}

export async function requestAccess(workspaceId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    redirect(`/portal/${workspaceId}?error=${encodeURIComponent("Enter your email.")}`);
  }

  const supabase = createAdminClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("target_domain, approved_emails")
    .eq("id", workspaceId)
    .single();

  // Same rejection whether the workspace doesn't exist or the email isn't
  // approved — don't leak which one it was.
  if (!workspace || !isEmailApproved(email, workspace.approved_emails ?? [], workspace.target_domain)) {
    redirect(`/portal/${workspaceId}?error=${encodeURIComponent("That email isn't approved for this deal room.")}`);
  }

  const token = String(randomInt(0, 10000)).padStart(4, "0");

  await supabase.from("portal_access_tokens").insert({
    workspace_id: workspaceId,
    email,
    token_hash: hashToken(token, workspaceId, email),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });

  // Stub: no email provider wired up yet (Sprint 1 decision — ship the real
  // whitelist/token/verify flow now, add a provider like Resend later).
  console.log(`[portal-access] code for ${email} / workspace ${workspaceId}: ${token}`);

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

  const { value, expiresAt } = createPortalSessionValue(workspaceId);
  const cookieStore = await cookies();
  cookieStore.set(portalCookieName(workspaceId), value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: expiresAt,
    path: `/portal/${workspaceId}`,
  });

  redirect(`/portal/${workspaceId}`);
}
