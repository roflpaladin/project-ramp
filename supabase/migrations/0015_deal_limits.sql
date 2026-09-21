-- Sprint 12, Ticket 60: the active-deal limit, enforced by the database.
--
-- Applied by pasting into the Supabase SQL Editor per this project's
-- migration workflow (no CLI link/psql available) — dev first, then prod,
-- same as every migration before it. Idempotent throughout, and every object
-- this file owns is dropped before it is created, so a re-paste converges on
-- a fresh database AND on one that ran an earlier draft.
--
-- ========================= VERIFY FIRST (4 queries) =======================
-- Paste these on DEV **before** the migration. They change nothing. Each has
-- one expected answer; if any disagrees, stop and say so rather than pasting.
--
--   1. The seed and the go-live button will still work:
--
--        begin;
--          set local role service_role;
--          select current_user = 'service_role' as seed_and_go_live_will_work;
--        rollback;
--
--      EXPECT: seed_and_go_live_will_work = true
--
--   2. A signed-in seller is blocked from going live behind our back:
--
--        begin;
--          set local role authenticated;
--          select not (
--            current_user in ('service_role', 'postgres', 'supabase_admin', 'dashboard_user')
--            or pg_has_role(current_user, 'service_role', 'member')
--          ) as seller_is_blocked;
--        rollback;
--
--      EXPECT: seller_is_blocked = true
--
--   3. No existing function can be used to walk around these guards (see
--      THE STANDING INVARIANT below):
--
--        select p.proname
--          from pg_proc p
--          join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public'
--           and p.prosecdef
--           and has_function_privilege('authenticated', p.oid, 'execute');
--
--      EXPECT: 0 rows.
--
--   4. Does any tenant already have MORE THAN ONE sample workspace? (The
--      pre-T60 seed could create several.) This one decides whether the
--      backfill below is a no-op or a judgement call:
--
--        select tenant_id, count(*) as sample_like_workspaces
--          from workspaces
--         where target_domain = 'meridian-retail.example.com'
--           and target_company_name = 'Sample deal — Meridian Retail Group'
--         group by tenant_id
--        having count(*) > 1
--         order by 2 desc;
--
--      EXPECT: 0 rows on a clean project. Any rows listed are fine — the
--      backfill flags only the OLDEST one per tenant and the others simply
--      stay countable deals — but it is worth knowing before, not after.
--
-- ------------------------- AFTER PASTING (2 proofs) -----------------------
-- Both run inside begin…rollback, so they leave nothing behind. Replace the
-- two ids with real ones from the dev project (a tenant, and a DRAFT plan in
-- that tenant).
--
--   A. A seller cannot make a plan live behind the paywall:
--
--        begin;
--          select set_config(
--            'request.jwt.claims',
--            '{"role":"authenticated","app_metadata":{"tenant_id":"<TENANT-UUID>"}}',
--            true);
--          set local role authenticated;
--          update success_plans set status = 'active' where id = '<DRAFT-PLAN-UUID>';
--        rollback;
--
--      EXPECT: a red error, GO_LIVE_NOT_PERMITTED.
--      !! "UPDATE 0" (no error) means RLS hid the row — the tenant id or the
--      plan id is wrong, and the test proved NOTHING. Fix the ids and redo it.
--
--   B. A seller cannot mark their own workspace as the sample:
--
--        begin;
--          select set_config(
--            'request.jwt.claims',
--            '{"role":"authenticated","app_metadata":{"tenant_id":"<TENANT-UUID>"}}',
--            true);
--          set local role authenticated;
--          update workspaces set is_sample = true where id = '<REAL-WORKSPACE-UUID>';
--        rollback;
--
--      EXPECT: a red error, SAMPLE_FLAG_NOT_PERMITTED. Same "UPDATE 0"
--      warning as above.
--
--   C. And the app still works: `npm run seed:demo` (service key) must still
--      create ACTIVE plans, onboarding's sample deal must still seed, and the
--      go-live button in the app must still work.
-- ==========================================================================
--
-- THE STANDING INVARIANT (read before adding any function to this schema):
-- every guard in this file identifies the writer by ROLE. A future
-- `security definer` function owned by postgres, that writes success_plans
-- or workspaces and is executable by `authenticated`, runs as its OWNER —
-- so is_server_write_role() would report true and the paywall would be
-- silently open through that function, with no error and no log. If such a
-- function is ever genuinely needed: keep it `security invoker`, or revoke
-- execute from anon/authenticated. Query 3 above is the audit for it.
--
-- WHY THE DATABASE AND NOT JUST THE APP: 0001's "AE manages own tenant
-- workspaces" and 0005's "AE manages own tenant plans" are both `for all`,
-- so a seller holding the public anon key can PATCH their own rows directly
-- against PostgREST and walk past any check made in application code. That
-- covers both halves of the limit: making a plan active, and marking a
-- workspace as the uncounted sample. A paywall that lives only in a server
-- action is a suggestion.
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
-- first REAL deal could never go live. And because the sample is free, it is
-- also capped at ONE per tenant and can never itself go live again — see
-- mark_plan_live's 'sample_workspace' verdict.
--
-- THE BACKFILL FLAGS ONE WORKSPACE PER TENANT — THE OLDEST. The pre-T60
-- seed was deliberately non-idempotent, so a tenant may hold several sample
-- workspaces today. Flagging all of them would (a) hand that tenant several
-- uncounted deals and (b) make the unique index below fail, aborting this
-- whole paste. Any extra sample-looking workspaces therefore stay
-- is_sample = false and simply count as ordinary deals, which is the
-- conservative direction. Matching is on BOTH the fictional target_domain
-- and the exact seeded company name, so a real customer cannot be captured
-- by it. Re-running this file is safe precisely BECAUSE the guard trigger
-- and the one-per-tenant index exist: the update below skips rows already
-- flagged, and any attempt to end up with two flagged rows in one tenant is
-- rejected by the index rather than silently applied.
--
-- NO closed_at COLUMN: closing a deal writes success_plans.status = 'won' /
-- 'lost', which 0005 already allows, and nothing this sprint reads "when was
-- it closed?". Not built (YAGNI).
--
-- CLOSING IS UNTOUCHED: the go-live trigger only guards transitions INTO
-- 'active'. won/lost stay on the ordinary RLS path, which is what lets a
-- seller close their own deal — and 0005's unique index covers draft+active
-- only, so a closed plan leaves the workspace free for a new one.

