import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_TENANT_ID } from "@/lib/demo";

// Live Telemetry Pulse (Sprint 4, Ticket 20). Lightweight read the sandbox
// polls to reflect buyer engagement back to the seller in near-real-time.
//
// ⚠️ SCOPE GUARD (P0 — cross-tenant leak risk): as written in the PRD this
// endpoint takes a raw workspace_id and returns analytics, which would let
// anyone read ANY tenant's engagement. It is therefore restricted to the seeded
// demo tenant's workspaces only — a non-demo (real) workspace_id gets a 404 and
// no data. This is the whole reason the demo tenant is clearly labelled
// (Ticket 17). Do not widen this without an auth model.
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, tenant_id, target_domain")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace || workspace.tenant_id !== DEMO_TENANT_ID) {
    // Same response for "not a workspace" and "not a demo workspace" — never
    // confirm the existence of a non-demo tenant's workspace.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // One demo workspace's events — small volume, so fetch all and derive totals
  // (avoids the HEAD+count quirk and keeps counts accurate beyond a page).
  const { data: rows } = await supabase
    .from("workspace_analytics")
    .select("action_type, buyer_email, link_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const events = rows ?? [];

  // Resolve link labels for link_click rows in one query.
  const linkIds = [...new Set(events.map((e) => e.link_id).filter((id): id is string => Boolean(id)))];
  const labelById = new Map<string, string>();
  if (linkIds.length > 0) {
    const { data: links } = await supabase.from("links").select("id, link_label").in("id", linkIds);
    for (const link of links ?? []) labelById.set(link.id, link.link_label);
  }

  const activity_feed = events.slice(0, 30).map((e) => ({
    action_type: e.action_type,
    buyer_email: e.buyer_email,
    metadata: { link_label: e.link_id ? (labelById.get(e.link_id) ?? null) : null },
    timestamp: e.created_at,
  }));

  return NextResponse.json(
    {
      workspace_id: workspaceId,
      domain: workspace.target_domain,
      metrics: {
        total_views: events.filter((e) => e.action_type === "portal_view").length,
        total_clicks: events.filter((e) => e.action_type === "link_click").length,
      },
      activity_feed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
