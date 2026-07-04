-- ================================================================
-- ACTIVE TENDERS TABLE  (background-synced source of truth)
-- ================================================================
-- Purpose: Store EVERY currently-open tender from the National
--          Treasury eTenders OCDS API so the app can serve fast,
--          pre-filtered reads from Supabase instead of hitting the
--          slow / unreliable gov API on every user page load.
--
-- How it's populated:
--   • A background cron in server/index.js runs HOURLY (server-side)
--   • It fetches open tenders, UPSERTs them here (keyed by ocid)
--   • In the same run it DELETEs rows whose closing_date has passed
--     (data-lifecycle management — expired tenders are removed hourly)
--
-- Why service-role-only writes:
--   Fetching from the gov API is DECOUPLED from user control. Only the
--   server's background job (service_role key, which bypasses RLS) may
--   write. Anonymous + authenticated clients can only READ.
--
-- Storage budget: ~1–2k open tenders × ~3 KB/release ≈ 3–6 MB JSONB.
-- ================================================================

CREATE TABLE IF NOT EXISTS active_tenders (
  ocid            TEXT         PRIMARY KEY,             -- e.g. "ocds-9t57fa-141418"
  release_id      TEXT,                                 -- OCDS release id
  title           TEXT,
  buyer_name      TEXT,
  category        TEXT,
  province        TEXT,
  status          TEXT         NOT NULL DEFAULT 'active',
  closing_date    TIMESTAMPTZ,                          -- tender.tenderPeriod.endDate
  published_date  TIMESTAMPTZ,                          -- release.date
  release         JSONB        NOT NULL,                -- full OCDS release object
  synced_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()   -- last time this row was refreshed
);

-- Fast expiry pruning + closing-soon ordering
CREATE INDEX IF NOT EXISTS idx_active_tenders_closing
  ON active_tenders (closing_date);

-- Optional filtering / stats by status
CREATE INDEX IF NOT EXISTS idx_active_tenders_status
  ON active_tenders (status);

-- Freshness monitoring
CREATE INDEX IF NOT EXISTS idx_active_tenders_synced
  ON active_tenders (synced_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE active_tenders ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authenticated) can READ — tenders are public data.
DROP POLICY IF EXISTS "active_tenders_select" ON active_tenders;
CREATE POLICY "active_tenders_select"
  ON active_tenders FOR SELECT
  USING (true);

-- NO insert/update/delete policies are defined on purpose.
-- Writes happen exclusively via the server's service_role key (bypasses RLS),
-- so ordinary users can never trigger or mutate a sync. This enforces the
-- "fetching is a background activity decoupled from user control" requirement.

-- ── Documentation ─────────────────────────────────────────────────────────────
COMMENT ON TABLE active_tenders IS
  'All currently-open eTenders, refreshed hourly by a server-side background cron. '
  'Expired rows (closing_date < now) are pruned each run. Read-only for clients; '
  'writes only via service_role. Created: 2026-07-03 | Migration: 004_active_tenders.sql';

COMMENT ON COLUMN active_tenders.ocid           IS 'OCDS contracting identifier — primary key / upsert conflict target.';
COMMENT ON COLUMN active_tenders.closing_date   IS 'Tender period end date (tender.tenderPeriod.endDate). Used for hourly expiry pruning.';
COMMENT ON COLUMN active_tenders.release        IS 'Full OCDS release object returned by the eTenders API.';
COMMENT ON COLUMN active_tenders.synced_at      IS 'Timestamp of the most recent successful sync that touched this row.';
