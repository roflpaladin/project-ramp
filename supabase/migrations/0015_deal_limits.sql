-- Sprint 12, Ticket 60: the active-deal limit, enforced by the database.
--
-- Applied by pasting into the Supabase SQL Editor per this project's
-- migration workflow (no CLI link/psql available) — dev first, then prod,
-- same as every migration before it. Idempotent throughout (`add column if
-- not exists`, `create index if not exists`, `drop … if exists` ahead of the
-- function and the trigger this file owns), so it converges on a fresh
-- database AND on one that already ran an earlier draft.
--
-- ============================ VERIFY FIRST ==============================
-- R7 (the one real risk in this file). The go-live trigger below decides
-- what may make a plan live by matching `current_user` against a list of
-- role names. If that list is wrong, the SAMPLE-DEAL SEED BREAKS — every
-- new self-serve seller would fail onboarding — so check before pasting.
--
-- 1. In the SQL Editor on DEV, run (read-only, changes nothing):
--
--      select current_user, session_user;
--      select rolname from pg_roles
--       where rolname in ('service_role','postgres','supabase_admin',
--                         'authenticator','anon','authenticated')
--       order by rolname;
--
--    Expect the first to report a superuser-ish editor role (typically
--    `postgres`), and the second to list service_role, anon, authenticated
--    and authenticator — Supabase's standard set. If `service_role` is NOT
--    in that list, STOP: the trigger's allow-list below is wrong for this
--    project and every service-role write of an active plan would be
--    rejected.
--
-- 2. AFTER pasting on DEV, prove both halves behave:
--      a. Service role still may:  `npm run seed:demo` (service key) must
--         still create its ACTIVE plans, and the onboarding sample deal must
--         still seed.
--      b. A seller may not: signed in as an AE with the anon key, a direct
--         PostgREST PATCH of one of their OWN draft plans to
--         status='active' must fail with GO_LIVE_NOT_PERMITTED (P0001).
--         Going live through the app's own button must still work — it
--         takes the mark_plan_live() path below, on the service-role client.
-- ========================================================================
--
-- WHY THE DATABASE AND NOT JUST THE APP: 0005's "AE manages own tenant
-- plans" policy is `for all`, so a seller holding the public anon key can
-- PATCH or POST `status = 'active'` against PostgREST directly and walk
-- straight past any check made in application code. A paywall that lives
-- only in a server action is a suggestion. Only a trigger closes it.
--
-- WHY THE CAP IS AN ARGUMENT, NOT A COLUMN: tier caps (Free 1 / Starter 3 /
-- Pro 8 / Advanced and Enterprise unlimited) are product config in
-- lib/billing/plans.ts. A price or packaging change must never need a
-- migration, so mark_plan_live() is told the cap by its caller and only
-- enforces "under the number you were given" — atomically, which is the part
-- application code cannot do.
--
-- WHY SAMPLE WORKSPACES ARE EXCLUDED: a brand-new Free tenant is seeded with
-- an ACTIVE sample deal (lib/seed/sample-deal-data.ts). At a cap of 1 their
-- first REAL deal could never go live. Before this migration the sample was
-- recognisable only by its fictional target_domain — a string match the
-- paywall would have had to trust — so `workspaces.is_sample` makes it an
-- explicit, indexable fact.
--
-- NO closed_at COLUMN: closing a deal writes success_plans.status = 'won' /
-- 'lost', which 0005 already allows, and nothing this sprint reads "when was
-- it closed?". Not built (YAGNI).
--
-- CLOSING IS UNTOUCHED: the trigger only guards transitions INTO 'active'.
-- won/lost stay on the ordinary RLS path, which is what lets a seller close
-- their own deal — and 0005's unique index covers draft+active only, so a
-- closed plan leaves the workspace free for a new one.

begin;

-- 1. The sample-deal marker ------------------------------------------------

alter table workspaces
  add column if not exists is_sample boolean not null default false;

-- Backfills the sample workspaces seeded before this column existed. The
-- domain is lib/seed/sample-deal-data.ts's WORKSPACE_TARGET_DOMAIN — a
-- reserved .example.com name that can never belong to a real buyer. This is
-- the LAST time that string is used as an identity: from here on the column
-- is the fact. Narrowed to rows not already flagged so a re-paste is a no-op.
update workspaces
   set is_sample = true
 where is_sample = false
   and target_domain = 'meridian-retail.example.com';

-- 2. Indexes the limit reads ------------------------------------------------

-- Partial on purpose: every query behind the limit asks only about real
-- (non-sample) workspaces, and only about ACTIVE plans. Both indexes stay
-- small no matter how much draft/closed history a tenant accumulates.
create index if not exists idx_workspaces_tenant_not_sample
  on workspaces (tenant_id)
  where is_sample = false;

create index if not exists idx_success_plans_active
  on success_plans (workspace_id)
  where status = 'active';

