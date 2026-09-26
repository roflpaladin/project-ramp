-- Sprint 12, Ticket 62: Self-Serve Hardening Pass (R7) — shared-store rate
-- limiting.
--
-- lib/rate-limit.ts has counted requests in a module-level Map since Sprint 8
-- (Ticket 39), and said so in its own header: "distributed limiting is Ticket
-- 62 (R7)". On a serverless host every warm instance holds its own Map, so the
-- real limit is (instances x limit) — and an attacker raises "instances" just
-- by sending requests in parallel. From Nov 1 strangers reach the signup,
-- sign-in-link, password-reset and buyer access-code endpoints, all of which
-- send email or guard a short numeric code, so the count has to live
-- somewhere every instance shares. This is that place.
--
-- Shape: ONE row per limiter key, holding the current fixed window's start and
-- its request count. `check_rate_limit` decides a request with a single
-- `insert ... on conflict do update`, which takes the row lock — so two
-- instances racing on the same key are serialised by Postgres and can never
-- both take "the last slot". Same fixed-window semantics as the in-memory
-- limiter, so lib/rate-limit-durable.ts is a drop-in (`await` added, nothing
-- else changes at a call site).
--
-- `key_hash`, not `key`: limiter keys contain IP addresses and email
-- addresses ("password-reset:email:<address>"). The application SHA-256
-- hashes the key before calling; this table never sees, and has no need for,
-- either one.
--
-- Independent of 0015 (Ticket 60, plan limits — on a separate branch at the
-- time of writing): neither file references an object the other creates, so
-- they may be applied in either order.
--
-- Purely additive (one new table, one new index, one new function), so per
-- docs/environments.md it is applied to prod BEFORE the code that uses it is
-- merged. Order slipping is not an outage: lib/rate-limit-durable.ts falls
-- back to the in-memory limiter whenever this function cannot answer.

begin;

-- UNLOGGED: every row is a disposable counter. Losing the table on a crash
-- resets every caller to a fresh budget for one window — a few seconds of
-- looser limiting, not a security hole — and it never needs to survive into
-- a replica or a backup. Skipping WAL on a table written on every
-- rate-limited request (exactly the burst traffic this exists to absorb) is
-- real I/O saved for no durability that matters.
create unlogged table if not exists rate_limit_windows (
  key_hash text primary key,
  window_start timestamptz not null,
  -- Capped at (limit + 1) by check_rate_limit: enough to tell "refused" from
  -- "allowed", without a hammering client growing the number without bound.
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default now()
);

-- For the opportunistic prune inside check_rate_limit (range delete on
-- window_start); the primary key already serves every per-key lookup.
create index if not exists idx_rate_limit_windows_window_start
  on rate_limit_windows (window_start);

-- RLS enabled with zero policies, i.e. default-deny for anon and
-- authenticated. This table is only ever touched by the service-role client
-- (lib/supabase/admin.ts) through check_rate_limit; no seller or buyer session
-- has any business reading or resetting a rate-limit counter.
alter table rate_limit_windows enable row level security;

-- `security invoker` (NOT definer), same reasoning as 0014's
-- apply_tenant_subscription_event: the function carries no privilege of its
-- own. Only the service role may execute it, and it is the service role's own
-- rights that let it write — a caller who is not service-role gains nothing by
-- finding it.
--
-- Dropped first rather than `create or replace`d so a re-paste over an earlier
-- draft with a different return type still converges (Postgres refuses to
-- replace a function whose return type changed). A no-op on a fresh database.
drop function if exists check_rate_limit(text, integer, integer);

create function check_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- clock_timestamp(), not now(): now() is frozen at transaction start, and a
  -- caller that waited on the row lock must be judged against the real time
  -- it got through, not the time it started queueing.
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_row rate_limit_windows%rowtype;
  -- Expired rows are swept by roughly one call in a hundred, so the table
  -- stays proportional to recently-active keys without a cron job. Two days
  -- comfortably exceeds the longest window any budget uses (24 hours).
  c_prune_probability constant double precision := 0.01;
  c_prune_older_than constant interval := interval '2 days';
begin
  if p_key_hash is null or length(p_key_hash) = 0 then
    raise exception 'check_rate_limit: p_key_hash is required';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'check_rate_limit: p_limit must be at least 1';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'check_rate_limit: p_window_seconds must be at least 1';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into rate_limit_windows as w (key_hash, window_start, request_count, updated_at)
  values (p_key_hash, v_now, 1, v_now)
  on conflict (key_hash) do update set
    window_start = case
      when w.window_start + v_window <= v_now then v_now
      else w.window_start
    end,
    request_count = case
      when w.window_start + v_window <= v_now then 1
      -- ASSUMES every caller for a given key_hash passes the same p_limit
      -- within one window (true today: each key namespace uses one fixed
      -- budget constant). A call with a SMALLER p_limit than a prior call
      -- would lower the stored count as a side effect of this cap.
      else least(w.request_count + 1, p_limit + 1)
    end,
    updated_at = v_now
  returning w.* into v_row;

  -- SKIP LOCKED: a plain range delete could take row locks in scan order
  -- while concurrent upserts take theirs in arrival order — a deadlock the
  -- detector would resolve by killing one call. The prune is opportunistic,
  -- so a row another call holds is simply left for a later pass.
  if random() < c_prune_probability then
    delete from rate_limit_windows
    where ctid in (
      select ctid from rate_limit_windows
      where window_start < v_now - c_prune_older_than
      for update skip locked
    );
  end if;

  allowed := v_row.request_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_row.window_start + v_window - v_now)))::integer)
  end;
  return next;
end;
$$;

-- Service-role only, explicitly. Two separate revokes on purpose (see 0014):
-- PUBLIC holds EXECUTE on new functions by default in Postgres, AND Supabase
-- additionally grants EXECUTE to `anon` and `authenticated` through its own
-- default privileges, which `revoke ... from public` does not touch.
revoke all on function check_rate_limit(text, integer, integer) from public;
revoke all on function check_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function check_rate_limit(text, integer, integer) to service_role;

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration;
-- safe at any time, the application falls back to its in-memory limiter):
--   begin;
--     drop function if exists check_rate_limit(text, integer, integer);
--     drop table if exists rate_limit_windows;
--   commit;
