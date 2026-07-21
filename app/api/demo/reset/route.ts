import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_TENANT_ID } from "@/lib/demo";

// Sandbox reset (Sprint 4, Ticket 21). Purges everything the demo loop creates
// so back-to-back pitches start clean — but ONLY for the seeded demo tenant.
//
// Tenant isolation is P0: every delete is scoped by DEMO_TENANT_ID (directly,
// or by the set of workspace ids belonging to it). Real tenants are never
// touched. The demo tenant row and the demo AE user are intentionally KEPT so
// the seed (Ticket 17) stays valid — only per-pitch data (workspaces, their
// links, their analytics) is removed. Idempotent and safe to spam.
export async function POST() {
  const supabase = createAdminClient();

  // 1. The demo tenant's workspace ids — the anchor for the scoped deletes.
  const { data: workspaces, error: wsErr } = await supabase
    .from("workspaces")
    .select("id")
    .eq("tenant_id", DEMO_TENANT_ID);
  if (wsErr) {
    return NextResponse.json({ success: false, message: wsErr.message }, { status: 500 });
  }

  const ids = (workspaces ?? []).map((w) => w.id);
  if (ids.length === 0) {
    return NextResponse.json({ success: true, workspaces_deleted: 0, links_deleted: 0, events_deleted: 0 });
  }

  // 2. Delete children first (FKs: links → workspaces has no cascade; analytics
  //    → workspaces cascades, but we delete explicitly to report a count and to
  //    not depend on cascade semantics), then the workspaces themselves.
  const { count: events_deleted } = await supabase
    .from("workspace_analytics")
    .delete({ count: "exact" })
    .in("workspace_id", ids);
  const { count: links_deleted } = await supabase
    .from("links")
    .delete({ count: "exact" })
    .in("workspace_id", ids);
  const { count: workspaces_deleted, error: delErr } = await supabase
    .from("workspaces")
    .delete({ count: "exact" })
    .eq("tenant_id", DEMO_TENANT_ID);
  if (delErr) {
    return NextResponse.json({ success: false, message: delErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    workspaces_deleted: workspaces_deleted ?? ids.length,
    links_deleted: links_deleted ?? 0,
    events_deleted: events_deleted ?? 0,
  });
}
