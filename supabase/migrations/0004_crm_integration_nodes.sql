-- Sprint 3, Ticket 13: CRM Integration Nodes Migration
-- Anchor columns so inbound CRM webhook payloads (HubSpot/Salesforce mocks)
-- can be committed, deduplicated, and tenant-isolated by the automated
-- provisioner (Tickets 14/15).
--
-- Scope ruling (approved deviation from the raw 1.2 PRD DDL):
--   * NO workspace_whitelisted_buyers table. The buyer whitelist remains the
--     existing workspaces.approved_emails text[] from 0001 — the provisioner
--     appends into it. Two competing whitelist mechanisms are forbidden.
--   * The PRD's `REFERENCES workspaces(id) ON DELETE CASCADE NOT EXISTS`
--     snippet is invalid SQL and lived only on that dropped table — n/a here.

-- crm_source / crm_object_id are nullable by design: Sprint 1/2 workspaces are
-- created manually and have no CRM anchor. trigger_stage's default backfills
-- existing rows with 'evaluation' (the PRD's default trigger); the webhook
-- filter (Ticket 14) reads this column, never a hardcoded literal.
alter table workspaces
  add column if not exists crm_source varchar(50),
  add column if not exists crm_object_id varchar(255),
  add column if not exists trigger_stage varchar(100) default 'evaluation';

-- Tenant-scoped dedupe guard: the same CRM deal may not provision twice within
-- a tenant (webhook retries, duplicate fires). Postgres treats NULLs as
-- distinct in unique indexes, so the many manually-created workspaces with
-- NULL crm columns never collide with each other or with CRM-anchored rows.
create unique index if not exists idx_workspaces_tenant_crm
  on workspaces (tenant_id, crm_source, crm_object_id);

-- No RLS changes required: the new columns live on workspaces, whose existing
-- "AE manages own tenant workspaces" policy (0001) already scopes every
-- authenticated read/write by the (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
-- claim. Provisioner writes go through the service-role client
-- (lib/supabase/admin.ts) and bypass RLS, matching the Sprint 1/2 pattern.

-- Down / rollback (manual — uncomment and run only to reverse this migration):
--   drop index if exists idx_workspaces_tenant_crm;
--   alter table workspaces
--     drop column if exists crm_source,
--     drop column if exists crm_object_id,
--     drop column if exists trigger_stage;
