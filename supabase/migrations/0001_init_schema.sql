-- Sprint 1: Database Foundation & RLS
-- Schema per Notion "Technical Source of Truth" (Master Database Schema).
-- tenant_id on workspaces is the RLS anchor for the whole system; links has no
-- direct tenant_id and inherits isolation transitively via workspace_id.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  target_company_name text not null,
  target_domain text not null,
  created_by uuid not null references auth.users (id),
  -- Approved buyer emails for the Security Gate whitelist. Array (not a single
  -- string) to natively support multi-stakeholder enterprise deals.
  approved_emails text[] not null default '{}'
);

create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id),
  category_header text not null,
  link_label text not null,
  url_string text not null,
  display_order integer not null default 0
);

alter table tenants enable row level security;
alter table workspaces enable row level security;
alter table links enable row level security;

-- Design decision (not specified in the Master Schema, filled in here):
-- an AE's Supabase Auth session resolves to a tenant via a custom `tenant_id`
-- claim in auth.users.raw_app_meta_data, set when the AE account is provisioned
-- (manual/admin step in Phase 1 — see Auth & AE Login ticket; no self-serve
-- tenant signup exists yet). These policies only cover the AE (admin) path.
--
-- Buyer /portal reads do NOT go through these policies: buyers authenticate via
-- a magic-link token (Security Gate ticket), not Supabase Auth, so a portal
-- route must read through the service-role client (lib/supabase/admin.ts) after
-- validating the token, not through the anon/RLS-scoped client.

create policy "AE reads own tenant"
  on tenants for select
  using (id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

create policy "AE manages own tenant workspaces"
  on workspaces for all
  using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

create policy "AE manages own tenant links"
  on links for all
  using (
    exists (
      select 1 from workspaces w
      where w.id = links.workspace_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  )
  with check (
    exists (
      select 1 from workspaces w
      where w.id = links.workspace_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );
