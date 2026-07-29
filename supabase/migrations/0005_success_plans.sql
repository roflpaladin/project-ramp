-- Sprint 5, Ticket 22: Mutual Success Plan Engine — schema
-- PRD ref: 1.4 PRD §3.1 (Data Model Deltas)
--
-- Depends on: 0001_init_schema.sql, 0003_workspace_analytics.sql,
--             0004_crm_integration_nodes.sql.
--
-- !! RLS IS NOT THE BUYER BOUNDARY !!
-- Every policy in this file scopes the AUTHENTICATED SELLER (AE) path only.
-- Buyers hold no Supabase Auth session: /portal and /view read through the
-- service-role client (lib/supabase/admin.ts), which BYPASSES RLS entirely.
-- Adding an RLS policy here does nothing to stop a buyer leak. The only thing
-- standing between links.visibility='private' and the buyer's viewport is the
-- explicit filter + field strip in the RSC data loader (Ticket 25).

begin;

-- 1. The plan object -------------------------------------------------------

create table if not exists success_plans (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title        text not null,
  start_date   date,
  target_date  date,
  status       text not null default 'draft'
               check (status in ('draft', 'active', 'won', 'lost')),
  created_at   timestamptz not null default now(),
  -- The runway banner (PRD §2.1) computes "day X of N" from these two dates.
  -- A backwards range renders a negative runway in front of a buyer.
  constraint success_plans_date_order
    check (start_date is null or target_date is null or target_date >= start_date)
);

-- The buyer workspace renders exactly ONE plan; "which plan?" must never be
-- ambiguous at render time. Partial (not a table constraint) so a closed
-- won/lost plan can be archived alongside a new active one.
create unique index if not exists idx_success_plans_one_live_per_workspace
  on success_plans (workspace_id)
  where status in ('draft', 'active');

create index if not exists idx_success_plans_workspace
  on success_plans (workspace_id);

create table if not exists plan_stages (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references success_plans (id) on delete cascade,
  title         text not null,
  display_order integer not null default 0,
  status        text not null default 'upcoming'
                check (status in ('upcoming', 'current', 'done'))
);

-- Deliberately NOT unique on (plan_id, display_order): the builder reorders by
-- rewriting the whole set, and a unique constraint would fail mid-swap unless
-- deferred. Ordering ties break on id, which is stable.
create index if not exists idx_plan_stages_plan_order
  on plan_stages (plan_id, display_order);

create table if not exists plan_steps (
  id            uuid primary key default gen_random_uuid(),
  stage_id      uuid not null references plan_stages (id) on delete cascade,
  label         text not null,
  -- THE core differentiator (PRD §2.5). Two-sided ownership. The completion
  -- endpoint rejects a buyer completing a row where owner_side = 'seller'.
  owner_side    text not null check (owner_side in ('seller', 'buyer')),
  owner_name    text,
  owner_email   text,
  due_date      date,
  status        text not null default 'open'
                check (status in ('open', 'done', 'blocked')),
  display_order integer not null default 0,
  -- Not in the PRD; added for the two-sided proof in §4. Without these the
  -- seller pulse can show THAT a step flipped but not who flipped it or when,
  -- which is exactly the evidence the Proximus walkthrough turns on.
  completed_at       timestamptz,
  completed_by_email text,
  -- Seller-private per-step commentary. MUST be stripped from buyer payloads
  -- (PRD §3.3). Named with the private_ prefix so the Ticket 26 strip test can
  -- assert on the prefix, not a hand-kept list.
  private_note  text,
  constraint plan_steps_completion_coherent
    check ((status = 'done') = (completed_at is not null))
);

create index if not exists idx_plan_steps_stage_order
  on plan_steps (stage_id, display_order);

-- Powers the rail's "what's holding up the decision" and the stall alert.
create index if not exists idx_plan_steps_open_due
  on plan_steps (due_date)
  where status <> 'done';

-- 2. Resource visibility (PRD §2.2 / §3.3) ---------------------------------

-- DEFAULT 'shared' is correct for backfill and ONLY for backfill: every link
-- that exists today is already visible to buyers, so 'shared' preserves truth
-- rather than fabricating it. The seller builder (Ticket 30) MUST write
-- visibility explicitly on insert and never rely on this default.
alter table links
  add column if not exists visibility text not null default 'shared',
  add column if not exists resource_type text;

do $$
begin
  alter table links add constraint links_visibility_check
    check (visibility in ('shared', 'private'));
exception
  when duplicate_object then null;
end
$$;

-- The hot buyer read path is (workspace_id, visibility='shared'). Partial index
-- keeps the buyer query off the private rows at the index level.
create index if not exists idx_links_workspace_shared
  on links (workspace_id, display_order)
  where visibility = 'shared';

