// Sprint 4 — Pitch-Ready Live Demo Engine. Canonical identifiers for the
// seeded demo tenant (Ticket 17). The sandbox (18), telemetry pulse (20) and
// reset (21) all scope to these constants so the demo can never touch or
// expose a real tenant's data.
//
// NOTE: scripts/seed-demo.mjs duplicates DEMO_TENANT_ID / DEMO_OWNER_EMAIL /
// DEMO_TENANT_LABEL because it is plain Node (run before/without the TS build)
// and cannot import this module. Keep the two in sync.

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

// Curated sample deal-room resources (Ticket 19). A webhook-provisioned
// workspace has no links of its own, so the buyer would have nothing to click
// for the live pulse (Ticket 20). These are seeded into a demo workspace on the
// buyer's first entry (idempotent, demo-tenant-scoped) so every pitch has real,
// named resources to click. url_string points at stable public pages so the
// click both logs (link_click) and lands somewhere real. Purged by reset (21).
export const DEMO_LINKS: {
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
}[] = [
  { category_header: "Success Plan", link_label: "Mutual Action Plan", url_string: "https://www.notion.so/product", display_order: 0 },
  { category_header: "Success Plan", link_label: "Executive Summary Deck", url_string: "https://www.figma.com", display_order: 1 },
  { category_header: "Technical", link_label: "Enterprise Architecture Blueprint", url_string: "https://vercel.com/docs", display_order: 0 },
  { category_header: "Technical", link_label: "Security & Compliance Pack", url_string: "https://www.cloudflare.com/trust-hub/", display_order: 1 },
];
