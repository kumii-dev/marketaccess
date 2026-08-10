-- Migration 005: tender_sync_cursor
-- =====================================================================
-- Persists resumable pagination state for the eTenders background sync.
--
-- WHY THIS EXISTS
-- ----------------
-- The app is deployed on Vercel (serverless). Vercel functions are
-- time-boxed (10s on Hobby, up to 300s on Pro) and torn down between
-- invocations — there is no persistent process for an in-memory
-- node-cron job to live in. A full sync of the eTenders OCDS API can
-- take several minutes across up to 50 paginated requests (each page
-- can take up to 2 minutes on the slow gov IIS server).
--
-- Instead, Vercel Cron Jobs hit /api/active-tenders/sync on a schedule
-- (e.g. every 5 minutes). Each invocation fetches only a bounded number
-- of pages (maxPagesThisRun) and stores its position here so the next
-- invocation resumes rather than restarting from page 1 — allowing the
-- store to converge toward full coverage (~1,944 open tenders) over
-- several scheduled runs instead of requiring one giant request.

CREATE TABLE IF NOT EXISTS tender_sync_cursor (
  id             int PRIMARY KEY DEFAULT 1,      -- singleton row
  date_from      text,                            -- lookback window start (YYYY-MM-DD)
  date_to        text,                            -- lookback window end   (YYYY-MM-DD)
  next_page      int NOT NULL DEFAULT 1,          -- next OCDS page to fetch
  pages_done     int NOT NULL DEFAULT 0,          -- pages completed in the current sweep
  is_complete    boolean NOT NULL DEFAULT false,  -- true once an empty page is hit (full sweep done)
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_sync_cursor_singleton CHECK (id = 1)
);

-- Seed the singleton row if it doesn't exist yet.
INSERT INTO tender_sync_cursor (id, next_page, pages_done, is_complete)
VALUES (1, 1, 0, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE tender_sync_cursor ENABLE ROW LEVEL SECURITY;

-- No public read/write policy — this table is operational metadata,
-- accessed only via the service_role key from the sync endpoint.
DROP POLICY IF EXISTS "tender_sync_cursor_no_access" ON tender_sync_cursor;
CREATE POLICY "tender_sync_cursor_no_access"
  ON tender_sync_cursor FOR ALL
  USING (false);

COMMENT ON TABLE tender_sync_cursor IS
  'Singleton row tracking resumable pagination state for the chunked eTenders '
  'sync, required because Vercel serverless functions cannot host a persistent '
  'node-cron process or complete a multi-minute sync in one invocation. '
  'Migration: 005_tender_sync_cursor.sql';
