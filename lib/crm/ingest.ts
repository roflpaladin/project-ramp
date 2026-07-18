import { NextResponse } from "next/server";
import type { ParseResult } from "@/lib/crm/parse";
import { provisionWorkspaceFromCrm } from "@/lib/crm/provisioner";
import { resolveOwnerByEmail } from "@/lib/crm/tenant";
import { getTriggerStageForTenant, normalizeStage } from "@/lib/crm/trigger-stage";

// Shared webhook ingestion pipeline (Sprint 3, Ticket 14). Both vendor routes
// funnel here after vendor-specific parsing. Response matrix per PRD §3.2:
//   400 — malformed payload (missing/invalid dealId/OpportunityId, domain, stage)
//   401 — owner_email can't be mapped to a tenant (Multi-Tenant Isolation)
//   200 — stage doesn't match the configured trigger: graceful skip, zero DB writes
//   201 — provisioned (Ticket 15)
//
// Ordering note: the 401 owner check runs before the stage filter because the
// trigger stage is per-tenant config — without a resolved tenant there is no
// trigger to compare against. The skip path performs reads only (owner lookup
// + config read against our own Supabase project); the route makes no external
// network egress — scraper egress lives inside the provisioner behind
// lib/ssrf-guard.ts.
export async function ingestCrmWebhook(request: Request, parse: (body: unknown) => ParseResult) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
  }
  const { event } = parsed;

  if (!event.ownerEmail) {
    return NextResponse.json(
      { success: false, message: "owner_email is missing or invalid — cannot map to a seller tenant." },
      { status: 401 },
    );
  }
  const owner = await resolveOwnerByEmail(event.ownerEmail);
  if (!owner) {
    return NextResponse.json(
      { success: false, message: "owner_email does not map to a known seller tenant." },
      { status: 401 },
    );
  }

  const triggerStage = await getTriggerStageForTenant(owner.tenantId);
  if (normalizeStage(event.stage) !== normalizeStage(triggerStage)) {
    return NextResponse.json(
      {
        success: true,
        message: `Execution bypassed: deal stage "${event.stage}" does not match the configured trigger stage "${triggerStage}".`,
      },
      { status: 200 },
    );
  }

  const result = await provisionWorkspaceFromCrm(event, owner);
  return NextResponse.json(result.body, { status: result.status });
}
