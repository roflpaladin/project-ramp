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

// Shared by the portal gate form action (gate-actions.ts) and the
// POST /api/auth/send-token route so there's one implementation of
// token issuance, not two. Always resolves -- never throws -- and never
// reveals *why* nothing was sent (workspace missing, email not approved,
// cooldown active, or a send failure) so every call site can return the
// same uniform response regardless of outcome, avoiding whitelist
// enumeration.
export async function issueAccessToken(workspaceId: string, email: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("target_domain, approved_emails")
    .eq("id", workspaceId)
    .single();

  if (!workspace || !isEmailApproved(email, workspace.approved_emails ?? [], workspace.target_domain)) {
    return;
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

  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return;
  }

  const token = String(randomInt(0, 10000)).padStart(4, "0");

  await supabase.from("portal_access_tokens").insert({
    workspace_id: workspaceId,
    email,
    token_hash: hashToken(token, workspaceId, email),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });

  await sendAccessCodeEmail({ to: email, code: token });
}
