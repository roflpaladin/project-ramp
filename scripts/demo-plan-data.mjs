// Sprint 5 · Ticket 27 — the Acme Logistics demo plan, as data.
//
// Content is lifted from `Project Ramp/ramp-sprint5-prototype.html`, the locked
// UI source of truth (PRD §1), so the built product and the prototype can be put
// side by side without anyone squinting at whether a difference is the data or
// the rendering.
//
// Split out of seed-demo.mjs because it is content, not procedure: the seeding
// mechanics are ~90 lines and the plan is ~200, and mixing them makes both
// harder to review.
//
// Every id below is a fixed sentinel, not gen_random_uuid(). That is what makes
// the seed idempotent — a re-run upserts onto the same rows instead of stacking
// a second copy of the plan. The `de3X0000` prefix follows the demo convention
// established by lib/demo.ts.
//
// DATES ARE RELATIVE TO RUN TIME, deliberately. A demo seeded with literal dates
// shows a plan that expired weeks ago the next time someone rehearses. Every
// date here is an offset in days from the moment the seed runs, so the runway
// banner always renders a live mid-plan position: day 12 of a 30-day plan.

const DAY_MS = 24 * 60 * 60 * 1000;

// The prototype's runway card reads "18 days left · of a 30-day plan" and
// "you're on day 12". Those three numbers have to agree, so they all derive
// from this one pair of offsets.
const PLAN_START_OFFSET = -12;
const PLAN_TARGET_OFFSET = 18;

const PLAN_ID = "de310000-0000-4000-8000-000000000001";