begin;

-- Never let this migration sit behind a long-running lock on a live table;
-- fail fast and be re-pasted instead.
set local lock_timeout = '5s';

-- 1. The sample-deal marker ------------------------------------------------

alter table workspaces
  add column if not exists is_sample boolean not null default false;

-- Oldest match per tenant only — see THE BACKFILL... in the header. The
-- string literals mirror WORKSPACE_TARGET_DOMAIN and
-- WORKSPACE_TARGET_COMPANY_NAME in lib/seed/sample-deal-data.ts (note the em
-- dash in the company name). This is the LAST time those strings are used as
-- an identity: from here on the column is the fact.
with ranked as (
  select id,
         row_number() over (partition by tenant_id order by created_at, id) as rn
    from workspaces
   where target_domain = 'meridian-retail.example.com'
     and target_company_name = 'Sample deal — Meridian Retail Group'
)
update workspaces w
   set is_sample = true
  from ranked r
 where w.id = r.id
   and r.rn = 1
   and w.is_sample = false;

-- 2. Indexes ---------------------------------------------------------------

-- tenant_id is the predicate in EVERY RLS policy on this table and had no
-- index at all before now. A partial index (is_sample = false) was considered
-- and rejected: it would serve the limit's own count and nothing else, while
-- this plain one serves every seller read as well.
drop index if exists idx_workspaces_tenant_not_sample;
drop index if exists idx_workspaces_tenant;
create index idx_workspaces_tenant on workspaces (tenant_id);

drop index if exists idx_success_plans_active;
create index idx_success_plans_active
  on success_plans (workspace_id)
  where status = 'active';

