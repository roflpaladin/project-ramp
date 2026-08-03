-- Sprint 6, Ticket 28 (T28-1): Plan reorder RPCs + demo-tenant hijack guard
-- Plan ref: plans/sprint-6-7-replan.md §6, Ticket 28, T28-1. Founder decision 3.
--
-- Depends on: 0001_init_schema.sql (workspaces), 0005_success_plans.sql
--             (success_plans, plan_stages, plan_steps + their RLS policies).
--
-- !! SECURITY INVOKER IS LOAD-BEARING, NOT A DEFAULT !!
-- Both RPCs below are SECURITY INVOKER, not SECURITY DEFINER, by explicit
-- founder decision (Decision 3): DEFINER would create a cross-tenant reorder
-- primitive, because a definer-owned function runs with the FUNCTION OWNER's
-- privileges and bypasses the caller's RLS entirely. INVOKER means the
-- internal `select` that computes each parent's real id set, and the `update`
-- that rewrites display_order, both run as the CALLING role and are therefore
-- still filtered by 0005's "AE manages own tenant stages/steps" policies. A
-- foreign tenant's AE calling either function sees an empty real-id set (RLS
-- hides the rows, it does not error), so ANY non-empty p_*_ids array they
-- submit fails the exact-set check below and raises REORDER_SET_MISMATCH —
-- the same function that reorders a plan is, by construction, unable to leak
-- or mutate a different tenant's rows. `set search_path = public` on both
-- pins symbol resolution so a caller's search_path cannot redirect these
-- functions to a shadow table.
--
-- No explicit GRANT/REVOKE is added here (contrast 0006's SECURITY DEFINER
-- test helpers, which must revoke PUBLIC execute because they perform DDL as
-- their owner). Postgres grants EXECUTE on new functions to PUBLIC by
-- default; for a SECURITY INVOKER function that default is safe on its own,
-- because RLS on plan_stages/plan_steps is the real gate, not function-level
-- ACLs. supabase-js calls these as `rpc()` under the anon/authenticated role,
-- which needs EXECUTE — restricting it would break the intended caller.
--
-- Per T28-1: deliberately NOT adding a unique constraint/index on
-- (plan_id, display_order) or (stage_id, display_order). 0005 already left
-- idx_plan_stages_plan_order / idx_plan_steps_stage_order non-unique on
-- purpose (see 0005's comment above idx_plan_stages_plan_order): a permuting
-- rewrite of a whole ordered set necessarily passes through duplicate
-- display_order values mid-statement unless the constraint is DEFERRABLE, and
-- nothing in this project's read path requires the uniqueness guarantee.

begin;

-- 1. reorder_plan_stages -----------------------------------------------------

create or replace function reorder_plan_stages(
  p_plan_id uuid,
  p_stage_ids uuid[]
)
returns setof plan_stages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_real_ids       uuid[];
  v_input_sorted   uuid[];
  v_real_sorted    uuid[];
  v_input_count    integer;
  v_input_distinct integer;
begin
  if p_stage_ids is null then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- The REAL set, computed server-side from the row RLS actually lets this
  -- caller see. Never derived from a client-claimed count or total.
  select coalesce(array_agg(id), array[]::uuid[])
    into v_real_ids
    from plan_stages
    where plan_id = p_plan_id;

  -- Reject duplicates within the submitted array before any set comparison —
  -- a duplicate would otherwise silently collapse via array_position later.
  select count(*), count(distinct id)
    into v_input_count, v_input_distinct
    from unnest(p_stage_ids) as id;

  if v_input_count <> v_input_distinct then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- Exact-set check, both directions: same cardinality, same elements, no
  -- extras, none missing. Sorting both sides makes uuid[] equality exact.
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_input_sorted
    from unnest(p_stage_ids) as id;

  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_real_sorted
    from unnest(v_real_ids) as id;

  if v_input_sorted <> v_real_sorted then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- Match confirmed: rewrite display_order from the submitted order, then
  -- return the authoritative rows re-read in their new order.
  return query
    with updated as (
      update plan_stages
      set display_order = array_position(p_stage_ids, id)
      where plan_id = p_plan_id
      returning *
    )
    select * from updated order by display_order;
end;
$$;

-- 2. reorder_plan_steps -------------------------------------------------------

create or replace function reorder_plan_steps(
  p_stage_id uuid,
  p_step_ids uuid[]
)
returns setof plan_steps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_real_ids       uuid[];
  v_input_sorted   uuid[];
  v_real_sorted    uuid[];
  v_input_count    integer;
  v_input_distinct integer;
begin
  if p_step_ids is null then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- The REAL set, computed server-side from the row RLS actually lets this
  -- caller see. Never derived from a client-claimed count or total.
  select coalesce(array_agg(id), array[]::uuid[])
    into v_real_ids
    from plan_steps
    where stage_id = p_stage_id;

  -- Reject duplicates within the submitted array before any set comparison.
  select count(*), count(distinct id)
    into v_input_count, v_input_distinct
    from unnest(p_step_ids) as id;

  if v_input_count <> v_input_distinct then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- Exact-set check, both directions: same cardinality, same elements, no
  -- extras, none missing.
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_input_sorted
    from unnest(p_step_ids) as id;

  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_real_sorted
    from unnest(v_real_ids) as id;

  if v_input_sorted <> v_real_sorted then
    raise exception 'REORDER_SET_MISMATCH' using errcode = 'P0001';
  end if;

  -- Match confirmed: rewrite display_order from the submitted order, then
  -- return the authoritative rows re-read in their new order.
  return query
    with updated as (
      update plan_steps
      set display_order = array_position(p_step_ids, id)
      where stage_id = p_stage_id
      returning *
    )
    select * from updated order by display_order;
end;
$$;

-- 3. Demo-tenant hijack guard on workspaces -----------------------------------
-- T28-1: rejects any UPDATE that transitions workspaces.tenant_id INTO the
-- demo tenant from a DIFFERENT tenant. This is the primary control that
-- closes the update path against a hijack of the demo tenant (see
-- plans/sprint-6-7-replan.md §7, T37a-2, for the companion insert-path guard
-- in scripts/provision-rep.mjs — a general insert-time DB constraint is not
-- buildable there because the seed, sandbox provisioner and a mis-provisioned
-- insert all arrive as service_role, so the database cannot distinguish
-- them). A same-tenant no-op UPDATE (OLD.tenant_id = NEW.tenant_id) and any
-- transition AWAY from the demo tenant are both left untouched.

create or replace function reject_demo_tenant_hijack()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- 'de300000-0000-4000-8000-000000000001' is DEMO_TENANT_ID, lib/demo.ts:12.
  -- Hardcoded rather than looked up: this trigger must reject the hijack even
  -- if the tenants table row backing the demo tenant is ever renamed or its
  -- label changes — the sentinel id is the actual contract, not the label.
  if new.tenant_id = 'de300000-0000-4000-8000-000000000001'
     and old.tenant_id is distinct from new.tenant_id then
    raise exception
      'Cannot move a workspace into the demo tenant from a different tenant';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workspaces_reject_demo_tenant_hijack on workspaces;

create trigger trg_workspaces_reject_demo_tenant_hijack
  before update on workspaces
  for each row
  execute function reject_demo_tenant_hijack();

commit;

-- Down / rollback (manual — uncomment and run only to reverse this migration):
--   begin;
--     drop trigger if exists trg_workspaces_reject_demo_tenant_hijack on workspaces;
--     drop function if exists reject_demo_tenant_hijack();
--     drop function if exists reorder_plan_steps(uuid, uuid[]);
--     drop function if exists reorder_plan_stages(uuid, uuid[]);
--   commit;
