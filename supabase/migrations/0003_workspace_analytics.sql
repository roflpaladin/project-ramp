-- Sprint 2, Ticket 9: Analytics Table & Tenant RLS
-- Event-auditing table for buyer portal interactions, feeding the telemetry
-- engine (Ticket 11) and the seller-dashboard analytics feed. Tenant
-- isolation is enforced the same way as `links`: no direct tenant_id column,
-- isolation inherited transitively via workspace_id -> workspaces.tenant_id.

create table if not exists workspace_analytics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  link_id uuid references links (id) on delete set null,
  buyer_email text not null,
  action_type text not null check (action_type in ('portal_view', 'link_click')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_analytics_workspace on workspace_analytics (workspace_id);
create index if not exists idx_analytics_created_at on workspace_analytics (created_at desc);

alter table workspace_analytics enable row level security;

-- Sellers may read only their own tenant's events.
create policy "AE reads own tenant analytics"
  on workspace_analytics for select
  using (
    exists (
      select 1 from workspaces w
      where w.id = workspace_analytics.workspace_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );

-- Deliberately no INSERT policy: default-deny for anon/authenticated roles,
-- matching the portal_access_tokens pattern. Writes happen exclusively
-- through the service-role client (lib/supabase/admin.ts) from /api/track
-- and the buyer portal view handler, which bypass RLS entirely.