-- One free, uncounted deal per tenant — enforced, not assumed.
-- lib/seed/sample-deal.ts returns the existing sample rather than colliding
-- with this, and treats a collision (two clicks racing) as "already seeded".
drop index if exists idx_workspaces_one_sample_per_tenant;
create unique index idx_workspaces_one_sample_per_tenant
  on workspaces (tenant_id)
  where is_sample;

-- 3. Who counts as "the server"? -------------------------------------------
--
-- One predicate, used by both triggers below, so there is a single list to
-- get right (and a single place for query 2 in VERIFY FIRST to mirror).
--
-- `security invoker` IS LOAD-BEARING. As `security definer` this function
-- would run as its OWNER — postgres — and current_user would report
-- 'postgres' for every caller, so it would answer "yes, that's the server"
-- to a seller with the anon key and both guards below would be decoration.
--
-- pg_has_role covers the membership case (a role granted service_role rather
-- than being it); 'dashboard_user' is what the Supabase dashboard's own SQL
-- surfaces run as on some projects.
--
-- DELIBERATELY EXECUTABLE BY EVERYONE: the triggers call it as the writing
-- role, so anon/authenticated must hold EXECUTE or every ordinary write
-- would fail with "permission denied for function". It reads nothing and
-- reveals nothing but the caller's own role, which they already know.
drop function if exists is_server_write_role();

create function is_server_write_role()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin', 'dashboard_user')
      or pg_has_role(current_user, 'service_role', 'member');
$$;

-- 4. The one way a plan becomes live ---------------------------------------
--
-- Count-then-write in application code is not enough: two tabs (or two
-- devices) at a cap of 1 both read "0 active", both pass the check, and both
-- write. This function re-asks the question inside the same transaction as
-- the write, after taking a row lock on the TENANT — so the loser of a race
-- is rejected by the database rather than by a check it already passed. Same
-- shape as 0014's apply_tenant_subscription_event: a text verdict, never a
-- boolean.
--
--   'live'             the plan is now active.
--   'already_live'     it was already active; nothing written. Not an error —
--                      a second click or a retry must not read as failure.
--   'limit_reached'    the tenant is at their cap; nothing written.
--   'not_found'        no DRAFT plan with that id in that tenant (wrong
--                      tenant, deleted, or already closed).
--   'sample_workspace' the plan lives in the tenant's free sample workspace,
--                      which the limit never counts. Reachable with ordinary
--                      clicks — close the sample as Won, start a new plan in
--                      it, press "make it live" — so it is a verdict, not an
--                      assertion.
--
-- `p_max_active_deals` null means unlimited (Advanced, Enterprise, and every
-- manual entitlement).
--
-- `security invoker`, and it carries no privilege of its own: it is the
-- service role's own rights — plus its membership of is_server_write_role()
-- — that let it write. A caller who is not the server gains nothing by
-- finding this function; the go-live trigger would still refuse them.
--
-- Dropped BY NAME across every overload: PostgREST refuses to call a
-- function that has two overloads (PGRST203), so an earlier draft with a
-- different argument list left behind would break go-live in a way that
-- looks nothing like its cause.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'mark_plan_live'
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end
$$;

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
  v_is_sample boolean;
  v_active_count integer;
begin
  -- Serialises every go-live for ONE tenant against every other.
  --
  -- FOR NO KEY UPDATE, not FOR UPDATE: every insert of a row that references
  -- tenants (a workspace, a subscription) takes a KEY SHARE lock on the
  -- parent, and FOR UPDATE conflicts with it — one seller going live would
  -- block another creating a workspace, and vice versa. FOR NO KEY UPDATE
  -- still conflicts with itself, which is the only thing this needs.
  perform 1 from tenants where id = p_tenant_id for no key update;
  if not found then
    return 'not_found';
  end if;

  -- The plan must be in the calling tenant. This is also the tenant check: a
  -- plan id from another tenant resolves to no row and is reported as
  -- 'not_found', never a refusal that would confirm it exists.
  select sp.status, w.is_sample
    into v_status, v_is_sample
    from success_plans sp
    join workspaces w on w.id = sp.workspace_id
   where sp.id = p_plan_id
     and w.tenant_id = p_tenant_id;

  if v_status is null then
    return 'not_found';
  end if;

  -- Checked before anything else about the plan: the sample workspace is
  -- excluded from the count, so it must also be excluded from going live.
  -- Otherwise closing the sample and starting a new plan inside it would be
  -- a permanent free deal.
  if v_is_sample then
    return 'sample_workspace';
  end if;

  if v_status = 'active' then
    return 'already_live';
  end if;

  -- A closed (won/lost) plan is not re-openable through this path.
  if v_status <> 'draft' then
    return 'not_found';
  end if;

  if p_max_active_deals is not null then
    -- A SEPARATE statement, deliberately, and AFTER the lock above. Under
    -- READ COMMITTED each statement takes a fresh snapshot, so this count
    -- sees whatever the transaction we just waited for committed. Folding it
    -- into a CTE with the update below would evaluate both halves against
    -- the SAME snapshot — the older one — and two racing calls could each
    -- count the other out of existence.
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

