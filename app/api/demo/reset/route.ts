import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_TENANT_ID } from "@/lib/demo";

// Sandbox reset (Sprint 4, Ticket 21; plan purge added Sprint 5, Ticket 27).
// Purges everything the demo loop creates so back-to-back pitches start clean
// — but ONLY for the seeded demo tenant.
//
// Tenant isolation is P0: every delete is scoped by DEMO_TENANT_ID (directly,
// or by the set of workspace ids belonging to it). Real tenants are never
// touched. The demo tenant row and the demo AE user are intentionally KEPT so
// the seed (Ticket 17) stays valid — only per-pitch data (workspaces, their
// links, their analytics, and their success plan / stages / steps) is
// removed. Idempotent and safe to spam.
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
    return NextResponse.json({
      success: true,
      workspaces_deleted: 0,
      links_deleted: 0,
      events_deleted: 0,
      plan_steps_deleted: 0,
      plan_stages_deleted: 0,
      plans_deleted: 0,
    });
  }

  // 1b. The demo tenant's plan ids (Ticket 27) — success_plans has no direct
  // tenant/workspace FK path other than workspace_id, but plan_stages and
  // plan_steps hop through it, so we need the plan and stage ids up front to
  // scope their deletes below.
  const { data: plans, error: plansErr } = await supabase
    .from("success_plans")
    .select("id")
    .in("workspace_id", ids);
  if (plansErr) {
    return NextResponse.json({ success: false, message: plansErr.message }, { status: 500 });
  }
  const planIds = (plans ?? []).map((p) => p.id);

  const { data: stages, error: stagesErr } = planIds.length
    ? await supabase.from("plan_stages").select("id").in("plan_id", planIds)
    : { data: [], error: null };
  if (stagesErr) {
    return NextResponse.json({ success: false, message: stagesErr.message }, { status: 500 });
  }
  const stageIds = (stages ?? []).map((s) => s.id);

  // 2. Delete children first (FKs: links → workspaces has no cascade; analytics
  //    → workspaces cascades, but we delete explicitly to report a count and to
  //    not depend on cascade semantics), then the workspaces themselves.
  //
  // Plan tables (Ticket 27) cascade workspaces → success_plans → plan_stages →
  // plan_steps (0005), but are deleted explicitly here too, deepest-first, for
  // the same reason: an accurate count without depending on cascade semantics.
  // Each plan delete reports its own error rather than only its count. A purge
  // that fails silently would return `success: true` with `plans_deleted: 0`,
  // which reads identically to "there was nothing to purge" — and the next
  // pitch would then open on a stale plan the operator was told was gone.
  const { count: plan_steps_deleted, error: stepsDelErr } = stageIds.length
    ? await supabase.from("plan_steps").delete({ count: "exact" }).in("stage_id", stageIds)
    : { count: 0, error: null };
  if (stepsDelErr) {
    return NextResponse.json({ success: false, message: stepsDelErr.message }, { status: 500 });
  }
  const { count: plan_stages_deleted, error: stagesDelErr } = planIds.length
    ? await supabase.from("plan_stages").delete({ count: "exact" }).in("plan_id", planIds)
    : { count: 0, error: null };
  if (stagesDelErr) {
    return NextResponse.json({ success: false, message: stagesDelErr.message }, { status: 500 });
  }
  const { count: plans_deleted, error: plansDelErr } = planIds.length
    ? await supabase.from("success_plans").delete({ count: "exact" }).in("workspace_id", ids)
    : { count: 0, error: null };
  if (plansDelErr) {
    return NextResponse.json({ success: false, message: plansDelErr.message }, { status: 500 });
  }
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
    plan_steps_deleted: plan_steps_deleted ?? 0,
    plan_stages_deleted: plan_stages_deleted ?? 0,
    plans_deleted: plans_deleted ?? 0,
  });
}
