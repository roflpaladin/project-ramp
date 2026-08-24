-- Sprint 10, Ticket 52 code-review fix (LOW): crm_connections.connected_by
-- FK follow-up. 0010_crm_connections.sql (already applied to dev) declared
-- `connected_by uuid references auth.users (id)` with NO explicit `on
-- delete` clause, which defaults to Postgres's implicit `on delete no
-- action` (== `restrict`): deleting an auth.users row that some
-- crm_connections row still points at as `connected_by` would fail outright
-- instead of the connection row surviving with that column simply cleared.
-- `connected_by` is attribution-only (see 0010's own header and
-- lib/hubspot/token-store.ts's SaveTenantTokensInput.connectedBy doc
-- comment) — the connection itself is keyed by (tenant_id, provider), not by
-- who connected it, so losing that one attribution value on a deleted user
-- should never be able to block deleting the user or leave a dangling
-- reference. `on delete set null` is the correct behaviour here.
--
-- Ships as its own follow-up migration rather than an edit to 0010 —
-- 0010 has already been applied to dev (this project's SQL-Editor-only
-- migration workflow, docs/environments.md, has no "amend an applied
-- migration" step; a later migration is how a mistake in an applied one
-- gets corrected). Do NOT edit 0010_crm_connections.sql itself.
--
-- Constraint name is Postgres's own auto-generated default for an inline,
-- unnamed column-level FK on `crm_connections.connected_by` referencing
-- `auth.users(id)`: `<table>_<column>_fkey`. Dropped with IF EXISTS so this
-- migration is safe to re-run (and safe even if a prior manual fix already
-- renamed or dropped it) before recreating it, named explicitly this time,
-- with the corrected `on delete` clause.

begin;

alter table crm_connections
  drop constraint if exists crm_connections_connected_by_fkey;

alter table crm_connections
  add constraint crm_connections_connected_by_fkey
  foreign key (connected_by) references auth.users (id) on delete set null;

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     alter table crm_connections
--       drop constraint if exists crm_connections_connected_by_fkey;
--     alter table crm_connections
--       add constraint crm_connections_connected_by_fkey
--       foreign key (connected_by) references auth.users (id);
--   commit;
