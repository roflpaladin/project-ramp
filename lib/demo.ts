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
