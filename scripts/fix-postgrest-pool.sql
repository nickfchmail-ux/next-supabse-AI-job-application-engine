-- Repair a wedged Supabase PostgREST connection pool.
--
-- SYMPTOM
--   Every /rest/v1/<table> request hangs and returns no response at all
--   (curl reports HTTP 000 after 15-30s), while /storage/v1/* works fine and
--   SQL over the pooler works fine. Invalid API keys still 401 instantly.
--
-- CAUSE
--   PostgREST serves from a fixed-size connection pool (~10 slots). When a
--   client disconnects mid-query — a frontend AbortController firing, a proxy
--   timeout, a killed job — PostgREST can leave the transaction OPEN on that
--   pooled connection. The slot is never returned. Once most slots are
--   `idle in transaction`, every new request waits forever for a connection.
--
-- DIAGNOSE
--   select state, count(*) from pg_stat_activity
--   where application_name ilike '%postgrest%' group by state;
--
--   Healthy looks like a handful of `idle` connections.
--   Wedged looks like most of the pool `idle in transaction`.
--
-- FIX (two parts)
--   1. Permanent prevention — make Postgres reclaim connections that are left
--      idle inside a transaction, so the pool can never wedge again.
--   2. Immediate repair — recycle the slots that are stuck right now.
--
-- Run with:
--   cd next-react && npx supabase db query --linked --file scripts/fix-postgrest-pool.sql

-- ── 1. Permanent prevention ────────────────────────────────────────────────
-- Only affects connections established AFTER this runs; existing ones keep
-- their old behaviour until they reconnect (which step 2 forces).
alter role authenticator set idle_in_transaction_session_timeout = '15s';
alter role anon          set idle_in_transaction_session_timeout = '15s';
alter role authenticated set idle_in_transaction_session_timeout = '15s';
alter role service_role  set idle_in_transaction_session_timeout = '15s';

-- ── 2. Immediate repair ────────────────────────────────────────────────────
-- Terminate only PostgREST backends sitting idle inside a transaction. These
-- transactions belong to clients that have already given up, so nothing is
-- abandoned mid-work. PostgREST reconnects automatically.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select pid from pg_stat_activity
    where application_name ilike '%postgrest%'
      and state like 'idle in transaction%'
  loop
    perform pg_terminate_backend(r.pid);
    n := n + 1;
  end loop;
  raise notice 'terminated % postgrest backends', n;
end $$;

-- ── 3. Report ──────────────────────────────────────────────────────────────
-- NOTE: this runs in the same transaction as the block above, so the numbers
-- still reflect the pre-repair snapshot. Re-run the DIAGNOSE query on its own
-- to confirm the pool is clean.
select jsonb_pretty(jsonb_build_object(
  'postgrest_total',      (select count(*) from pg_stat_activity
                           where application_name ilike '%postgrest%'),
  'idle_in_transaction',  (select count(*) from pg_stat_activity
                           where application_name ilike '%postgrest%'
                             and state like 'idle in transaction%')
)) as pool_before_repair;
