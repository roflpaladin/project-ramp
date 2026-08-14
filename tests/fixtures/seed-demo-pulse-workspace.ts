// T36-6 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Seeds a
// workspace under DEMO_TENANT_ID — the only tenant GET /api/demo/pulse ever
// answers for (app/api/demo/pulse/route.ts's own scope-guard comment) —
// carrying every seller-private field FORBIDDEN_FIELD_PATTERNS
// (tests/fixtures/seed-leaky-workspace.ts) exists to catch: populated crm_*
// columns, internal_chat_url, approved_emails, created_by, and a plan step
// with private_note + owner_email. Plus three workspace_analytics rows (one
// per action_type the route emits) carrying a RAW buyer email, so T36-6 can
// prove maskBuyerEmail() actually runs on the wire, not just in
// buildActivityFeed()'s own unit tests (tests/security/build-activity-feed.spec.ts).
//
// Deliberately its own fixture, not an extension of
// tests/fixtures/seed-leaky-workspace.ts: that fixture's workspace lives
// under TEST_TENANT_ID, which the pulse route's DEMO_TENANT_ID scope guard
// 404s before ever reaching buildActivityFeed() — exercising T36-6 requires
// a workspace INSIDE the demo tenant, and seed-leaky-workspace.ts's whole
// point is a workspace OUTSIDE it (the RLS control / T36-7's regression
// case). Sibling fixture, not a widened one.
//
// Scoped separately from the real seeded demo deal room (lib/demo.ts's
// DEMO_WORKSPACE_ID / scripts/seed-demo.mjs): a dedicated workspace id under
// the SAME tenant, so this fixture can be torn down without disturbing
// whatever `npm run seed:demo` has already provisioned for manual rehearsal.
// Teardown never deletes the tenants row or the real demo workspace — only
// the rows this fixture itself created.

import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_TENANT_ID, DEMO_TENANT_LABEL } from "@/lib/demo";
import { requireTestEnv } from "./env";

export const LEAK_TOKEN = "PULSELEAKCANARY";

// "7e57" test namespace (mirrors seed-leaky-workspace.ts's convention),
// under a distinct "d"-prefixed id block so it can never collide with that
// fixture's own "0"..."f1"/"a" ids.
export const PULSE_TEST_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000d1";
export const PULSE_TEST_PLAN_ID = "7e570000-0000-4000-8000-0000000000d2";
export const PULSE_TEST_STAGE_ID = "7e570000-0000-4000-8000-0000000000d3";
export const PULSE_TEST_STEP_ID = "7e570000-0000-4000-8000-0000000000d4";
export const PULSE_TEST_LINK_ID = "7e570000-0000-4000-8000-0000000000d5";
const ANALYTICS_PORTAL_VIEW_ID = "7e570000-0000-4000-8000-0000000000d6";
const ANALYTICS_LINK_CLICK_ID = "7e570000-0000-4000-8000-0000000000d7";
const ANALYTICS_STEP_COMPLETE_ID = "7e570000-0000-4000-8000-0000000000d8";

const PULSE_TEST_OWNER_EMAIL = "t36-pulse-harness@projectramp.invalid";

export const RAW_BUYER_EMAIL = `pulse.buyer.${LEAK_TOKEN}@acme-pulse-test.invalid`;

export const INTERNAL_CHAT_URL = `https://internal-only.example.com/pulse-war-room-${LEAK_TOKEN}`;
export const SELLER_PRIVATE_NOTE = `SELLER PRIVATE ${LEAK_TOKEN} — do not share forecast confidence`;
export const STEP_OWNER_EMAIL = `dana.${LEAK_TOKEN}@seller-pulse-test.invalid`;

export const CRM_SOURCE = `salesforce-${LEAK_TOKEN}`;
export const CRM_OBJECT_ID = `0061t00000${LEAK_TOKEN}`;
export const CRM_STAGE = `Negotiation ${LEAK_TOKEN}`;
export const CRM_FORECAST_CATEGORY = `Commit ${LEAK_TOKEN}`;
export const CRM_AMOUNT = 612300.0;
export const CRM_CLOSE_DATE = "2026-12-05";
export const CRM_SYNCED_AT = "2026-08-01T09:00:00.000Z";

