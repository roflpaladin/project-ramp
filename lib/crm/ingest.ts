import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ParseResult } from "@/lib/crm/parse";
import { provisionWorkspaceFromCrm } from "@/lib/crm/provisioner";
import { resolveOwnerByEmail } from "@/lib/crm/tenant";
import { getTriggerStageForTenant, normalizeStage } from "@/lib/crm/trigger-stage";

// Shared secret proving a webhook call actually came from our configured CRM
// relay. Without this, both vendor routes are unauthenticated: knowing a
// seller's owner_email is enough to forge a deal event and provision a
// workspace inside that real tenant (with an attacker-chosen approved_emails
// list). We fail CLOSED — an unset CRM_WEBHOOK_SECRET rejects every call
// rather than silently disabling the gate.
function isAuthorizedWebhook(request: Request): boolean {
  const secret = process.env.CRM_WEBHOOK_SECRET;
  if (!secret) return false;

  const provided =
    request.headers.get("x-ramp-webhook-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  // Hash both sides first so timingSafeEqual always gets equal-length buffers
  // (it throws otherwise) and the comparison stays constant-time regardless of
  // the provided value's length.
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expected, actual);
}

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
  // Authenticate BEFORE reading or parsing the body: a forged/unauthorized call
  // must not reach request.json(), the owner lookup, or any DB write.
  if (!isAuthorizedWebhook(request)) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

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

  const result = await provisionWorkspaceFromCrm(event, owner, triggerStage);
  return NextResponse.json(result.body, { status: result.status });
}
