-- ============================================================================
-- jobs: add the ONE index the application's queries were actually missing
-- ============================================================================
--
-- SYMPTOM (Sep 2026)
--   Supabase flagged the project "about to deplete its Disk IO Budget", and it
--   then went fully unresponsive: HTTP 544 / 000 on every PostgREST request,
--   the dashboard SQL Editor itself failed with "Connection terminated due to
--   connection timeout", and the frontend showed "Failed to list resume: The
--   connection to the database timed out".
--   Resolved by a project restart — Supabase's published remedy for their
--   "Unresponsive Projects" incident profile.
--
-- ⚠️ CORRECTION (2026-09-23) — read this before believing the numbers below.
--   An earlier version of this file claimed `jobs` had no index on `user_id`,
--   `pipeline_run_id`, `created_at` or `status`. THAT WAS WRONG. It came from
--   `backend-scraping-api/supabase/schema.sql`, which is STALE and lists only
--   5 indexes. The LIVE table actually had ~31, including:
--
--     idx_jobs_user_id              (user_id)
--     idx_jobs_user_created         (user_id, created_at DESC)
--     idx_jobs_user_fit_interested  (user_id, fit, interested_in)
--     idx_jobs_user_fit_score_null  (user_id, fit_score) WHERE fit_score IS NULL
--     idx_jobs_user_id_date         (user_id, scraped_date DESC)
--     idx_jobs_run_created_at       (pipeline_run_id, created_at DESC)
--     idx_jobs_pipeline_run_id      (pipeline_run_id)
--     idx_jobs_fit_status           (fit, status)
--     …and more
--
--   The earlier version therefore ALSO created exact duplicates of indexes that
--   already existed (idx_jobs_user_created_at, idx_jobs_pipeline_run_created_at)
--   plus two subsumed ones. On a write-heavy table — the scraper INSERTs
--   thousands of rows and the evaluator UPDATEs every job — extra indexes are
--   not free: they are write amplification, which is itself disk IO. Those
--   duplicates have been dropped again.
--
-- THE ONE REAL GAP
--   The keyword-scoped read path filters on (user_id, search_key). No existing
--   index leads with that pair, and `idx_jobs_user_id` alone still has to fetch
--   every row for the user. That is the only index worth adding here.
--
-- NOTE ON COST
--   CREATE INDEX (not CONCURRENTLY) is used deliberately: this runs through the
--   dashboard / CLI in a single transaction, and CONCURRENTLY cannot run inside
--   one. If you need it non-blocking on a busy table, run the statement on its
--   own with CONCURRENTLY outside a transaction block.
--
-- RUN
--   Supabase dashboard -> SQL Editor, or
--   cd next-react && npx supabase db query --linked --file scripts/add-jobs-indexes.sql
-- ============================================================================

-- ── The one genuine gap ─────────────────────────────────────────────────────

-- evaluate keyword branch: WHERE user_id = ? AND search_key = ?
create index if not exists idx_jobs_user_search_key
  on jobs (user_id, search_key);

-- ── Remove the redundant duplicates if an earlier run added them ────────────
-- These add write cost without being chosen ahead of the wider index below.
drop index if exists idx_jobs_user_created_at;          -- dup of idx_jobs_user_created
drop index if exists idx_jobs_pipeline_run_created_at;  -- dup of idx_jobs_run_created_at
drop index if exists idx_jobs_user_fit;                 -- subsumed by idx_jobs_user_fit_interested
drop index if exists idx_jobs_user_status_fit_score;    -- subsumed by idx_jobs_user_fit_score_null

-- A bare single-column boolean index is never chosen once a selective user_id
-- predicate exists, and idx_jobs_fit_status covers the same predicate.
drop index if exists idx_jobs_fit;

-- ── Planner statistics ──────────────────────────────────────────────────────
-- Refresh after the index changes so the planner has current cardinality
-- estimates. (No claim is made that stale stats caused the outage — that part
-- of the earlier analysis was also built on the stale schema.sql.)
analyze jobs;

-- ── Verify ──────────────────────────────────────────────────────────────────
select indexname, indexdef
  from pg_indexes
 where tablename = 'jobs'
 order by indexname;