export const LINK_LABEL = `Pulse test resource ${LEAK_TOKEN}`;
export const STEP_LABEL = `Pulse test step ${LEAK_TOKEN}`;
export const TARGET_DOMAIN = "pulse-leak-test.invalid";

/**
 * Every literal that must be absent from the pulse JSON in raw form — the
 * value-level companion to FORBIDDEN_FIELD_PATTERNS (a renamed field is
 * caught by pattern; a leaked VALUE under an innocuous key is caught by
 * this), mirroring forbiddenValuesFor() in seed-leaky-workspace.ts but with
 * this fixture's own literals.
 */
export const PULSE_FORBIDDEN_VALUES: readonly string[] = [
  INTERNAL_CHAT_URL,
  SELLER_PRIVATE_NOTE,
  STEP_OWNER_EMAIL,
  CRM_SOURCE,
  CRM_OBJECT_ID,
  CRM_STAGE,
  CRM_FORECAST_CATEGORY,
  RAW_BUYER_EMAIL,
  // Numeric columns cannot carry the token — PostgREST emits numeric(14,2)
  // as a JSON number, which serializes back as 612300 (not "612300.00").
  "612300",
  CRM_CLOSE_DATE,
  // Date half of crm_synced_at only — PostgREST renders timestamptz as
  // "2026-08-01T09:00:00+00:00", not the "...Z" form written above.
  "2026-08-01",
];

