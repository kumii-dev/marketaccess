-- ================================================================
-- EMAIL SUBSCRIPTIONS TABLE
-- ================================================================
-- Purpose: Store user preferences for scheduled smart-matched
--          tender digest emails (daily or weekly).
--
-- Design:
--   • One row per user (UNIQUE on user_id)
--   • frequency: 'daily' | 'weekly'
--   • min_score: 0–100, default 40 (matches "above 40%" requirement)
--   • last_sent_at: updated after every successful dispatch
--   • enabled: soft-delete / pause without losing settings
-- ================================================================

CREATE TABLE IF NOT EXISTS email_subscriptions (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email         TEXT         NOT NULL,
  frequency     TEXT         NOT NULL DEFAULT 'weekly'
                               CHECK (frequency IN ('daily', 'weekly')),
  min_score     INTEGER      NOT NULL DEFAULT 40
                               CHECK (min_score BETWEEN 0 AND 100),
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  last_sent_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for the cron job: fetch all enabled subscribers quickly
CREATE INDEX IF NOT EXISTS idx_email_subs_enabled
  ON email_subscriptions (enabled, frequency)
  WHERE enabled = true;

-- Auto-update updated_at on every change
CREATE OR REPLACE FUNCTION update_email_subs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_email_subs_updated_at
  BEFORE UPDATE ON email_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_email_subs_updated_at();

-- ── Row Level Security ────────────────────────────────────────────
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_subs_select" ON email_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "email_subs_insert" ON email_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "email_subs_update" ON email_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "email_subs_delete" ON email_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- ── Documentation ─────────────────────────────────────────────────
COMMENT ON TABLE email_subscriptions IS
  'User preferences for scheduled smart-matched tender digest emails. '
  'One row per user. Cron job reads this table to dispatch daily/weekly digests. '
  'Created: 2026-06-08 | Migration: 003_email_subscriptions.sql';
