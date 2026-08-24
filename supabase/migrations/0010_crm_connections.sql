-- Sprint 10, Ticket 52: HubSpot OAuth & token lifecycle.
--
-- PROVIDER-AGNOSTIC on purpose: `provider` is a column, not a table name, so
-- a future Salesforce (or other) OAuth connection reuses this same table
-- rather than forking a near-duplicate one. HubSpot is the only provider
-- this ticket writes, hence the default.
--
-- `encrypted_refresh_token` is exactly that -- ciphertext produced by
-- lib/encrypt-secret.ts (AES-256-GCM, APP_ENCRYPTION_KEY), never a plaintext
-- refresh token. Access tokens are never persisted at all (lib/hubspot/
-- access-token-cache.ts holds them in memory only, per-instance, interim).
--
-- Same "RLS enabled, zero policies" shape as 0002's portal_access_tokens and
-- 0008's waitlist_signups -- default-deny for anon/authenticated. The only
-- writer/reader is the service-role client (lib/supabase/admin.ts, via
-- lib/hubspot/token-store.ts); no seller-facing query needs a row from this
-- table directly, so no policy is carved out to keep anything working.

begin;

create table if not exists crm_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  provider text not null default 'hubspot',
  -- HubSpot hub id today; a future Salesforce org id (or equivalent for any
  -- other provider) fits the same generic column rather than a per-provider one.
  external_account_id text,
  encrypted_refresh_token text not null,
  scope text,
  connected_by uuid references auth.users (id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table crm_connections enable row level security;

-- Deliberately NO policies of any kind -- RLS enabled with zero policies is
-- default-deny for anon/authenticated, exactly like portal_access_tokens
-- (0002) and waitlist_signups (0008). lib/hubspot/token-store.ts always
-- reads/writes through the service-role client, which bypasses RLS entirely,
-- so it needs no policy carved out to keep working.

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     drop table if exists crm_connections;
--   commit;
