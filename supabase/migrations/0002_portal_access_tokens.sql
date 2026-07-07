-- Sprint 1: Security Gate
-- Not in the Master Schema — added here because the magic-link flow needs
-- somewhere to store issued codes. Buyers never get a Supabase Auth session
-- (they authenticate via this token, not Supabase Auth), so this table is
-- only ever touched by the service-role client (lib/supabase/admin.ts) from
-- Security Gate server actions — RLS is enabled with zero policies, i.e.
-- default-deny for the anon/authenticated roles, which is the point.

create table if not exists portal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id),
  email text not null,
  token_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table portal_access_tokens enable row level security;
