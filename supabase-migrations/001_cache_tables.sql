-- ================================================================
-- PHASE 2: SUPABASE CACHE TABLES
-- ================================================================
-- Purpose: Enable cross-device sync and server-side caching
-- Created: 2026-02-23
-- Related: SUPABASE-CACHING-STRATEGY.md, src/utils/tenderCacheDB.js
-- ================================================================

-- ================================================================
-- 1. TENDER CACHE TABLE
-- ================================================================
-- Stores cached government tenders for cross-device sync
-- TTL: 24 hours (managed by application logic)
-- ================================================================

CREATE TABLE IF NOT EXISTS tender_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  tenders JSONB NOT NULL,
  tender_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tender_cache_unique_key UNIQUE(user_id, cache_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tender_cache_user_id ON tender_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_tender_cache_expires_at ON tender_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_tender_cache_cache_key ON tender_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_tender_cache_dates ON tender_cache(date_from, date_to);

-- Auto-update last_accessed_at
CREATE OR REPLACE FUNCTION update_tender_cache_access_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_accessed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_tender_cache_access
BEFORE UPDATE ON tender_cache
FOR EACH ROW
EXECUTE FUNCTION update_tender_cache_access_time();

-- Comment on table
COMMENT ON TABLE tender_cache IS 'Stores cached government tenders for cross-device sync (24hr TTL)';


-- ================================================================
-- 2. AI KEYWORD CACHE TABLE
-- ================================================================
-- Stores extracted AI keywords to avoid duplicate OpenAI calls
-- TTL: 1 hour (managed by application logic)
-- ================================================================

CREATE TABLE IF NOT EXISTS ai_keyword_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_hash TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  analysis JSONB DEFAULT '{}',
  bio_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  usage_count INTEGER DEFAULT 1,
  CONSTRAINT ai_cache_unique_user UNIQUE(user_id, profile_hash)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_cache_user_id ON ai_keyword_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_keyword_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_profile_hash ON ai_keyword_cache(profile_hash);

-- Auto-update usage stats
CREATE OR REPLACE FUNCTION update_ai_cache_usage()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_used_at = NOW();
  NEW.usage_count = OLD.usage_count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_cache_usage
BEFORE UPDATE ON ai_keyword_cache
FOR EACH ROW
EXECUTE FUNCTION update_ai_cache_usage();

-- Comment on table
COMMENT ON TABLE ai_keyword_cache IS 'Stores AI-extracted keywords to reduce OpenAI API costs (1hr TTL)';


-- ================================================================
-- 3. USER CACHE PREFERENCES TABLE
-- ================================================================
-- Stores user-specific cache settings and preferences
-- ================================================================

CREATE TABLE IF NOT EXISTS user_cache_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  enable_cache BOOLEAN DEFAULT true,
  enable_cross_device_sync BOOLEAN DEFAULT true,
  max_cache_size_mb INTEGER DEFAULT 50,
  tender_cache_ttl_hours INTEGER DEFAULT 24,
  ai_cache_ttl_hours INTEGER DEFAULT 1,
  auto_clear_on_logout BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_cache_prefs_user_id ON user_cache_preferences(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_cache_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_cache_prefs_updated_at
BEFORE UPDATE ON user_cache_preferences
FOR EACH ROW
EXECUTE FUNCTION update_cache_prefs_updated_at();

-- Comment on table
COMMENT ON TABLE user_cache_preferences IS 'User-specific cache settings and preferences';


-- ================================================================
-- 4. CACHE STATISTICS TABLE
-- ================================================================
-- Tracks cache usage for analytics and monitoring
-- ================================================================

CREATE TABLE IF NOT EXISTS cache_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_type TEXT NOT NULL, -- 'tender' | 'ai' | 'session'
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  last_miss_at TIMESTAMPTZ,
  total_size_bytes BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cache_stats_unique_user_type UNIQUE(user_id, cache_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cache_stats_user_id ON cache_statistics(user_id);
CREATE INDEX IF NOT EXISTS idx_cache_stats_type ON cache_statistics(cache_type);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_cache_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_cache_stats_updated_at
BEFORE UPDATE ON cache_statistics
FOR EACH ROW
EXECUTE FUNCTION update_cache_stats_updated_at();

-- Comment on table
COMMENT ON TABLE cache_statistics IS 'Tracks cache usage metrics for analytics and monitoring';


-- ================================================================
-- 5. CLEANUP FUNCTION
-- ================================================================
-- Automatically removes expired cache entries
-- Run this periodically via a cron job or manually
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS TABLE(
  deleted_tenders INTEGER,
  deleted_ai_cache INTEGER
) AS $$
DECLARE
  tender_count INTEGER;
  ai_count INTEGER;
BEGIN
  -- Delete expired tender cache
  DELETE FROM tender_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS tender_count = ROW_COUNT;
  
  -- Delete expired AI keyword cache
  DELETE FROM ai_keyword_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS ai_count = ROW_COUNT;
  
  RETURN QUERY SELECT tender_count, ai_count;
END;
$$ LANGUAGE plpgsql;

-- Comment on function
COMMENT ON FUNCTION cleanup_expired_cache() IS 'Removes expired cache entries (run via cron job)';


-- ================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ================================================================
-- Ensure users can only access their own cache data
-- ================================================================

-- Enable RLS on all cache tables
ALTER TABLE tender_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_keyword_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cache_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_statistics ENABLE ROW LEVEL SECURITY;

-- Tender Cache Policies
CREATE POLICY "Users can view their own tender cache"
  ON tender_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tender cache"
  ON tender_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tender cache"
  ON tender_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tender cache"
  ON tender_cache FOR DELETE
  USING (auth.uid() = user_id);

-- AI Keyword Cache Policies
CREATE POLICY "Users can view their own AI cache"
  ON ai_keyword_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own AI cache"
  ON ai_keyword_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own AI cache"
  ON ai_keyword_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own AI cache"
  ON ai_keyword_cache FOR DELETE
  USING (auth.uid() = user_id);

-- User Cache Preferences Policies
CREATE POLICY "Users can view their own cache preferences"
  ON user_cache_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cache preferences"
  ON user_cache_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cache preferences"
  ON user_cache_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cache preferences"
  ON user_cache_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Cache Statistics Policies
CREATE POLICY "Users can view their own cache statistics"
  ON cache_statistics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cache statistics"
  ON cache_statistics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cache statistics"
  ON cache_statistics FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cache statistics"
  ON cache_statistics FOR DELETE
  USING (auth.uid() = user_id);


-- ================================================================
-- 7. INITIAL DATA
-- ================================================================
-- Create default cache preferences for existing users
-- ================================================================

-- This will run once to create default preferences for any existing users
INSERT INTO user_cache_preferences (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;


-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Next steps:
-- 1. Run this SQL in Supabase SQL Editor
-- 2. Implement sync functions in src/lib/supabaseCache.js
-- 3. Integrate with SmartMatchedTenders.jsx
-- 4. Test cross-device synchronization
-- ================================================================
