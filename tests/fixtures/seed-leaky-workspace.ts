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

export const TEST_TIED_STEP_ID = "7e570000-0000-4000-8000-00000000000a";

// A workspace under the SAME tenant that deliberately has no plan at all, so the
// "no plan returns null rather than throwing" path has something to read.
export const EMPTY_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000e1";

// A second tenant. Proving RLS *holds* needs a workspace the seller genuinely
// cannot reach — asserting against one they can see proves nothing. Its plan
// carries one stage and ZERO steps, which doubles as the "stages but no steps
// assembles without error" case.
export const FOREIGN_TENANT_ID = "7e570000-0000-4000-8000-0000000000f1";
export const FOREIGN_WORKSPACE_ID = "7e570000-0000-4000-8000-0000000000f2";
export const FOREIGN_PLAN_ID = "7e570000-0000-4000-8000-0000000000f3";
export const FOREIGN_STAGE_ID = "7e570000-0000-4000-8000-0000000000f4";

export const TEST_TENANT_LABEL = "TEST — buyer boundary";
export const FOREIGN_TENANT_LABEL = "TEST — foreign tenant (RLS control)";
export const TEST_OWNER_EMAIL = "t23-harness@projectramp.invalid";
export const TEST_APPROVED_EMAIL = `buyer.${LEAK_TOKEN}@acme-test.invalid`;

// --- seller-private values (must never reach a buyer) ------------------------

export const PRIVATE_LINK_URLS = [
  `https://internal-only.example.com/pricing-floor-${LEAK_TOKEN}`,
  `https://internal-only.example.com/board-deck-${LEAK_TOKEN}`,
] as const;

// Ticket 30 (T30-9/T30-10). Explicit id constants, index-aligned with
// PRIVATE_LINK_URLS / SHARED_LINK_URLS above, so callers that need a
// *specific* link's id (e.g. the B2 /api/track regression, which posts a
// real private link id) don't have to re-derive the
// `7e570000-0000-4000-8000-00000000002${index}` convention by hand in a
// second file.
export const PRIVATE_LINK_IDS = [
  "7e570000-0000-4000-8000-000000000020",
  "7e570000-0000-4000-8000-000000000021",
] as const;

export const SHARED_LINK_IDS = [
  "7e570000-0000-4000-8000-000000000010",
  "7e570000-0000-4000-8000-000000000011",
  "7e570000-0000-4000-8000-000000000012",
] as const;

// Ticket 30 (T30-7/T30-8). A dedicated link whose visibility the toggle
// tests flip live, kept separate from PRIVATE_LINK_URLS/SHARED_LINK_URLS so
// those tests can never disturb the fixed-visibility assertions the rest of
// this suite (and buyer-boundary.spec.ts) make against the other rows. NOT
// inserted by seedLeakyWorkspace() itself — tests/security/link-visibility-
// toggle.spec.ts inserts (and, via full-workspace teardown, cleans up) this
// row on its own, so files that assert exact link counts against the base
// seed (tests/harness/seed-leaky-workspace.spec.ts,
// tests/plans/portal-payload.spec.ts) are unaffected. Starts "shared" — the
// same state a freshly created link defaults to (0005's column default,
// mirrored explicitly by addLink per T30-3's comment) — so T30-7 has a real
// shared->private transition to prove.
export const TEST_TOGGLE_LINK_ID = "7e570000-0000-4000-8000-000000000023";
export const TOGGLE_TOKEN = "TOGGLECHECK";
export const TOGGLE_LINK_URL = `https://docs.example.com/toggle-target-${TOGGLE_TOKEN}`;
export const TOGGLE_LINK_LABEL = `Toggle target ${TOGGLE_TOKEN}`;

