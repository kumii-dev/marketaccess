-- ================================================================
-- ETENDER DAILY CACHE TABLE
-- ================================================================
-- Purpose: Graceful degradation — store one daily snapshot of
--          live eTender results so the app can serve fresh-ish data
--          when the eTenders gov API is unavailable.
--
-- Design decisions:
--   • No user_id — tenders are public data, shared across all users
--   • snapshot_date is the PRIMARY KEY → one row per calendar day
--   • Rolling 2-day window — app prunes rows older than 2 days on
--     every successful save (authenticated clients only)
--   • Storage budget: ~50 tenders/day × 3 KB × 2 days ≈ 300 KB
-- ================================================================

CREATE TABLE IF NOT EXISTS etender_daily_cache (
  snapshot_date  DATE         PRIMARY KEY,
  tenders        JSONB        NOT NULL,
  tender_count   INTEGER      NOT NULL DEFAULT 0,
  fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup of the most recent entry
CREATE INDEX IF NOT EXISTS idx_etender_daily_cache_date
  ON etender_daily_cache (snapshot_date DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE etender_daily_cache ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authenticated) can READ — tenders are public data
CREATE POLICY "etender_cache_select"
  ON etender_daily_cache FOR SELECT
  USING (true);

-- Authenticated users can INSERT a new day's snapshot
CREATE POLICY "etender_cache_insert"
  ON etender_daily_cache FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Authenticated users can UPDATE (upsert same day with fresher data)
CREATE POLICY "etender_cache_update"
  ON etender_daily_cache FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Authenticated users can DELETE (prune entries older than 2 days)
CREATE POLICY "etender_cache_delete"
  ON etender_daily_cache FOR DELETE
  USING (auth.role() = 'authenticated');

-- ── Documentation ─────────────────────────────────────────────────────────────
COMMENT ON TABLE etender_daily_cache IS
  'Shared daily eTender snapshots for graceful degradation. '
  'Rolling 2-day window enforced by application on every save. '
  'Created: 2026-05-06 | Migration: 002_etender_daily_cache.sql';

COMMENT ON COLUMN etender_daily_cache.snapshot_date  IS 'Calendar date of the snapshot (YYYY-MM-DD). One row per day.';
COMMENT ON COLUMN etender_daily_cache.tenders        IS 'JSONB array of OCDS release objects fetched from eTenders API.';
COMMENT ON COLUMN etender_daily_cache.tender_count   IS 'Denormalised count of releases for quick stats without parsing JSONB.';
COMMENT ON COLUMN etender_daily_cache.fetched_at     IS 'Timestamp of when the live API call succeeded.';
