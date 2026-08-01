// Sprint 4 — Pitch-Ready Live Demo Engine. Canonical identifiers for the
// seeded demo tenant (Ticket 17). The sandbox (18), telemetry pulse (20) and
// reset (21) all scope to these constants so the demo can never touch or
// expose a real tenant's data.
//
// NOTE: scripts/seed-demo.mjs duplicates the identifier constants below because
// it is plain Node (run before/without the TS build) and cannot import this
// module. Keep the two in sync.

// Fixed sentinel UUID (deliberately not gen_random_uuid) so the demo tenant is
// deterministic and idempotently upsertable across pitch cycles.
export const DEMO_TENANT_ID = "de300000-0000-4000-8000-000000000001";

// Must equal the owner_email the sandbox mock webhook sends (Ticket 18) so the
// v1.2 provisioner (lib/crm/tenant.ts) resolves it to this tenant instead of
// returning the 401 owner-lookup failure that would kill the live demo.
export const DEMO_OWNER_EMAIL = "ae_user@projectramp.com";

// Human-readable label — how the demo tenant is distinguished from real tenants
// (Ticket 17) and how the reset purge scopes its deletes (Ticket 21).
export const DEMO_TENANT_LABEL = "DEMO — Project Ramp";

// The seeded demo deal room (Ticket 27). Before this ticket the only demo
// workspace was the one the sandbox webhook provisioned mid-pitch, under a
// random id — nothing a success plan could be hung off deterministically. This
// fixed sentinel gives the seed a stable target so `npm run seed:demo` produces
// the same rehearsable workspace every time. Reset (Ticket 21) deletes it along
// with every other demo workspace; re-running the seed brings it back identical.
export const DEMO_WORKSPACE_ID = "de300000-0000-4000-8000-000000000002";

// The buyer side of the prototype's Meridian × Acme Logistics deal.
export const DEMO_TARGET_COMPANY = "Acme Logistics";
export const DEMO_TARGET_DOMAIN = "acme-logistics.example.com";

// The private resources the seed plants in the demo workspace. Exported so the
// Ticket 26 buyer-leakage suite can assert on these exact URL VALUES rather than
// only on field names — a payload that strips the `visibility` key but still
// emits the url_string passes a key-level check and fails a real buyer.
// Distinctive host on purpose: a bare example.com would false-pass against any
// incidental match. Mirrored as literals in scripts/seed-demo.mjs.
export const DEMO_PRIVATE_RESOURCE_URLS: readonly string[] = [
  "https://internal-only.example.com/meridian/deal-review-acme",
  "https://internal-only.example.com/meridian/pricing-floor-acme",
];

// Curated sample deal-room resources (Ticket 19). A webhook-provisioned
// workspace has no links of its own, so the buyer would have nothing to click
// for the live pulse (Ticket 20). These are seeded into a demo workspace on the
// buyer's first entry (idempotent, demo-tenant-scoped) so every pitch has real,
// named resources to click. url_string points at stable public pages so the
// click both logs (link_click) and lands somewhere real. Purged by reset (21).
// `visibility` is written explicitly on every entry, never left to the column
// default added in migration 0005. The default exists to backfill rows that
// predate the column; the moment it starts carrying new inserts, "is this buyer
// -visible?" becomes a question about a migration rather than about this list.
export const DEMO_LINKS: {
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
  visibility: "shared" | "private";
}[] = [
  { category_header: "Success Plan", link_label: "Mutual Action Plan", url_string: "https://www.notion.so/product", display_order: 0, visibility: "shared" },
  { category_header: "Success Plan", link_label: "Executive Summary Deck", url_string: "https://www.figma.com", display_order: 1, visibility: "shared" },
  { category_header: "Technical", link_label: "Enterprise Architecture Blueprint", url_string: "https://vercel.com/docs", display_order: 0, visibility: "shared" },
  { category_header: "Technical", link_label: "Security & Compliance Pack", url_string: "https://www.cloudflare.com/trust-hub/", display_order: 1, visibility: "shared" },
];