// Ticket 30 (T30-9). A private link that also carries a resource_type
// (T30-5's new column), proving the resource_type grouping introduces no
// second leak path for a link that is already private. Deliberately a
// SEPARATE row from PRIVATE_LINK_URLS rather than adding resource_type to
// an existing one, so a future edit to those two rows can't silently widen
// or narrow what this specific assertion covers. NOT inserted by
// seedLeakyWorkspace() — see TEST_TOGGLE_LINK_ID's comment above for why.
export const TEST_PRIVATE_RESOURCE_TYPE_LINK_ID = "7e570000-0000-4000-8000-000000000024";
export const PRIVATE_RESOURCE_TYPE_LINK_URL = `https://internal-only.example.com/deck-${LEAK_TOKEN}`;
export const PRIVATE_RESOURCE_TYPE_LINK_LABEL = `Private deck ${LEAK_TOKEN}`;
export const PRIVATE_RESOURCE_TYPE_VALUE = "deck";

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
  // NOTE: PRIVATE_RESOURCE_TYPE_LINK_URL (Ticket 30, T30-9) is deliberately
  // NOT included here — that row is not part of the base seed (see the
  // comment on the `links` array above), so it would not always exist when
  // this array is checked from other spec files, making the check there
  // vacuous. tests/security/link-visibility-toggle.spec.ts asserts its
  // absence directly, scoped to the file that actually seeds it.
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
  /**
   * Credentials for the AE who owns this tenant. The password is regenerated on
   * every seed and exists only in memory — tests sign in with it to obtain an
   * RLS-scoped client, which is the only way to prove RLS actually holds.
   */
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  /** A workspace under this tenant with no plan at all. */
  readonly emptyWorkspaceId: string;
  /** A workspace under a DIFFERENT tenant — the RLS control. */
  readonly foreignTenantId: string;
  readonly foreignWorkspaceId: string;
  readonly foreignPlanId: string;
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
async function ensureTestUser(db: AdminClient): Promise<{ id: string; password: string }> {
  // Regenerated every run and never written to disk. The seller tests must sign
  // in as this user to get a session RLS will actually scope, and a fixed
  // password in the repo would be a committed credential for no benefit.
  const password = crypto.randomUUID();

  // app_metadata.tenant_id is the claim every RLS policy in 0001-0005 reads
  // — `(auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`, never auth.uid().
  // Without it the signed-in client sees nothing at all, and the RLS tests would
  // pass for entirely the wrong reason.
  const app_metadata = { tenant_id: TEST_TENANT_ID };

  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  failOn("listUsers", error);

  const existing = list?.users.find((user) => user.email === TEST_OWNER_EMAIL);
  if (existing) {
    const { error: updateError } = await db.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata,
    });
    failOn("updateUser", updateError);
    return { id: existing.id, password };
  }

  const { data, error: createError } = await db.auth.admin.createUser({
    email: TEST_OWNER_EMAIL,
    email_confirm: true,
    password,
    app_metadata,
  });
  failOn("createUser", createError);
  if (!data?.user) throw new Error("seedLeakyWorkspace — createUser returned no user");

  return { id: data.user.id, password };
}