-- 3. Workspace additions — chat link-out + cached CRM reflection ------------

alter table workspaces
  -- PRD §2.4. chat_url is buyer-visible; internal_chat_url is the seller war
  -- room and is named in the §3.3 strip list. Do not collapse into one column.
  add column if not exists chat_url text,
  add column if not exists internal_chat_url text,
  -- PRD §5.1 read-through cache. crm_source / crm_object_id exist (0004).
  add column if not exists crm_stage varchar(100),
  add column if not exists crm_amount numeric(14, 2),
  add column if not exists crm_close_date date,
  add column if not exists crm_forecast_category varchar(50),
  -- A cache without a staleness marker is a lie. The seller strip renders this
  -- as "as of <time>" so a stale read is visible, not silently wrong.
  add column if not exists crm_synced_at timestamptz;

-- 4. Analytics: admit the new event type -----------------------------------
-- 0003 pinned action_type to ('portal_view','link_click'). Step completion is a
-- third event and will violate that CHECK. Postgres cannot extend a CHECK in
-- place — it must be dropped and recreated. Missing this is how Ticket 35 fails
-- at runtime with a constraint violation instead of at migration time.

alter table workspace_analytics
  drop constraint if exists workspace_analytics_action_type_check;

alter table workspace_analytics
  add constraint workspace_analytics_action_type_check
  check (action_type in ('portal_view', 'link_click', 'step_complete'));

alter table workspace_analytics
  add column if not exists step_id uuid references plan_steps (id) on delete set null;

create index if not exists idx_analytics_step
  on workspace_analytics (step_id)
  where step_id is not null;

-- 5. RLS — SELLER (AE) PATH ONLY. Re-read the warning at the top. -----------
-- Claim model per 0001 and the Technical Source of Truth correction:
-- (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid  — NEVER auth.uid().

alter table success_plans enable row level security;
alter table plan_stages  enable row level security;
alter table plan_steps   enable row level security;

drop policy if exists "AE manages own tenant plans" on success_plans;
create policy "AE manages own tenant plans"
  on success_plans for all
  using (
    exists (
      select 1 from workspaces w
      where w.id = success_plans.workspace_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  )
  with check (
    exists (
      select 1 from workspaces w
      where w.id = success_plans.workspace_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );

drop policy if exists "AE manages own tenant stages" on plan_stages;
create policy "AE manages own tenant stages"
  on plan_stages for all
  using (
    exists (
      select 1 from success_plans p
      join workspaces w on w.id = p.workspace_id
      where p.id = plan_stages.plan_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  )
  with check (
    exists (
      select 1 from success_plans p
      join workspaces w on w.id = p.workspace_id
      where p.id = plan_stages.plan_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );

-- Two-hop join per row. Accepted for Phase 5a: a pilot plan is tens of rows,
-- and idx_plan_stages_plan_order + the PK lookups keep it index-only. Revisit
-- (denormalize workspace_id onto plan_steps) only if a single plan exceeds
-- ~500 steps or EXPLAIN shows this policy dominating the builder query.
drop policy if exists "AE manages own tenant steps" on plan_steps;
create policy "AE manages own tenant steps"
  on plan_steps for all
  using (
    exists (
      select 1 from plan_stages s
      join success_plans p on p.id = s.plan_id
      join workspaces w on w.id = p.workspace_id
      where s.id = plan_steps.stage_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  )
  with check (
    exists (
      select 1 from plan_stages s
      join success_plans p on p.id = s.plan_id
      join workspaces w on w.id = p.workspace_id
      where s.id = plan_steps.stage_id
        and w.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    )
  );

-- No anon / authenticated policy is granted to buyers on any table above.
-- Buyer step completion (Ticket 35) writes through the service-role client
-- AFTER the route handler has verified the portal session cookie AND asserted
-- owner_side = 'buyer'. Default-deny for everyone else stands.

commit;

-- Down / rollback (manual — uncomment and run only to reverse this migration):
--   drop table if exists plan_steps cascade;
--   drop table if exists plan_stages cascade;
--   drop table if exists success_plans cascade;
--   alter table workspace_analytics drop column if exists step_id;
--   alter table workspace_analytics drop constraint if exists workspace_analytics_action_type_check;
--   alter table workspace_analytics add constraint workspace_analytics_action_type_check
--     check (action_type in ('portal_view','link_click'));
--   drop index if exists idx_links_workspace_shared;
--   alter table links drop constraint if exists links_visibility_check;
--   alter table links drop column if exists visibility, drop column if exists resource_type;
--   alter table workspaces
--     drop column if exists chat_url, drop column if exists internal_chat_url,
--     drop column if exists crm_stage, drop column if exists crm_amount,
--     drop column if exists crm_close_date, drop column if exists crm_forecast_category,
--     drop column if exists crm_synced_at;