export interface PulseTestWorkspace {
  readonly workspaceId: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

function testDb(): AdminClient {
  requireTestEnv();
  return createAdminClient();
}

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedDemoPulseWorkspace — ${label}: ${error.message}`);
}

/**
 * FK target for workspaces.created_by (not null references auth.users).
 * A dedicated harness user, never the real demo owner (lib/demo.ts's
 * DEMO_OWNER_EMAIL) — this fixture must never mutate that account's
 * app_metadata or lifecycle.
 */
async function ensurePulseTestOwner(db: AdminClient): Promise<string> {
  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  failOn("listUsers", error);

  const existing = list?.users.find((user) => user.email === PULSE_TEST_OWNER_EMAIL);
  if (existing) return existing.id;

  const { data, error: createError } = await db.auth.admin.createUser({
    email: PULSE_TEST_OWNER_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
    app_metadata: { tenant_id: DEMO_TENANT_ID },
  });
  failOn("createUser", createError);
  if (!data?.user) throw new Error("seedDemoPulseWorkspace — createUser returned no user");
  return data.user.id;
}

export async function seedDemoPulseWorkspace(): Promise<PulseTestWorkspace> {
  const db = testDb();
  const createdBy = await ensurePulseTestOwner(db);

  // Idempotent and byte-identical to lib/demo.ts's own constants — a no-op
  // against a tenant row `npm run seed:demo` already created, and creates it
  // if this is a fresh environment.
  failOn(
    "tenants",
    (await db.from("tenants").upsert({ id: DEMO_TENANT_ID, company_name: DEMO_TENANT_LABEL })).error,
  );

  failOn(
    "workspaces",
    (
      await db.from("workspaces").upsert({
        id: PULSE_TEST_WORKSPACE_ID,
        tenant_id: DEMO_TENANT_ID,
        target_company_name: `Pulse leak test co ${LEAK_TOKEN}`,
        target_domain: TARGET_DOMAIN,
        created_by: createdBy,
        approved_emails: [RAW_BUYER_EMAIL],
        chat_url: `https://chat.example.com/pulse-test-${LEAK_TOKEN}`,
        internal_chat_url: INTERNAL_CHAT_URL,
        crm_source: CRM_SOURCE,
        crm_object_id: CRM_OBJECT_ID,
        crm_stage: CRM_STAGE,
        crm_amount: CRM_AMOUNT,
        crm_close_date: CRM_CLOSE_DATE,
        crm_forecast_category: CRM_FORECAST_CATEGORY,
        crm_synced_at: CRM_SYNCED_AT,
      })
    ).error,
  );

  failOn(
    "links",
    (
      await db.from("links").upsert({
        id: PULSE_TEST_LINK_ID,
        workspace_id: PULSE_TEST_WORKSPACE_ID,
        category_header: "Getting started",
        link_label: LINK_LABEL,
        url_string: `https://docs.example.com/pulse-test-${LEAK_TOKEN}`,
        display_order: 0,
        visibility: "shared",
      })
    ).error,
  );

  failOn(
    "success_plans",
    (
      await db.from("success_plans").upsert({
        id: PULSE_TEST_PLAN_ID,
        workspace_id: PULSE_TEST_WORKSPACE_ID,
        title: `Pulse leak test plan ${LEAK_TOKEN}`,
        start_date: "2026-07-01",
        target_date: "2026-09-30",
        status: "active",
      })
    ).error,
  );

  failOn(
    "plan_stages",
    (
      await db.from("plan_stages").upsert({
        id: PULSE_TEST_STAGE_ID,
        plan_id: PULSE_TEST_PLAN_ID,
        title: `Pulse leak test stage ${LEAK_TOKEN}`,
        display_order: 0,
        status: "current",
      })
    ).error,
  );

  failOn(
    "plan_steps",
    (
      await db.from("plan_steps").upsert({
        id: PULSE_TEST_STEP_ID,
        stage_id: PULSE_TEST_STAGE_ID,
        label: STEP_LABEL,
        owner_side: "buyer",
        owner_name: `Pulse buyer ${LEAK_TOKEN}`,
        owner_email: STEP_OWNER_EMAIL,
        due_date: "2026-08-20",
        status: "open",
        display_order: 0,
        private_note: SELLER_PRIVATE_NOTE,
      })
    ).error,
  );

  // Three analytics rows — one per action_type the route emits — each
  // carrying the RAW buyer email. T36-2 masks this at read time
  // (lib/pulse/mask-buyer-email.ts via buildActivityFeed()); this fixture
  // exists to prove that on the real wire response, not merely at the unit
  // level (tests/security/build-activity-feed.spec.ts already covers unit).
  failOn(
    "workspace_analytics",
    (
      await db.from("workspace_analytics").upsert([
        {
          id: ANALYTICS_PORTAL_VIEW_ID,
          workspace_id: PULSE_TEST_WORKSPACE_ID,
          action_type: "portal_view",
          buyer_email: RAW_BUYER_EMAIL,
          link_id: null,
          step_id: null,
        },
        {
          id: ANALYTICS_LINK_CLICK_ID,
          workspace_id: PULSE_TEST_WORKSPACE_ID,
          action_type: "link_click",
          buyer_email: RAW_BUYER_EMAIL,
          link_id: PULSE_TEST_LINK_ID,
          step_id: null,
        },
        {
          id: ANALYTICS_STEP_COMPLETE_ID,
          workspace_id: PULSE_TEST_WORKSPACE_ID,
          action_type: "step_complete",
          buyer_email: RAW_BUYER_EMAIL,
          link_id: null,
          step_id: PULSE_TEST_STEP_ID,
        },
      ])
    ).error,
  );

  return { workspaceId: PULSE_TEST_WORKSPACE_ID };
}

export async function teardownDemoPulseWorkspace(): Promise<void> {
  const db = testDb();

  // links has no ON DELETE CASCADE from workspaces (migration 0001, same gap
  // teardownLeakyWorkspace's own comment documents) so it must be deleted
  // before the workspace. workspace_analytics and success_plans ->
  // plan_stages -> plan_steps DO cascade.
  await db.from("links").delete().eq("workspace_id", PULSE_TEST_WORKSPACE_ID);
  await db.from("workspaces").delete().eq("id", PULSE_TEST_WORKSPACE_ID);

  // Never deletes the DEMO_TENANT_ID tenants row or the real seeded demo
  // workspace (lib/demo.ts's DEMO_WORKSPACE_ID) — both are shared with
  // `npm run seed:demo` and outlive this fixture.
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === PULSE_TEST_OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}