export async function seedLeakyWorkspace(): Promise<LeakyWorkspace> {
  const db = testDb();
  const owner = await ensureTestUser(db);
  const createdBy = owner.id;

  failOn(
    "tenants",
    (
      await db.from("tenants").upsert([
        { id: TEST_TENANT_ID, company_name: TEST_TENANT_LABEL },
        { id: FOREIGN_TENANT_ID, company_name: FOREIGN_TENANT_LABEL },
      ])
    ).error,
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
      id: SHARED_LINK_IDS[index],
      workspace_id: TEST_WORKSPACE_ID,
      category_header: "Getting started",
      link_label: `Shared resource ${index + 1} ${VISIBLE_TOKEN}`,
      url_string: url,
      display_order: index,
      visibility: "shared",
    })),
    ...PRIVATE_LINK_URLS.map((url, index) => ({
      id: PRIVATE_LINK_IDS[index],
      workspace_id: TEST_WORKSPACE_ID,
      category_header: "Internal",
      link_label: `Private resource ${index + 1} ${LEAK_TOKEN}`,
      url_string: url,
      display_order: index,
      visibility: "private",
    })),
    // Ticket 30's toggle/resource-type rows (TEST_TOGGLE_LINK_ID,
    // TEST_PRIVATE_RESOURCE_TYPE_LINK_ID) are DELIBERATELY NOT seeded here.
    // tests/harness/seed-leaky-workspace.spec.ts and
    // tests/plans/portal-payload.spec.ts both assert exact shared/private
    // counts against this base set ("three shared and two private links");
    // adding rows here regressed both. tests/security/link-visibility-
    // toggle.spec.ts inserts and cleans up its own two rows instead — see
    // that file's beforeAll — while still importing the id/url constants
    // exported below so the two files can't drift on what those ids mean.
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
          // Shares display_order with TEST_BUYER_STEP_ID on purpose. plan_stages
          // and plan_steps carry no unique constraint on display_order (0005
          // leaves it a plain index so the builder can reorder by rewriting the
          // whole set), so ties are legal and reachable — this is what the
          // id-tiebreak in assemblePlanTree exists to make deterministic.
          id: TEST_TIED_STEP_ID,
          stage_id: TEST_STAGE_TWO_ID,
          label: `Share the rollout timeline ${VISIBLE_TOKEN}`,
          owner_side: "seller",
          status: "open",
          display_order: 1,
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

  // A workspace under this tenant with no plan. Kept deliberately bare so
  // "no plan returns null" is read from a real row rather than a missing one —
  // a nonexistent workspace id would return null for the wrong reason.
  failOn(
    "workspaces (empty)",
    (
      await db.from("workspaces").upsert({
        id: EMPTY_WORKSPACE_ID,
        tenant_id: TEST_TENANT_ID,
        target_company_name: `No Plan Co ${VISIBLE_TOKEN}`,
        target_domain: "no-plan-test.invalid",
        created_by: createdBy,
      })
    ).error,
  );

  // The RLS control: a different tenant entirely. created_by reuses the same
  // auth user because created_by grants nothing — every policy keys off
  // workspaces.tenant_id, so this workspace stays invisible to the AE above.
  failOn(
    "workspaces (foreign)",
    (
      await db.from("workspaces").upsert({
        id: FOREIGN_WORKSPACE_ID,
        tenant_id: FOREIGN_TENANT_ID,
        target_company_name: "Foreign Tenant Co",
        target_domain: "foreign-test.invalid",
        created_by: createdBy,
      })
    ).error,
  );

  failOn(
    "success_plans (foreign)",
    (
      await db.from("success_plans").upsert({
        id: FOREIGN_PLAN_ID,
        workspace_id: FOREIGN_WORKSPACE_ID,
        title: "Foreign tenant plan",
        status: "active",
      })
    ).error,
  );

  // One stage, zero steps — the "stages but no steps assembles without error"
  // case. An empty nested array comes back from PostgREST as [], not null, but
  // assemblePlanTree tolerates either.
  failOn(
    "plan_stages (foreign)",
    (
      await db.from("plan_stages").upsert({
        id: FOREIGN_STAGE_ID,
        plan_id: FOREIGN_PLAN_ID,
        title: "Stage with no steps",
        display_order: 0,
        status: "upcoming",
      })
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
    ownerEmail: TEST_OWNER_EMAIL,
    ownerPassword: owner.password,
    emptyWorkspaceId: EMPTY_WORKSPACE_ID,
    foreignTenantId: FOREIGN_TENANT_ID,
    foreignWorkspaceId: FOREIGN_WORKSPACE_ID,
    foreignPlanId: FOREIGN_PLAN_ID,
  };
}

export async function teardownLeakyWorkspace(): Promise<void> {
  const db = testDb();

  // Scoped by tenant rather than by the sentinel workspace id, so a test that
  // creates an extra workspace under this tenant still gets cleaned up.
  const { data: workspaces } = await db
    .from("workspaces")
    .select("id")
    .in("tenant_id", [TEST_TENANT_ID, FOREIGN_TENANT_ID]);

  const workspaceIds = (workspaces ?? []).map((row: { id: string }) => row.id);

  if (workspaceIds.length > 0) {
    // links and portal_access_tokens have NO on delete cascade (migration 0001),
    // so deleting the workspace first would fail on a foreign-key violation.
    // workspace_analytics and success_plans -> plan_stages -> plan_steps do cascade.
    await db.from("links").delete().in("workspace_id", workspaceIds);
    await db.from("portal_access_tokens").delete().in("workspace_id", workspaceIds);
    await db.from("workspaces").delete().in("id", workspaceIds);
  }

  await db.from("tenants").delete().in("id", [TEST_TENANT_ID, FOREIGN_TENANT_ID]);

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list?.users.find((user) => user.email === TEST_OWNER_EMAIL);
  if (owner) await db.auth.admin.deleteUser(owner.id);
}