-- 3. The one way a plan becomes live ---------------------------------------
--
-- Count-then-write in application code is not enough: two tabs (or two
-- devices) at a cap of 1 both read "0 active", both pass the check, and both
-- write. This function re-asks the question inside the same transaction as
-- the write, after taking a row lock on the TENANT — so the loser of a race
-- is rejected by the database rather than by a check it already passed. The
-- same reasoning as 0014's apply_tenant_subscription_event, with the same
-- shape: a text verdict, never a boolean.
--
--   'live'          the plan is now active.
--   'already_live'  it was already active; nothing written. Not an error —
--                   a second click or a retry must not read as failure.
--   'limit_reached' the tenant is at their cap; nothing written.
--   'not_found'     no DRAFT plan with that id in that tenant (wrong tenant,
--                   deleted, or already closed).
--
-- `p_max_active_deals` null means unlimited (Advanced, Enterprise, and every
-- manual entitlement).
--
-- `security invoker` (NOT definer): this function carries no privilege of
-- its own. Only the service-role client calls it, and it is the service
-- role's own rights — plus its membership of the trigger's allow-list below
-- — that let it write. A future caller who is not service-role gains
-- nothing by finding this function; the trigger would still refuse them.
--
-- Dropped before create so a re-paste over an earlier draft converges even
-- if its return type differed.
drop function if exists mark_plan_live(uuid, uuid, integer);

create function mark_plan_live(
  p_plan_id uuid,
  p_tenant_id uuid,
  p_max_active_deals integer
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_active_count integer;
begin
  -- Serialises every go-live for ONE tenant against every other. Cheap (one
  -- row, held only for this statement's transaction) and it is what makes
  -- the count below trustworthy. Tenants never contend with each other.
  perform 1 from tenants where id = p_tenant_id for update;

  -- The plan must be in the calling tenant. This is also the tenant check:
  -- a plan id from another tenant resolves to no row and is reported as
  -- 'not_found', never as a refusal that would confirm it exists.
  select sp.status
    into v_status
    from success_plans sp
    join workspaces w on w.id = sp.workspace_id
   where sp.id = p_plan_id
     and w.tenant_id = p_tenant_id;

  if v_status is null then
    return 'not_found';
  end if;

  if v_status = 'active' then
    return 'already_live';
  end if;

  -- A closed (won/lost) plan is not re-openable through this path.
  if v_status <> 'draft' then
    return 'not_found';
  end if;

  if p_max_active_deals is not null then
    select count(*)
      into v_active_count
      from success_plans sp
      join workspaces w on w.id = sp.workspace_id
     where w.tenant_id = p_tenant_id
       and w.is_sample = false
       and sp.status = 'active';

    if v_active_count >= p_max_active_deals then
      return 'limit_reached';
    end if;
  end if;

  update success_plans
     set status = 'active'
   where id = p_plan_id;

  return 'live';
end;
$$;

-- Service-role only, explicitly.
--
-- Two separate revokes on purpose (same reasoning as 0014): PUBLIC holds
-- EXECUTE on new functions by default in Postgres, AND Supabase additionally
-- grants EXECUTE to `anon` and `authenticated` through its own default
-- privileges — a grant made TO THOSE ROLES, which `revoke … from public`
-- does not touch. Both have to go.
revoke all on function mark_plan_live(uuid, uuid, integer) from public;
revoke all on function mark_plan_live(uuid, uuid, integer) from anon, authenticated;
grant execute on function mark_plan_live(uuid, uuid, integer) to service_role;

-- 4. The go-live guard -----------------------------------------------------
--
-- Refuses any transition INTO status 'active' unless the writer is one of
-- the roles that can only be the server (see VERIFY FIRST at the top of this
-- file). It is the half of the paywall a seller cannot route around: the
-- app's own go-live path runs mark_plan_live() on the service-role client
-- and is unaffected; a direct PostgREST PATCH with the anon key is not.
--
-- Deliberately NOT a check on how many deals are live — that number is
-- product config and belongs in the function above. This trigger answers one
-- question only: "did this come from the server?".
--
-- `security invoker` for the same reason 0007's reject_demo_tenant_hijack is:
-- a trigger function must add no privilege of its own.
create or replace function enforce_plan_go_live()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Everything that is not a plan becoming live passes straight through:
  -- drafts, edits, and closing a deal (won/lost) are all ordinary writes.
  if new.status <> 'active' then
    return new;
  end if;

  -- An UPDATE that leaves an already-active plan active (a title edit, a
  -- date change) is not a go-live. OLD is only read on the UPDATE branch —
  -- referencing it on INSERT would raise.
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  -- 'service_role' is what PostgREST switches to for the service key;
  -- 'postgres' is the SQL Editor and the migration itself; 'supabase_admin'
  -- is the dashboard's own table editor. Hardcoded rather than looked up:
  -- the list IS the contract (see VERIFY FIRST).
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    -- Message and SQLSTATE are application contract — lib/plans/errors.ts
    -- maps this pair to the GO_LIVE_NOT_PERMITTED code
    -- (GO_LIVE_NOT_PERMITTED_MESSAGE in lib/plans/constraints.ts).
    raise exception 'GO_LIVE_NOT_PERMITTED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_success_plans_go_live_guard on success_plans;

create trigger trg_success_plans_go_live_guard
  before insert or update on success_plans
  for each row
  execute function enforce_plan_go_live();

commit;

-- Down / rollback (manual — uncomment and run only to reverse this migration):
--   begin;
--     drop trigger if exists trg_success_plans_go_live_guard on success_plans;
--     drop function if exists enforce_plan_go_live();
--     drop function if exists mark_plan_live(uuid, uuid, integer);
--     drop index if exists idx_success_plans_active;
--     drop index if exists idx_workspaces_tenant_not_sample;
--     alter table workspaces drop column if exists is_sample;
--   commit;
