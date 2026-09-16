-- ================================================================
-- SMART MATCHED TENDERS TABLE
-- ================================================================
-- Purpose: Per-user store of tenders the matching engine has scored
--          against that user's profile keywords. This is the backing
--          store for the "Smart Matched Tenders" subscription surfaced
--          at https://kumii.africa/access-to-market?view=my-tenders.
--
-- Why this exists (mitigates eTenders API outages):
--   Matching is computed against the already-synced `active_tenders`
--   table (populated by the existing background sync — see
--   server/services/tenderSync.js), NOT the live eTenders gov API.
--   So smart-matching keeps working even when eTenders itself is down.
--
-- How rows get here (NO CRON JOB):
--   A plain JavaScript function — refreshSmartMatchesForUser() in
--   server/routes/smartMatch.js — is invoked on-demand:
--     • whenever a user opens "My Tenders" / "Smart Matched Tenders"
--     • via POST /api/smart-match/refresh
--   It re-scores active_tenders against the user's saved AI keywords
--   (ai_keyword_cache), upserts results here, and — similar to a
--   reminder-email flow — fires an immediate email for any NEWLY
--   matched tender that clears the user's subscribed score threshold.
--   There is no scheduled/cron trigger; this is purely invoke-on-use.
--
-- Writes: service_role only (server/routes/smartMatch.js uses the
--         admin client — mirrors the pattern in routes/email.js).
-- Reads:  exposed to the owning user via GET /api/smart-match/list,
--         which validates the caller's JWT server-side before querying
--         with the admin client (avoids relying on RLS auth.uid(),
--         which historically 401s in this iframe-embedded app).
-- ================================================================

CREATE TABLE IF NOT EXISTS smart_matched_tenders (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tender_ocid      TEXT         NOT NULL,
  match_score      INTEGER      NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  matched_keywords TEXT[]       NOT NULL DEFAULT '{}',

  -- Denormalised snapshot so the UI/email can render without re-joining
  -- active_tenders (which prunes/expires rows once a tender closes).
  tender_title     TEXT,
  organ_of_state   TEXT,
  category         TEXT,
  closing_date     TIMESTAMPTZ,

  first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Notification bookkeeping — lets the invoke-on-use refresh function
  -- know which matches are "new" and still owed a one-time alert email.
  notified         BOOLEAN      NOT NULL DEFAULT false,
  notified_at      TIMESTAMPTZ,

  CONSTRAINT smart_matched_unique UNIQUE (user_id, tender_ocid)
);

CREATE INDEX IF NOT EXISTS idx_smt_user_id       ON smart_matched_tenders(user_id);
CREATE INDEX IF NOT EXISTS idx_smt_match_score   ON smart_matched_tenders(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_smt_notified      ON smart_matched_tenders(notified);
CREATE INDEX IF NOT EXISTS idx_smt_closing_date  ON smart_matched_tenders(closing_date);

-- Keep last_seen_at fresh on every re-score upsert
CREATE OR REPLACE FUNCTION update_smt_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_seen_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_smt_last_seen ON smart_matched_tenders;
CREATE TRIGGER trigger_update_smt_last_seen
BEFORE UPDATE ON smart_matched_tenders
FOR EACH ROW
EXECUTE FUNCTION update_smt_last_seen();

-- ── RLS ────────────────────────────────────────────────────────────
-- All access goes through the server (service_role) — see comment
-- header above for why. No client-facing policies are defined, which
-- (with RLS enabled) means the anon/authenticated roles get zero
-- direct access; only service_role bypasses RLS entirely.
ALTER TABLE smart_matched_tenders ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE smart_matched_tenders IS
  'Per-user smart-match results, scored against the resilient active_tenders '
  'store (not the live eTenders API). Populated by an on-demand JS function '
  '(server/routes/smartMatch.js), never by a cron job. '
  'Created: 2026-09-16 | Migration: 006_smart_matched_tenders.sql';
