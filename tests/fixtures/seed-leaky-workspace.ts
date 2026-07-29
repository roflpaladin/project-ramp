// The single most important file in the security gate.
//
// It provisions a workspace deliberately stuffed with every field the buyer must
// never see, so that Ticket 26's suite has something real to fail against. A
// buyer-boundary test run against a workspace with no private data is green and
// worthless — it proves only that nothing leaked because nothing was there.
//
// Two rules govern the values below:
//
//   1. Every seller-private value carries the literal token LEAK_TOKEN, and every
//      buyer-visible value carries VISIBLE_TOKEN. A single grep for LEAK_TOKEN in
//      a payload or an HTML response therefore proves *any* leak, without anyone
//      maintaining a list by hand. Realism is deliberately sacrificed for
//      greppability: "salesforce-LEAKCANARY" is not a real CRM source, and that is
//      the point — a bare value like "salesforce" would false-pass the moment a
//      shared link happened to mention Salesforce.
//
//   2. Everything is scoped to a dedicated sentinel tenant, so teardown can never
//      reach real or demo data.
//
// Numeric and date columns cannot carry a token, so their literals are exported
// individually in FORBIDDEN_VALUES.

import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "./env";

export const LEAK_TOKEN = "LEAKCANARY";
export const VISIBLE_TOKEN = "VISIBLEOK";

// Sentinel IDs, fixed so that every write is an idempotent upsert and teardown
// matches only rows this fixture owns. "7e57" reads as "test", mirroring the
// "de30"/demo convention already used by lib/demo.ts.
export const TEST_TENANT_ID = "7e570000-0000-4000-8000-000000000001";
export const TEST_WORKSPACE_ID = "7e570000-0000-4000-8000-000000000002";
export const TEST_PLAN_ID = "7e570000-0000-4000-8000-000000000003";
export const TEST_STAGE_ONE_ID = "7e570000-0000-4000-8000-000000000004";
export const TEST_STAGE_TWO_ID = "7e570000-0000-4000-8000-000000000005";
export const TEST_SELLER_STEP_ID = "7e570000-0000-4000-8000-000000000006";
export const TEST_BUYER_STEP_ID = "7e570000-0000-4000-8000-000000000007";
export const TEST_BLOCKED_STEP_ID = "7e570000-0000-4000-8000-000000000008";
export const TEST_DONE_STEP_ID = "7e570000-0000-4000-8000-000000000009";

export const TEST_TENANT_LABEL = "TEST — buyer boundary";
export const TEST_OWNER_EMAIL = "t23-harness@projectramp.invalid";
export const TEST_APPROVED_EMAIL = `buyer.${LEAK_TOKEN}@acme-test.invalid`;

// --- seller-private values (must never reach a buyer) ------------------------

export const PRIVATE_LINK_URLS = [
  `https://internal-only.example.com/pricing-floor-${LEAK_TOKEN}`,
  `https://internal-only.example.com/board-deck-${LEAK_TOKEN}`,
] as const;

export const INTERNAL_CHAT_URL = `https://internal-only.example.com/war-room-${LEAK_TOKEN}`;
export const SELLER_PRIVATE_NOTE = `SELLER PRIVATE ${LEAK_TOKEN} — champion is wobbling on price`;
export const BUYER_STEP_PRIVATE_NOTE = `SELLER PRIVATE ${LEAK_TOKEN} — chase legal directly, not via champion`;

export const CRM_SOURCE = `salesforce-${LEAK_TOKEN}`;
export const CRM_OBJECT_ID = `0061t00000${LEAK_TOKEN}`;
export const CRM_STAGE = `Negotiation ${LEAK_TOKEN}`;
export const CRM_FORECAST_CATEGORY = `Commit ${LEAK_TOKEN}`;
export const CRM_AMOUNT = 487500.0;
// Deliberately NOT the plan's target_date (2026-09-30). The target date is
// buyer-visible by design, so sharing a literal between the two would make a
// value-level grep fail on correct behaviour.
export const CRM_CLOSE_DATE = "2026-11-17";
export const CRM_SYNCED_AT = "2026-07-20T09:15:00.000Z";

// --- buyer-visible values (must survive the boundary) ------------------------

export const CHAT_URL = `https://chat.example.com/shared/acme-ramp-${VISIBLE_TOKEN}`;

export const SHARED_LINK_URLS = [
  `https://docs.example.com/onboarding-guide-${VISIBLE_TOKEN}`,
  `https://docs.example.com/security-overview-${VISIBLE_TOKEN}`,
  `https://docs.example.com/reference-architecture-${VISIBLE_TOKEN}`,
] as const;

