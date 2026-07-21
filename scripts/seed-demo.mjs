// Sprint 4 · Ticket 17 — Seed Demo Tenant & Owner.
//
// Idempotent seed for the Pitch-Ready Live Demo Engine: a clearly-labelled demo
// tenant plus a demo AE Supabase Auth user carrying the `app_metadata.tenant_id`
// claim. Without this, the sandbox webhook (Ticket 18) hits the v1.2 provisioner's
// 401 owner-lookup failure (lib/crm/tenant.ts) and the 90-second live demo dies.
//
//   Run:  npm run seed:demo   (loads .env.local via `node --env-file`)
//
// Safe to re-run between pitches: the tenant row is a fixed-id upsert
// (ignoreDuplicates), and the AE user is created only if it does not already
// exist — a matching user just has its tenant_id claim verified/repaired.
//
// Uses the app's own service-role client (bypasses RLS), not the Supabase CLI —
// so it fits the SQL-Editor / no-CLI workflow. Keep the three constants below in
// sync with lib/demo.ts.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DEMO_TENANT_ID = "de300000-0000-4000-8000-000000000001";
const DEMO_OWNER_EMAIL = "ae_user@projectramp.com";
const DEMO_TENANT_LABEL = "DEMO — Project Ramp";

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

async function main() {
  console.log("Seeding Project Ramp demo tenant + owner (Sprint 4 · Ticket 17)…");
  await seedTenant();
  const userId = await seedOwner();
  console.log("\nSeed complete. Demo identifiers (reference from Tickets 18/20/21):");
  console.log(`  tenant_id    = ${DEMO_TENANT_ID}`);
  console.log(`  owner_email  = ${DEMO_OWNER_EMAIL}`);
  console.log(`  owner_userId = ${userId}`);
}

main().catch((err) => {
  console.error("\nSeed FAILED:", err.message);
  process.exit(1);
});
