"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_LINKS, DEMO_TENANT_ID } from "@/lib/demo";
import { createPortalSessionValue, portalCookieName } from "@/lib/portal-session";

// ⚠️ DEMO-ONLY hardening — NOT production auth.
// To keep a live pitch frictionless (no SMTP round-trip, no domain-validation
// stumble mid-demo), this gate accepts ANY well-formed "<x>@<y>" string. The
// real buyer Security Gate (domain whitelist + 4-digit magic-link token) is
// untouched at /portal/[id]. This permissive path is reachable ONLY for the
// seeded demo tenant — enforced here and in page.tsx — so it can never be used
// to walk into a real customer's deal room.
const ANY_EMAIL = /^[^\s@]+@[^\s@]+$/;

export async function enterView(workspaceId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!ANY_EMAIL.test(email)) {
    redirect(`/view/${workspaceId}?error=${encodeURIComponent("Enter any email to continue.")}`);
  }

  // Re-assert the demo-tenant scope server-side before writing anything: a
  // forged POST carrying a real workspace_id must not mint a session or log a
  // view against a non-demo tenant.
  const supabase = createAdminClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, tenant_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace || workspace.tenant_id !== DEMO_TENANT_ID) {
    redirect(`/view/${workspaceId}?error=${encodeURIComponent("This deal room is unavailable.")}`);
  }

  // A webhook-provisioned demo workspace has no resources of its own — seed the
  // curated demo deal-room links on first entry so there is something real to
  // click for the pulse (Ticket 20). Idempotent: only seeds when empty. Uses a
  // real column select (not head+count) to test existence — a HEAD+count query
  // can return a misleading 204. Best-effort; failure never blocks entry.
  const { data: existingLinks } = await supabase
    .from("links")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);
  if (!existingLinks || existingLinks.length === 0) {
    const { error: linksError } = await supabase
      .from("links")
      .insert(DEMO_LINKS.map((link) => ({ ...link, workspace_id: workspaceId })));
    if (linksError) {
      console.error("[view demo links] seed failed:", linksError);
    }
  }

  // Engagement signal for the live pulse (Ticket 20). Service-role write —
  // buyers have no Supabase Auth session and bypass RLS, per the portal model.
  // Best-effort: a failed insert must not block the buyer's entry.
  const { error: viewError } = await supabase
    .from("workspace_analytics")
    .insert({ workspace_id: workspaceId, buyer_email: email, action_type: "portal_view" });
  if (viewError) {
    console.error("[view portal_view] analytics insert failed:", viewError);
  }

  // Signed, workspace-scoped session cookie (Sprint 1 primitive). Path "/" — not
  // /view/[id] — so the SAME cookie is sent to /api/track when the buyer clicks
  // a resource link; that is what lets link_click events be logged for the pulse.
  const { value, expiresAt } = createPortalSessionValue(workspaceId, email);
  const cookieStore = await cookies();
  cookieStore.set(portalCookieName(workspaceId), value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  redirect(`/view/${workspaceId}`);
}
