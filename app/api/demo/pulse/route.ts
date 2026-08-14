import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { buildActivityFeed } from "@/lib/pulse/build-activity-feed";
import { resolveStepLabels } from "@/lib/pulse/resolve-step-labels";

/** Unchanged from before this ticket, only extracted so it can run alongside
 * resolveStepLabels() via Promise.all rather than serially. */
async function resolveLinkLabels(linkIds: readonly string[], client: SupabaseClient): Promise<Map<string, string>> {
  const labelById = new Map<string, string>();
  if (linkIds.length === 0) return labelById;
  const { data: links } = await client.from("links").select("id, link_label").in("id", linkIds);
  for (const link of links ?? []) labelById.set(link.id, link.link_label);
  return labelById;
}

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
  // step_id added for T36-3 (step_complete feed entries); the other four
  // columns are unchanged from before this ticket.
  const { data: rows } = await supabase
    .from("workspace_analytics")
    .select("action_type, buyer_email, link_id, step_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const events = rows ?? [];

  // Resolve link labels for link_click rows, and step labels for
  // step_complete rows (T36-3), concurrently — two independent queries, no
  // reason to serialise them. The link lookup already selects a narrow
  // "id, link_label"; resolveStepLabels applies the same discipline to
  // plan_steps via its own exported, reviewable STEP_LABEL_SELECT.
  const linkIds = [...new Set(events.map((e) => e.link_id).filter((id): id is string => Boolean(id)))];
  const stepIds = [...new Set(events.map((e) => e.step_id).filter((id): id is string => Boolean(id)))];

  const [linkLabelById, stepLabelById] = await Promise.all([
    resolveLinkLabels(linkIds, supabase),
    resolveStepLabels(stepIds, supabase),
  ]);

  // T36-2: every buyer_email in the feed is masked here, in the one shared
  // buildActivityFeed()/maskBuyerEmail() call path — never inline per emit
  // site. This is a session-less, unauthenticated endpoint; the raw address
  // must never reach it.
  const activity_feed = buildActivityFeed(events, linkLabelById, stepLabelById);

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