export const SELLER_STEP_LABEL = `Deliver the security whitepaper ${VISIBLE_TOKEN}`;
export const SELLER_STEP_OWNER_NAME = `Dana Okafor ${VISIBLE_TOKEN}`;
export const BUYER_STEP_LABEL = `Confirm the technical validation call ${VISIBLE_TOKEN}`;

/**
 * Every literal that must be absent from a buyer payload and from buyer-facing
 * HTML. Step 6 asserts on this array directly, so adding a private field to the
 * fixture automatically widens the security suite's coverage.
 */
export const FORBIDDEN_VALUES: readonly string[] = [
  ...PRIVATE_LINK_URLS,
  INTERNAL_CHAT_URL,
  SELLER_PRIVATE_NOTE,
  BUYER_STEP_PRIVATE_NOTE,
  CRM_SOURCE,
  CRM_OBJECT_ID,
  CRM_STAGE,
  CRM_FORECAST_CATEGORY,
  TEST_APPROVED_EMAIL,
  TEST_TENANT_ID,
  // The date half of crm_synced_at only. PostgREST renders timestamptz as
  // "2026-07-20T09:15:00+00:00", not the "...Z" form written above, so the full
  // literal would never match. The date alone survives the round trip and does
  // not collide with any buyer-visible date (plan start 2026-07-01, target
  // 2026-09-30, completed_at 2026-07-05).
  "2026-07-20",
  // Numeric/date columns cannot carry the token, so they are listed as raw
  // literals. The bare digits (not "487500.00") because PostgREST emits
  // numeric(14,2) as a JSON number, which serializes back as 487500 — the short
  // form matches both that and any string rendering.
  "487500",
  CRM_CLOSE_DATE,
];

/**
 * The forbidden set including values only known at run time.
 *
 * `created_by` is in the audit's forbidden set but is an auth.users UUID minted
 * when the fixture first runs, so it cannot be a static literal. Callers should
 * prefer this over FORBIDDEN_VALUES: greping the static array alone would skip
 * `created_by` silently, which is exactly the kind of quiet gap this suite exists
 * to prevent.
 */
export function forbiddenValuesFor(seeded: LeakyWorkspace): readonly string[] {
  return [...FORBIDDEN_VALUES, seeded.createdBy];
}

/** Values that must survive the boundary — asserted so the strip is not overzealous. */
export const EXPECTED_VISIBLE_VALUES: readonly string[] = [
  ...SHARED_LINK_URLS,
  CHAT_URL,
  SELLER_STEP_LABEL,
  SELLER_STEP_OWNER_NAME,
  BUYER_STEP_LABEL,
];

