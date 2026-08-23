-- Sprint 9, Ticket 47 (phase 1): public waitlist capture for the Brava
-- landing page (getbrava.tech). Applied by pasting into the Supabase SQL
-- Editor per this project's migration workflow (no CLI link/psql available).
--
-- Threat model: same class as seller self-serve registration (0001's
-- `tenants`/`workspaces` insert path via app/register/actions.ts, T39) --
-- this table is written to by a PUBLIC, unauthenticated endpoint
-- (app/api/waitlist/route.ts). Unlike registration, a waitlist signup never
-- creates an auth.users row or a session, so RLS here is simpler than
-- anything tenant-scoped: nobody except service_role should ever read or
-- write this table directly. Same "RLS enabled, zero policies" shape as
-- 0002's portal_access_tokens -- default-deny for anon/authenticated, and
-- the app's only writer (lib/supabase/admin.ts, service-role) bypasses RLS
-- entirely by design, so it needs no policy to function.
--
-- `email` uniqueness is case-insensitive via a functional unique index on
-- lower(email), not a `citext` column -- citext isn't used anywhere else in
-- this schema (checked: no other migration enables it), and a functional
-- index gets the same guarantee without adding a new extension dependency.
-- The app additionally lowercases email before insert
-- (app/api/waitlist/route.ts), so the index is defense in depth, not the
-- only place normalization happens.
--
-- `company_name` mirrors the column name/shape already used for a
-- self-reported company name in `tenants.company_name` (0001) -- not
-- `workspaces.target_company_name`, which names the SELLER'S TARGET account,
-- a different concept. Nothing here mirrors a "name" (person) field: the
-- existing register flow (app/register/actions.ts) never asks for one, only
-- companyName + email + password, so none is invented here either.
--
-- `source` is free-text landing-variant/referrer attribution for T48 (not
-- yet built) -- always inserted as a parameterized value from the app, never
-- interpolated into SQL and never echoed back to the caller.

begin;

create table if not exists waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text,
  source text,
  created_at timestamptz not null default timezone('utc', now())
);

-- Case-insensitive uniqueness: "a@b.com" and "A@B.com" are the same signup.
create unique index if not exists idx_waitlist_signups_email_lower
  on waitlist_signups (lower(email));

create index if not exists idx_waitlist_signups_created_at
  on waitlist_signups (created_at desc);

alter table waitlist_signups enable row level security;

-- Deliberately NO policies of any kind -- RLS enabled with zero policies is
-- default-deny for anon/authenticated, exactly like portal_access_tokens
-- (0002). The endpoint that writes here (app/api/waitlist/route.ts) uses
-- the service-role client (lib/supabase/admin.ts), which bypasses RLS
-- entirely, so it needs no policy carved out to keep working.

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     drop index if exists idx_waitlist_signups_created_at;
--     drop index if exists idx_waitlist_signups_email_lower;
--     drop table if exists waitlist_signups;
--   commit;
