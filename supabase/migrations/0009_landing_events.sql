-- Sprint 9, Ticket 48: landing-page headline variant instrumentation for the
-- Brava landing page (getbrava.tech). Applied by pasting into the Supabase
-- SQL Editor per this project's migration workflow (no CLI link/psql
-- available).
--
-- Threat model: identical shape to 0008's waitlist_signups -- this table is
-- written to by a PUBLIC, unauthenticated endpoint
-- (app/api/landing-events/route.ts). An impression event carries no auth
-- context and creates no session, so RLS here is the same "enabled, zero
-- policies" default-deny shape as 0002's portal_access_tokens and 0008's
-- waitlist_signups: nobody except service_role should ever read or write
-- this table directly. The app's only writer (lib/supabase/admin.ts,
-- service-role) bypasses RLS entirely by design, so it needs no policy
-- carved out to keep working.
--
-- No PII lives here, by construction, not by convention: the table has
-- exactly two caller-supplied columns -- `variant` (validated against the
-- closed HEADLINE_VARIANT_IDS enum in app/landing-variants.ts before
-- insert, never trusted as free text off the wire -- see the route's
-- header) and `event_type` (validated to the literal "impression" before
-- insert, with a check constraint holding that same line at the database
-- layer too). No email, no name, no IP address, no user-agent, no
-- session/cookie identifier, and no free-text field of any kind is
-- accepted by the route or has a column here. Contrast with
-- waitlist_signups, which exists specifically to capture an email; this
-- table exists specifically not to.
--
-- `event_type` is a text column with a check constraint (not a Postgres
-- enum type) restricting it to 'impression' today, matching this schema's
-- existing preference for check-constrained text over enum types (see
-- 0001's status columns) -- when a second event type is needed (e.g. a
-- later click-through event), the constraint gets a migration to widen it,
-- rather than a schema-wide enum-alteration migration.

begin;

create table if not exists landing_events (
  id uuid primary key default gen_random_uuid(),
  variant text not null check (char_length(variant) <= 64),
  event_type text not null check (event_type = 'impression'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_landing_events_created_at
  on landing_events (created_at desc);

create index if not exists idx_landing_events_variant
  on landing_events (variant);

alter table landing_events enable row level security;

-- Deliberately NO policies of any kind -- RLS enabled with zero policies is
-- default-deny for anon/authenticated, exactly like waitlist_signups (0008)
-- and portal_access_tokens (0002). The endpoint that writes here
-- (app/api/landing-events/route.ts) uses the service-role client
-- (lib/supabase/admin.ts), which bypasses RLS entirely, so it needs no
-- policy carved out to keep working.

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     drop index if exists idx_landing_events_variant;
--     drop index if exists idx_landing_events_created_at;
--     drop table if exists landing_events;
--   commit;
