-- Sprint 5, Ticket 26: DDL helpers for the buyer leakage suite
-- Plan ref: plans/sprint-5-mutual-success-plan-spine.md §2.3, Step 6 task 2
--
-- Depends on: 0001_init_schema.sql (workspaces).
--
-- WHY THIS FILE EXISTS
-- Ticket 26's new-column proof adds an unknown column to `workspaces` mid-suite
-- and asserts its value never reaches a buyer — proving the serializer is an
-- ALLOWLIST, not a hand-maintained denylist that a future migration can outrun.
-- The proof is only real if the column genuinely exists, because the thing under
-- test is that `select("*")` in the loaders surfaces it. Injecting the field onto
-- a row object in JS (tests/plans/portal-payload.spec.ts:180, Ticket 25) would
-- pass even if the loader were leaking, so it cannot stand in here.
--
-- supabase-js cannot execute raw DDL and this project has no exec_sql RPC. The
-- obvious fix — adding one — would put a permanent arbitrary-SQL entry point in
-- the database to satisfy a test, in a sprint whose entire purpose is proving
-- data cannot escape. These two functions are the narrow alternative: no SQL
-- string crosses the wire, each does exactly one hardcoded thing, and execute is
-- granted to service_role only.
--
-- TEST-ONLY. Safe to skip on production — nothing in the application calls these.
-- If they are applied to production they add no reachable surface: the anon and
-- authenticated roles cannot execute them, and service_role already holds full
-- DDL rights, so they grant no capability that role did not already have.

begin;

-- Adds the throwaway column used by the new-column proof.
-- Idempotent: the suite may retry, and a previous run may have died before its
-- afterAll cleanup landed (§2.3 — the suite must not leave the dev project dirty
-- in a way that makes the next run fail for the wrong reason).
create or replace function test_add_crm_arr()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table public.workspaces add column if not exists crm_arr numeric;
end;
$$;

-- Drops it again. Called from an afterAll that runs even on failure, so it must
-- tolerate the column already being gone.
create or replace function test_drop_crm_arr()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table public.workspaces drop column if exists crm_arr;
end;
$$;

-- security definer functions are executable by PUBLIC unless revoked. Without
-- these two statements the functions would be callable by the anon role — i.e.
-- by any buyer — handing an unauthenticated visitor the ability to mutate the
-- schema. Revoke first, then grant narrowly.
revoke execute on function test_add_crm_arr() from public;
revoke execute on function test_drop_crm_arr() from public;

grant execute on function test_add_crm_arr() to service_role;
grant execute on function test_drop_crm_arr() to service_role;

commit;

-- ROLLBACK
-- begin;
--   drop function if exists test_add_crm_arr();
--   drop function if exists test_drop_crm_arr();
--   alter table public.workspaces drop column if exists crm_arr;
-- commit;
