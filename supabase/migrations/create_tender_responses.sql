-- ──────────────────────────────────────────────────────────────────
-- Migration: create_tender_responses
-- Table for AI-drafted tender responses saved by users
-- Run this in: Supabase Dashboard → SQL Editor → Paste → Run
-- ──────────────────────────────────────────────────────────────────

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.tender_responses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- User ownership
  user_id           UUID        NOT NULL,
  user_email        TEXT        NOT NULL DEFAULT '',

  -- Tender identity
  tender_id         TEXT        NOT NULL,  -- OCID or synthetic ID
  tender_title      TEXT        NOT NULL,
  tender_ref        TEXT        NULL,
  organ_of_state    TEXT        NULL,
  closing_date      TEXT        NULL,
  category          TEXT        NULL,
  match_percentage  INTEGER     NULL,

  -- Workflow status
  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'in_progress', 'submitted')),

  -- AI-generated content
  executive_summary TEXT        NULL,
  company_overview  TEXT        NULL,
  technical_approach TEXT       NULL,
  team_capability   TEXT        NULL,
  pricing_narrative TEXT        NULL,

  -- Structured data
  compliance_items  JSONB       NOT NULL DEFAULT '[]',
  key_requirements  JSONB       NOT NULL DEFAULT '[]',

  -- Metadata
  document_analyzed BOOLEAN     NOT NULL DEFAULT false,
  tokens_used       INTEGER     NULL,
  model             TEXT        NULL,

  -- One draft per user per tender
  UNIQUE (user_id, tender_id)
);

-- 2. Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tender_responses_updated_at ON public.tender_responses;
CREATE TRIGGER tender_responses_updated_at
  BEFORE UPDATE ON public.tender_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Row-Level Security: users own their rows
ALTER TABLE public.tender_responses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own rows
CREATE POLICY "Users can read own drafts"
  ON public.tender_responses
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own rows
CREATE POLICY "Users can insert own drafts"
  ON public.tender_responses
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own rows
CREATE POLICY "Users can update own drafts"
  ON public.tender_responses
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to delete their own rows
CREATE POLICY "Users can delete own drafts"
  ON public.tender_responses
  FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Index for fast per-user queries
CREATE INDEX IF NOT EXISTS idx_tender_responses_user_id
  ON public.tender_responses (user_id, updated_at DESC);

-- Done!
-- ──────────────────────────────────────────────────────────────────
-- Verify:
--   SELECT * FROM public.tender_responses LIMIT 5;
-- ──────────────────────────────────────────────────────────────────
