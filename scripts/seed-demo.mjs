// Sprint 4 · Ticket 17 — Seed Demo Tenant & Owner.
// Sprint 5 · Ticket 27 — …and the Acme Logistics mutual success plan.
//
// Idempotent seed for the Pitch-Ready Live Demo Engine: a clearly-labelled demo
// tenant, a demo AE Supabase Auth user carrying the `app_metadata.tenant_id`
// claim, and (Ticket 27) a fully populated demo deal room — workspace, success
// plan, stages, steps and resources — matching the locked Sprint 5 prototype.
//
// Without the tenant + AE user, the sandbox webhook (Ticket 18) hits the v1.2
// provisioner's 401 owner-lookup failure (lib/crm/tenant.ts) and the 90-second
// live demo dies. Without the plan, there is nothing for the demo to show.
//
//   Run:  npm run seed:demo   (loads .env.local via `node --env-file`)
//
// Safe to re-run between pitches. Two different idempotency strategies, on
// purpose:
//   - Tenant and AE user: created once, never rewritten (ignoreDuplicates / an
//     existence check). They are identity; rewriting identity mid-cycle would
//     invalidate the claim the webhook resolves against.
//   - Workspace, plan, stages, steps and resources: fixed-id upserts that DO
//     overwrite. A re-run must converge on identical content, which means
//     rewinding whatever the last rehearsal clicked and — because the plan's
//     dates are relative to run time (Ticket 27) — refreshing them, so the
//     runway banner shows a live mid-plan position rather than a range that
//     expired however many days ago the seed last ran.
// Either way, no re-run ever produces a duplicate row.
//
// Uses the app's own service-role client (bypasses RLS), not the Supabase CLI —
// so it fits the SQL-Editor / no-CLI workflow. Keep the constants below in sync
// with lib/demo.ts.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_APPROVED_EMAILS,
  buildDemoPlan,
  buildDemoResources,
  buildDemoStages,
  buildDemoSteps,
  buildDemoWorkspaceFields,
} from "./demo-plan-data.mjs";

const DEMO_TENANT_ID = "de300000-0000-4000-8000-000000000001";
const DEMO_OWNER_EMAIL = "ae_user@projectramp.com";
const DEMO_TENANT_LABEL = "DEMO — Project Ramp";
const DEMO_WORKSPACE_ID = "de300000-0000-4000-8000-000000000002";
const DEMO_TARGET_COMPANY = "Acme Logistics";
const DEMO_TARGET_DOMAIN = "acme-logistics.example.com";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run via `npm run seed:demo` so .env.local is loaded.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function seedTenant() {
  // Fixed-id upsert with ignoreDuplicates → ON CONFLICT DO NOTHING semantics:
  // a re-run never creates a duplicate demo tenant.
  const { error } = await admin
    .from("tenants")
    .upsert(
      { id: DEMO_TENANT_ID, company_name: DEMO_TENANT_LABEL },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Tenant upsert failed: ${error.message}`);
  console.log(`  tenant     ready  ${DEMO_TENANT_LABEL} (${DEMO_TENANT_ID})`);
}

async function findUserByEmail(email) {
  // GoTrue's admin API has no get-by-email; list + match, mirroring the
  // resolveOwnerByEmail lookup the webhook itself uses (lib/crm/tenant.ts).
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function seedOwner() {
  const existing = await findUserByEmail(DEMO_OWNER_EMAIL);
  if (existing) {
    if (existing.app_metadata?.tenant_id !== DEMO_TENANT_ID) {
      // User pre-existed without the claim (or pointing elsewhere) — repair it,
      // otherwise the webhook owner-lookup would still 401.
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        app_metadata: { ...existing.app_metadata, tenant_id: DEMO_TENANT_ID },
      });
      if (error) throw new Error(`updateUserById failed: ${error.message}`);
      console.log(`  demo AE    repaired  ${DEMO_OWNER_EMAIL} (${existing.id}) → tenant claim set`);
    } else {
      console.log(`  demo AE    ready     ${DEMO_OWNER_EMAIL} (${existing.id})`);
    }
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: DEMO_OWNER_EMAIL,
    email_confirm: true,
    // The demo AE never logs in interactively; it exists solely so the inbound
    // webhook's owner_email resolves to the demo tenant. Random, un-surfaced pw.
    password: randomUUID(),
    app_metadata: { tenant_id: DEMO_TENANT_ID },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  console.log(`  demo AE    created   ${DEMO_OWNER_EMAIL} (${data.user.id})`);
  return data.user.id;
}

// ── Sprint 5 · Ticket 27 — the demo deal room ──────────────────────────────
//
// Every upsert below is `onConflict: "id"` WITHOUT ignoreDuplicates, so a
// re-run overwrites rather than skips. See the strategy note in the file header.

async function upsertRows(table, rows, label) {
  const { error } = await admin.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  console.log(`  ${label.padEnd(10)} ready     ${rows.length} row${rows.length === 1 ? "" : "s"}`);
}

async function seedWorkspace(runAt, ownerUserId) {
  await upsertRows(
    "workspaces",
    [
      {
        id: DEMO_WORKSPACE_ID,
        tenant_id: DEMO_TENANT_ID,
        target_company_name: DEMO_TARGET_COMPANY,
        target_domain: DEMO_TARGET_DOMAIN,
        created_by: ownerUserId,
        approved_emails: DEMO_APPROVED_EMAILS,
        ...buildDemoWorkspaceFields(runAt),
      },
    ],
    "workspace",
  );
}

async function seedPlan(runAt) {
  const plan = buildDemoPlan(runAt);
  await upsertRows("success_plans", [{ ...plan, workspace_id: DEMO_WORKSPACE_ID }], "plan");
  await upsertRows(
    "plan_stages",
    buildDemoStages().map((stage) => ({ ...stage, plan_id: plan.id })),
    "stages",
  );
  // Steps carry their own stage_id, so they need no parent injection — but they
  // must land AFTER the stages exist or the FK rejects them.
  await upsertRows("plan_steps", buildDemoSteps(runAt), "steps");
}

async function seedResources() {
  await upsertRows(
    "links",
    buildDemoResources().map((resource) => ({ ...resource, workspace_id: DEMO_WORKSPACE_ID })),
    "resources",
  );
}

async function main() {
  console.log("Seeding Project Ramp demo tenant, owner + success plan (Tickets 17 / 27)…");
  // One timestamp for the whole run, so a seed that straddles midnight cannot
  // date the plan's stages and steps a day apart from each other.
  const runAt = new Date();

  await seedTenant();
  const userId = await seedOwner();
  await seedWorkspace(runAt, userId);
  await seedPlan(runAt);
  await seedResources();

  const plan = buildDemoPlan(runAt);
  console.log("\nSeed complete. Demo identifiers (reference from Tickets 18/20/21/33):");
  console.log(`  tenant_id    = ${DEMO_TENANT_ID}`);
  console.log(`  owner_email  = ${DEMO_OWNER_EMAIL}`);
  console.log(`  owner_userId = ${userId}`);
  console.log(`  workspace_id = ${DEMO_WORKSPACE_ID}`);
  console.log(`  plan runway  = ${plan.start_date} → ${plan.target_date}`);
  console.log(`  buyer view   = /view/${DEMO_WORKSPACE_ID}`);
}

main().catch((err) => {
  console.error("\nSeed FAILED:", err.message);
  process.exit(1);
});