-- 5. The go-live guard -----------------------------------------------------
--
-- Refuses any transition INTO status 'active' by anyone who is not the
-- server. The app's own go-live path runs mark_plan_live() on the
-- service-role client and is unaffected; a direct PostgREST PATCH with the
-- anon key is not.
--
-- Deliberately NOT a check on how many deals are live — that number is
-- product config and belongs in the function above. This trigger answers one
-- question only: "did this come from the server?".
drop trigger if exists trg_success_plans_go_live_guard on success_plans;
drop function if exists enforce_plan_go_live();

create function enforce_plan_go_live()
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

  -- An UPDATE that leaves an already-active plan active IN THE SAME
  -- WORKSPACE is not a go-live — it is a title or date edit. The
  -- workspace_id arm is not decoration: without it a seller could MOVE the
  -- sample workspace's active plan into a real workspace and land one deal
  -- over their cap without ever transitioning a status. OLD is only read on
  -- the UPDATE branch; referencing it on INSERT would raise.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.workspace_id = old.workspace_id then
    return new;
  end if;

  if not is_server_write_role() then
    -- Message and SQLSTATE are application contract — lib/plans/errors.ts
    -- maps this pair to the GO_LIVE_NOT_PERMITTED code
    -- (GO_LIVE_NOT_PERMITTED_MESSAGE in lib/plans/constraints.ts).
    raise exception 'GO_LIVE_NOT_PERMITTED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_success_plans_go_live_guard
  before insert or update on success_plans
  for each row
  execute function enforce_plan_go_live();

-- 6. The sample-flag guard -------------------------------------------------
--
-- is_sample is the column that says "do not count this deal", and 0001's
-- workspace policy is `for all` — so without this, one PATCH from the
-- browser marks every real deal as a sample and the limit counts nothing at
-- all. Only the server may set it.
--
-- Only false -> true is guarded. Un-flagging needs no protection: it can
-- only ever make a workspace COUNT, which is against the interest of anyone
-- who would bother.
drop trigger if exists trg_workspaces_sample_flag_guard on workspaces;
drop function if exists enforce_sample_workspace_flag();

create function enforce_sample_workspace_flag()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_sample and not is_server_write_role() then
      raise exception 'SAMPLE_FLAG_NOT_PERMITTED' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.is_sample and not old.is_sample and not is_server_write_role() then
    raise exception 'SAMPLE_FLAG_NOT_PERMITTED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_workspaces_sample_flag_guard
  before insert or update on workspaces
  for each row
  execute function enforce_sample_workspace_flag();

commit;

-- Down / rollback (manual — uncomment and run only to reverse this migration):
--   begin;
--     drop trigger if exists trg_workspaces_sample_flag_guard on workspaces;
--     drop function if exists enforce_sample_workspace_flag();
--     drop trigger if exists trg_success_plans_go_live_guard on success_plans;
--     drop function if exists enforce_plan_go_live();
--     drop function if exists mark_plan_live(uuid, uuid, integer);
--     drop function if exists is_server_write_role();
--     drop index if exists idx_workspaces_one_sample_per_tenant;
--     drop index if exists idx_success_plans_active;
--     drop index if exists idx_workspaces_tenant;
--     alter table workspaces drop column if exists is_sample;
--   commit;