export interface LeakyWorkspace {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdBy: string;
  readonly planId: string;
  readonly stageIds: readonly string[];
  readonly sellerStepId: string;
  readonly buyerStepId: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

function testDb(): AdminClient {
  // Validate first so a missing secret fails with a message that names it,
  // rather than a cryptic PostgREST error from a client built on undefined.
  requireTestEnv();
  return createAdminClient();
}

function failOn(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedLeakyWorkspace — ${label}: ${error.message}`);
}

/**
 * auth.users has no upsert path through the admin API, so the owner is looked up
 * by email and created only when absent. workspaces.created_by is a NOT NULL FK
 * to auth.users (migration 0001), so this must resolve before the workspace insert.
 */
async function ensureTestUser(db: AdminClient): Promise<string> {
  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  failOn("listUsers", error);

  const existing = list?.users.find((user) => user.email === TEST_OWNER_EMAIL);
  if (existing) return existing.id;

  const { data, error: createError } = await db.auth.admin.createUser({
    email: TEST_OWNER_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
  });
  failOn("createUser", createError);
  if (!data?.user) throw new Error("seedLeakyWorkspace — createUser returned no user");

  return data.user.id;
}

export async function seedLeakyWorkspace(): Promise<LeakyWorkspace> {
  const db = testDb();
  const createdBy = await ensureTestUser(db);

  failOn(
    "tenants",
    (await db.from("tenants").upsert({ id: TEST_TENANT_ID, company_name: TEST_TENANT_LABEL })).error,
  );

  failOn(
    "workspaces",
    (
      await db.from("workspaces").upsert({
        id: TEST_WORKSPACE_ID,
        tenant_id: TEST_TENANT_ID,
        target_company_name: `Acme Test Co ${VISIBLE_TOKEN}`,
        target_domain: "acme-test.invalid",
        created_by: createdBy,
        approved_emails: [TEST_APPROVED_EMAIL],
        chat_url: CHAT_URL,
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

  const links = [
    ...SHARED_LINK_URLS.map((url, index) => ({
      id: `7e570000-0000-4000-8000-00000000001${index}`,
      workspace_id: TEST_WORKSPACE_ID,
      category_header: "Getting started",
      link_label: `Shared resource ${index + 1} ${VISIBLE_TOKEN}`,
      url_string: url,
      display_order: index,
      visibility: "shared",
    })),
    ...PRIVATE_LINK_URLS.map((url, index) => ({
      id: `7e570000-0000-4000-8000-00000000002${index}`,
      workspace_id: TEST_WORKSPACE_ID,
      category_header: "Internal",
      link_label: `Private resource ${index + 1} ${LEAK_TOKEN}`,
      url_string: url,
      display_order: index,
      visibility: "private",
    })),
  ];
  failOn("links", (await db.from("links").upsert(links)).error);

  failOn(
    "success_plans",
    (
      await db.from("success_plans").upsert({
        id: TEST_PLAN_ID,
        workspace_id: TEST_WORKSPACE_ID,
        title: `Acme × Ramp mutual success plan ${VISIBLE_TOKEN}`,
        start_date: "2026-07-01",
        target_date: "2026-09-30",
        status: "active",
      })
    ).error,
  );

  failOn(
    "plan_stages",
    (
      await db.from("plan_stages").upsert([
        {
          id: TEST_STAGE_ONE_ID,
          plan_id: TEST_PLAN_ID,
          title: `Align on goals ${VISIBLE_TOKEN}`,
          display_order: 0,
          status: "done",
        },
        {
          id: TEST_STAGE_TWO_ID,
          plan_id: TEST_PLAN_ID,
          title: `Product & proof ${VISIBLE_TOKEN}`,
          display_order: 1,
          status: "current",
        },
      ])
    ).error,
  );

  // plan_steps carries a CHECK: (status = 'done') = (completed_at is not null).
  // The 'done' row below must therefore set completed_at, and the others must not.
  failOn(
    "plan_steps",
    (
      await db.from("plan_steps").upsert([
        {
          id: TEST_SELLER_STEP_ID,
          stage_id: TEST_STAGE_TWO_ID,
          label: SELLER_STEP_LABEL,
          owner_side: "seller",
          owner_name: SELLER_STEP_OWNER_NAME,
          owner_email: "dana@seller-test.invalid",
          due_date: "2026-08-14",
          status: "open",
          display_order: 0,
          private_note: SELLER_PRIVATE_NOTE,
        },
        {
          id: TEST_BUYER_STEP_ID,
          stage_id: TEST_STAGE_TWO_ID,
          label: BUYER_STEP_LABEL,
          owner_side: "buyer",
          owner_name: `Priya Raman ${VISIBLE_TOKEN}`,
          owner_email: TEST_APPROVED_EMAIL,
          due_date: "2026-08-20",
          status: "open",
          display_order: 1,
          private_note: BUYER_STEP_PRIVATE_NOTE,
        },
        {
          id: TEST_BLOCKED_STEP_ID,
          stage_id: TEST_STAGE_TWO_ID,
          label: `Complete the security questionnaire ${VISIBLE_TOKEN}`,
          owner_side: "buyer",
          due_date: "2026-08-05",
          status: "blocked",
          display_order: 2,
        },
        {
          id: TEST_DONE_STEP_ID,
          stage_id: TEST_STAGE_ONE_ID,
          label: `Kickoff call ${VISIBLE_TOKEN}`,
          owner_side: "buyer",
          status: "done",
          display_order: 0,
          completed_at: "2026-07-05T14:00:00.000Z",
          completed_by_email: TEST_APPROVED_EMAIL,
        },
      ])
    ).error,
  );

  return {
    tenantId: TEST_TENANT_ID,
    workspaceId: TEST_WORKSPACE_ID,
    createdBy,
    planId: TEST_PLAN_ID,
    stageIds: [TEST_STAGE_ONE_ID, TEST_STAGE_TWO_ID],
    sellerStepId: TEST_SELLER_STEP_ID,
    buyerStepId: TEST_BUYER_STEP_ID,
  };
}

export async function teardownLeakyWorkspace(): Promise<void> {
  const db = testDb();

  // Scoped by tenant rather than by the sentinel workspace id, so a test that
  // creates an extra workspace under this tenant still gets cleaned up.
  const { data: workspaces } = await db
    .from("workspaces")
    .select("id")
    .eq("tenant_id", TEST_TENANT_ID);

  const workspaceIds = (workspaces ?? []).map((row: { id: string }) => row.id);

  if (workspaceIds.length > 0) {
    // links and portal_access_tokens have NO on delete cascade (migration 0001),
    // so deleting the workspace first would fail on a foreign-key violation.
    // workspace_analytics and success_plans -> plan_stages -> plan_steps do cascade.
    await db.from("links").delete().in("workspace_id", workspaceIds);
    await db.from("portal_access_tokens").delete().in("workspace_id", workspaceIds);
    await db.from("workspaces").delete().in("id", workspaceIds);
  }

  await db.from("tenants").delete().eq("id", TEST_TENANT_ID);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === TEST_OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}