/** Postgres `date` — "YYYY-MM-DD", not a timestamp. */
function planDate(runAt, dayOffset) {
  return new Date(runAt.getTime() + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** Postgres `timestamptz` — full ISO-8601. */
function planTimestamp(runAt, dayOffset) {
  return new Date(runAt.getTime() + dayOffset * DAY_MS).toISOString();
}

// The people in the prototype. Seller = Meridian, buyer = Acme Logistics.
const SARA = { name: "Sara Reyes", email: "sara.reyes@meridian.example.com" };
const NADIA = { name: "Nadia Okonjo", email: "nadia.okonjo@meridian.example.com" };
const DIMAS = { name: "Dimas W.", email: "dimas.w@acme-logistics.example.com" };
const PRIYA = { name: "Priya Nandan", email: "priya.nandan@acme-logistics.example.com" };
const FINANCE = { name: "Finance", email: "finance@acme-logistics.example.com" };

export const DEMO_APPROVED_EMAILS = [DIMAS.email, PRIYA.email, FINANCE.email];

// Buyer-visible chat link-out and the seller war room (PRD §2.4). Different
// HOSTS, not just different paths, so a value-level grep in the Ticket 26 suite
// cannot pass by accidentally matching a shared prefix.
const CHAT_URL = "https://acme-logistics.slack.example.com/archives/meridian-acme-shared";
const INTERNAL_CHAT_URL = "https://internal-only.example.com/meridian/warroom-acme";

/**
 * Workspace-level demo fields: the chat link-outs plus the cached CRM
 * reflection (PRD §5.1), mocked to match the prototype's private strip.
 *
 * Every field here is on the Ticket 25 strip list. They are seeded precisely so
 * the Ticket 26 leakage suite has something real to prove absent from the buyer
 * payload — a boundary test against a workspace with no private data proves
 * nothing.
 */
export function buildDemoWorkspaceFields(runAt) {
  return {
    chat_url: CHAT_URL,
    internal_chat_url: INTERNAL_CHAT_URL,
    crm_source: "salesforce",
    crm_object_id: "0063x00000AbcDeAAA",
    crm_stage: "Evaluation",
    crm_amount: 84000.0,
    crm_close_date: planDate(runAt, PLAN_TARGET_OFFSET + 6),
    crm_forecast_category: "Best case",
    // A cache without a staleness marker is a lie — the seller strip renders
    // this as "as of <time>".
    crm_synced_at: planTimestamp(runAt, 0),
  };
}

export function buildDemoPlan(runAt) {
  return {
    id: PLAN_ID,
    title: "Onboarding success plan · Acme Logistics",
    start_date: planDate(runAt, PLAN_START_OFFSET),
    target_date: planDate(runAt, PLAN_TARGET_OFFSET),
    status: "active",
  };
}

/**
 * Five stages, matching the prototype.
 *
 * Ticket 27's prose names four ("Align on goals → Product & proof →
 * Commercials → Go-live"), but the prototype renders Technical validation and
 * Security review as separate rows with separate statuses — in progress vs
 * blocked — and its runway card reads "2 of 5 stages done". Collapsing them
 * into one "Product & proof" stage deletes the blocked row the rail exists to
 * surface. The binding acceptance criterion is "renders the full prototype
 * without hand-editing rows", so the prototype wins over the prose.
 */
export function buildDemoStages() {
  return [
    { id: "de320000-0000-4000-8000-000000000001", title: "Align on goals", display_order: 0, status: "done" },
    { id: "de320000-0000-4000-8000-000000000002", title: "Technical validation", display_order: 1, status: "current" },
    // 'blocked' is a STEP status, not a stage status — migration 0005 pins
    // plan_stages.status to (upcoming, current, done). The prototype's red
    // "Blocked" chip on this stage is derived from its step, never stored.
    { id: "de320000-0000-4000-8000-000000000003", title: "Security review", display_order: 2, status: "upcoming" },
    { id: "de320000-0000-4000-8000-000000000004", title: "Commercials", display_order: 3, status: "upcoming" },
    { id: "de320000-0000-4000-8000-000000000005", title: "Go-live", display_order: 4, status: "upcoming" },
  ];
}

/**
 * Steps, keyed to the stage ids above.
 *
 * Two invariants migration 0005 enforces that this data must respect:
 *   - plan_steps_completion_coherent: (status = 'done') = (completed_at is not null)
 *   - owner_side is exactly 'seller' or 'buyer'; there is no 'both'
 *
 * The rail has nothing to show without a blocked step and an overdue one, so
 * both are deliberate and marked below.
 */
export function buildDemoSteps(runAt) {
  return [
    // ── Align on goals ────────────────────────────────────────────────────
    {
      id: "de330000-0000-4000-8000-000000000001",
      stage_id: "de320000-0000-4000-8000-000000000001",
      label: "Success criteria agreed",
      owner_side: "seller",
      owner_name: SARA.name,
      owner_email: SARA.email,
      due_date: planDate(runAt, PLAN_START_OFFSET + 1),
      status: "done",
      display_order: 0,
      completed_at: planTimestamp(runAt, PLAN_START_OFFSET + 1),
      completed_by_email: SARA.email,
      private_note: "Acme's exec sponsor skipped the goals call. Dimas is carrying this alone — no second thread into the account yet.",
    },

    // ── Technical validation (the current stage) ──────────────────────────
    {
      id: "de330000-0000-4000-8000-000000000002",
      stage_id: "de320000-0000-4000-8000-000000000002",
      label: "Deliver sandbox environment & sample repo",
      owner_side: "seller",
      owner_name: NADIA.name,
      owner_email: NADIA.email,
      due_date: planDate(runAt, -4),
      status: "done",
      display_order: 0,
      completed_at: planTimestamp(runAt, -4),
      completed_by_email: NADIA.email,
      private_note: null,
    },
    {
      // The prototype's "Your move" signal card — the one step the buyer lands on.
      id: "de330000-0000-4000-8000-000000000003",
      stage_id: "de320000-0000-4000-8000-000000000002",
      label: "Confirm the technical validation call",
      owner_side: "buyer",
      owner_name: DIMAS.name,
      owner_email: DIMAS.email,
      due_date: planDate(runAt, 2),
      status: "open",
      display_order: 1,
      completed_at: null,
      completed_by_email: null,
      private_note: "Proposed Thursday 2pm. If there's no reply by Tuesday, call his mobile — email has been slow all cycle.",
    },
    {
      id: "de330000-0000-4000-8000-000000000004",
      stage_id: "de320000-0000-4000-8000-000000000002",
      label: "Run API sandbox test",
      owner_side: "seller",
      owner_name: NADIA.name,
      owner_email: NADIA.email,
      due_date: planDate(runAt, 3),
      status: "open",
      display_order: 2,
      completed_at: null,
      completed_by_email: null,
      private_note: null,
    },

    // ── Security review ───────────────────────────────────────────────────
    {
      // DELIBERATE: the blocked step. Also past due, which is what drives the
      // prototype's "overdue 2 days" line in the blockers rail.
      id: "de330000-0000-4000-8000-000000000005",
      stage_id: "de320000-0000-4000-8000-000000000003",
      label: "Complete security questionnaire",
      owner_side: "buyer",
      owner_name: PRIYA.name,
      owner_email: PRIYA.email,
      due_date: planDate(runAt, -2),
      status: "blocked",
      display_order: 0,
      completed_at: null,
      completed_by_email: null,
      private_note: "Priya hasn't opened it. Legal flagged our SOC 2 Type II renewal date — answer if asked, don't volunteer it.",
    },

    // ── Commercials ───────────────────────────────────────────────────────
    {
      id: "de330000-0000-4000-8000-000000000006",
      stage_id: "de320000-0000-4000-8000-000000000004",
      label: "Share pricing summary",
      owner_side: "seller",
      owner_name: SARA.name,
      owner_email: SARA.email,
      due_date: planDate(runAt, -1),
      status: "done",
      display_order: 0,
      completed_at: planTimestamp(runAt, -1),
      completed_by_email: SARA.email,
      private_note: null,
    },
    {
      id: "de330000-0000-4000-8000-000000000007",
      stage_id: "de320000-0000-4000-8000-000000000004",
      label: "Review pricing summary",
      owner_side: "buyer",
      owner_name: FINANCE.name,
      owner_email: FINANCE.email,
      due_date: planDate(runAt, 10),
      status: "open",
      display_order: 1,
      completed_at: null,
      completed_by_email: null,
      private_note: null,
    },
    {
      // DELIBERATE: the overdue step — due_date in the past with status 'open'.
      // Kept distinct from the blocked step above because Ticket 27 asks for
      // both, and one row cannot demonstrate two different rail treatments.
      id: "de330000-0000-4000-8000-000000000008",
      stage_id: "de320000-0000-4000-8000-000000000004",
      label: "Budget confirmation",
      owner_side: "buyer",
      owner_name: FINANCE.name,
      owner_email: FINANCE.email,
      due_date: planDate(runAt, -3),
      status: "open",
      display_order: 2,
      completed_at: null,
      completed_by_email: null,
      private_note: "Still no named finance approver. This is the single biggest risk to closing in the quarter.",
    },

    // ── Go-live ───────────────────────────────────────────────────────────
    {
      id: "de330000-0000-4000-8000-000000000009",
      stage_id: "de320000-0000-4000-8000-000000000005",
      label: "Kickoff onboarding",
      owner_side: "seller",
      owner_name: SARA.name,
      owner_email: SARA.email,
      due_date: planDate(runAt, PLAN_TARGET_OFFSET),
      status: "open",
      display_order: 0,
      completed_at: null,
      completed_by_email: null,
      private_note: null,
    },
  ];
}

/**
 * Resources, from the prototype's "Resources in this workspace" card.
 * Five shared, two private.
 *
 * `visibility` is written explicitly on EVERY row — never left to the migration
 * 0005 column default. That default exists to backfill rows predating the
 * column; the moment it starts carrying new inserts, "is this buyer-visible?"
 * becomes a question about a migration rather than about this list.
 *
 * The two private URLs are duplicated in lib/demo.ts as
 * DEMO_PRIVATE_RESOURCE_URLS so the Ticket 26 suite can assert on these exact
 * values. Keep the two lists in sync. The host is distinctive on purpose: a
 * bare example.com would false-pass against any incidental match.
 */
export function buildDemoResources() {
  return [
    { id: "de340000-0000-4000-8000-000000000001", category_header: "Product & proof", link_label: "Platform overview", url_string: "https://meridian.example.com/overview.pdf", display_order: 0, visibility: "shared", resource_type: "pdf" },
    { id: "de340000-0000-4000-8000-000000000002", category_header: "Product & proof", link_label: "Logistics-sector case study", url_string: "https://meridian.example.com/case/acme-sector", display_order: 1, visibility: "shared", resource_type: "web" },
    { id: "de340000-0000-4000-8000-000000000003", category_header: "Technical", link_label: "API documentation", url_string: "https://docs.meridian.example.com/api", display_order: 0, visibility: "shared", resource_type: "doc" },
    { id: "de340000-0000-4000-8000-000000000004", category_header: "Technical", link_label: "Integration sample repo", url_string: "https://github.example.com/meridian/acme-sample", display_order: 1, visibility: "shared", resource_type: "repo" },
    { id: "de340000-0000-4000-8000-000000000005", category_header: "Call recordings", link_label: "Technical deep-dive", url_string: "https://meridian.example.com/recordings/tech-deep-dive-acme", display_order: 0, visibility: "shared", resource_type: "recording" },
    { id: "de340000-0000-4000-8000-000000000006", category_header: "Call recordings", link_label: "Internal deal review", url_string: "https://internal-only.example.com/meridian/deal-review-acme", display_order: 1, visibility: "private", resource_type: "recording" },
    { id: "de340000-0000-4000-8000-000000000007", category_header: "Commercials", link_label: "Pricing floor & discount authority", url_string: "https://internal-only.example.com/meridian/pricing-floor-acme", display_order: 0, visibility: "private", resource_type: "doc" },
  ];
}
