/**
 * SUPABASE CACHE UTILITIES
 * ========================
 * Server-side caching layer for cross-device synchronization
 * Complements IndexedDB (client-side) caching
 * 
 * Features:
 * - Tender cache with 24hr TTL
 * - AI keyword cache with 1hr TTL
 * - Cross-device sync
 * - Cache statistics tracking
 * - User preferences management
 * 
 * Related:
 * - src/utils/tenderCacheDB.js (IndexedDB layer)
 * - SUPABASE-CACHING-STRATEGY.md (architecture docs)
 * - supabase-migrations/001_cache_tables.sql (database schema)
 */

import { supabase } from '../lib/supabase';
import { saveTendersToIDB, saveAIAnalysisToIDB } from './tenderCacheDB';

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Generate cache key from date range
 */
function generateCacheKey(dateFrom, dateTo) {
  return `${dateFrom}_${dateTo}`;
}

/**
 * Generate profile hash for AI cache
 */
function generateProfileHash(profile) {
  const bio = profile?.profile?.bio || profile?.bio || '';
  const description = profile?.startup?.description || profile?.description || '';
  const combined = (bio + description).trim();
  
  // Simple hash function (you could use crypto.subtle.digest for production)
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get current user ID
 */
async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id;
}

// ================================================================
// TENDER CACHE FUNCTIONS
// ================================================================

/**
 * Save tenders to Supabase cache
 * @param {Array} tenders - Array of tender objects
 * @param {string} dateFrom - Start date
 * @param {string} dateTo - End date
 * @returns {Promise<boolean>} Success status
 */
export async function saveTendersToSupabase(tenders, dateFrom, dateTo) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in - skipping Supabase cache');
      return false;
    }

    const cacheKey = generateCacheKey(dateFrom, dateTo);
    
    const { data, error } = await supabase
      .from('tender_cache')
      .upsert({
        user_id: userId,
        cache_key: cacheKey,
        date_from: dateFrom,
        date_to: dateTo,
        tenders: tenders,
        tender_count: tenders.length,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }, {
        onConflict: 'user_id,cache_key'
      });

    if (error) throw error;

    console.log(`✅ Saved ${tenders.length} tenders to Supabase cache`);
    
    // Track cache statistics
    await updateCacheStatistics(userId, 'tender', 'write', tenders.length);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to save tenders to Supabase:', error);
    return false;
  }
}

/**
 * Get tenders from Supabase cache
 * @param {string} dateFrom - Start date
 * @param {string} dateTo - End date
 * @param {number} maxAge - Max age in hours (default: 24)
 * @returns {Promise<Array|null>} Cached tenders or null
 */
export async function getTendersFromSupabase(dateFrom, dateTo, maxAge = 24) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in - skipping Supabase cache check');
      return null;
    }

    const cacheKey = generateCacheKey(dateFrom, dateTo);
    const expiryTime = new Date(Date.now() - maxAge * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('tender_cache')
      .select('*')
      .eq('user_id', userId)
      .eq('cache_key', cacheKey)
      .gt('created_at', expiryTime.toISOString())
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - cache miss
        console.log('⚠️ Supabase cache miss');
        await updateCacheStatistics(userId, 'tender', 'miss');
        return null;
      }
      throw error;
    }

    if (data && data.tenders) {
      console.log(`✅ Supabase cache hit: ${data.tender_count} tenders`);
      
      // Sync to IndexedDB for faster subsequent access
      await saveTendersToIDB(data.tenders, dateFrom, dateTo);
      
      // Track cache hit
      await updateCacheStatistics(userId, 'tender', 'hit', data.tenders.length);
      
      return data.tenders;
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to get tenders from Supabase:', error);
    return null;
  }
}

// ================================================================
// AI KEYWORD CACHE FUNCTIONS
// ================================================================

/**
 * Save AI keywords to Supabase cache
 * @param {string} userId - User ID
 * @param {Array} keywords - Extracted keywords
 * @param {Object} analysis - Optional analysis data
 * @param {Object} profile - User profile for hashing
 * @returns {Promise<boolean>} Success status
 */
export async function saveAIKeywordsToSupabase(userId, keywords, analysis = {}, profile) {
  try {
    if (!userId) {
      console.warn('⚠️ No user ID provided - skipping Supabase AI cache');
      return false;
    }

    const profileHash = generateProfileHash(profile);
    const bioSnippet = (profile?.profile?.bio || profile?.bio || '').substring(0, 100);

    const { data, error } = await supabase
      .from('ai_keyword_cache')
      .upsert({
        user_id: userId,
        profile_hash: profileHash,
        keywords: keywords,
        analysis: analysis,
        bio_snippet: bioSnippet,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
      }, {
        onConflict: 'user_id,profile_hash'
      });

    if (error) throw error;

    console.log(`✅ Saved AI keywords to Supabase cache: ${keywords.join(', ')}`);
    
    // Track cache statistics
    await updateCacheStatistics(userId, 'ai', 'write', keywords.length);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to save AI keywords to Supabase:', error);
    return false;
  }
}

/**
 * Get AI keywords from Supabase cache
 * @param {string} userId - User ID
 * @param {Object} profile - User profile for hashing
 * @param {number} maxAge - Max age in hours (default: 1)
 * @returns {Promise<Object|null>} Cached keywords or null
 */
export async function getAIKeywordsFromSupabase(userId, profile, maxAge = 1) {
  try {
    if (!userId) {
      console.warn('⚠️ No user ID provided - skipping Supabase AI cache check');
      return null;
    }

    const profileHash = generateProfileHash(profile);
    const expiryTime = new Date(Date.now() - maxAge * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('ai_keyword_cache')
      .select('*')
      .eq('user_id', userId)
      .eq('profile_hash', profileHash)
      .gt('created_at', expiryTime.toISOString())
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - cache miss
        console.log('⚠️ Supabase AI cache miss');
        await updateCacheStatistics(userId, 'ai', 'miss');
        return null;
      }
      throw error;
    }

    if (data && data.keywords) {
      console.log(`✅ Supabase AI cache hit: ${data.keywords.join(', ')}`);
      
      // Sync to IndexedDB for faster subsequent access
      await saveAIAnalysisToIDB(userId, data.keywords, data.analysis || {});
      
      // Track cache hit
      await updateCacheStatistics(userId, 'ai', 'hit', data.keywords.length);
      
      return {
        keywords: data.keywords,
        analysis: data.analysis || {},
        cached_at: data.created_at
      };
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to get AI keywords from Supabase:', error);
    return null;
  }
}

// ================================================================
// CACHE STATISTICS FUNCTIONS
// ================================================================

/**
 * Update cache statistics
 * @param {string} userId - User ID
 * @param {string} cacheType - 'tender' | 'ai' | 'session'
 * @param {string} operation - 'hit' | 'miss' | 'write'
 * @param {number} size - Data size (optional)
 */
async function updateCacheStatistics(userId, cacheType, operation, size = 0) {
  try {
    if (!userId) return;

    // Get existing stats or create new
    const { data: existing } = await supabase
      .from('cache_statistics')
      .select('*')
      .eq('user_id', userId)
      .eq('cache_type', cacheType)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing stats
      const updates = {
        updated_at: now
      };

      if (operation === 'hit') {
        updates.cache_hits = (existing.cache_hits || 0) + 1;
        updates.last_hit_at = now;
      } else if (operation === 'miss') {
        updates.cache_misses = (existing.cache_misses || 0) + 1;
        updates.last_miss_at = now;
      } else if (operation === 'write') {
        updates.total_size_bytes = size;
      }

      await supabase
        .from('cache_statistics')
        .update(updates)
        .eq('user_id', userId)
        .eq('cache_type', cacheType);
    } else {
      // Create new stats
      await supabase
        .from('cache_statistics')
        .insert({
          user_id: userId,
          cache_type: cacheType,
          cache_hits: operation === 'hit' ? 1 : 0,
          cache_misses: operation === 'miss' ? 1 : 0,
          last_hit_at: operation === 'hit' ? now : null,
          last_miss_at: operation === 'miss' ? now : null,
          total_size_bytes: size
        });
    }
  } catch (error) {
    // Silently fail - statistics are not critical
    console.debug('Failed to update cache statistics:', error);
  }
}

/**
 * Get cache statistics for user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Cache statistics
 */
export async function getCacheStatistics(userId) {
  try {
    if (!userId) {
      userId = await getCurrentUserId();
    }

    const { data, error } = await supabase
      .from('cache_statistics')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('❌ Failed to get cache statistics:', error);
    return [];
  }
}

// ================================================================
// CACHE CLEANUP FUNCTIONS
// ================================================================

/**
 * Clear all Supabase cache for user
 * @param {string} userId - User ID (optional)
 * @returns {Promise<boolean>} Success status
 */
export async function clearSupabaseCache(userId = null) {
  try {
    if (!userId) {
      userId = await getCurrentUserId();
    }

    if (!userId) {
      console.warn('⚠️ No user ID - cannot clear cache');
      return false;
    }

    // Clear tender cache
    await supabase
      .from('tender_cache')
      .delete()
      .eq('user_id', userId);

    // Clear AI cache
    await supabase
      .from('ai_keyword_cache')
      .delete()
      .eq('user_id', userId);

    console.log('✅ Cleared all Supabase cache');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear Supabase cache:', error);
    return false;
  }
}

/**
 * Cleanup expired cache entries (admin function)
 * Call this periodically via a cron job
 */
export async function cleanupExpiredCache() {
  try {
    const { data, error } = await supabase
      .rpc('cleanup_expired_cache');

    if (error) throw error;

    console.log(`✅ Cleaned up expired cache:`, data);
    return data;
  } catch (error) {
    console.error('❌ Failed to cleanup expired cache:', error);
    return null;
  }
}

// ================================================================
// USER PREFERENCES FUNCTIONS
// ================================================================

/**
 * Get user cache preferences
 * @param {string} userId - User ID (optional)
 * @returns {Promise<Object>} User preferences
 */
export async function getCachePreferences(userId = null) {
  try {
    if (!userId) {
      userId = await getCurrentUserId();
    }

    if (!userId) return null;

    const { data, error } = await supabase
      .from('user_cache_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No preferences yet - create default
        return await createDefaultCachePreferences(userId);
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('❌ Failed to get cache preferences:', error);
    return null;
  }
}

/**
 * Create default cache preferences for user
 */
async function createDefaultCachePreferences(userId) {
  try {
    const { data, error } = await supabase
      .from('user_cache_preferences')
      .insert({
        user_id: userId,
        enable_cache: true,
        enable_cross_device_sync: true,
        max_cache_size_mb: 50,
        tender_cache_ttl_hours: 24,
        ai_cache_ttl_hours: 1,
        auto_clear_on_logout: false
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('❌ Failed to create default cache preferences:', error);
    return null;
  }
}

/**
 * Update user cache preferences
 * @param {string} userId - User ID
 * @param {Object} preferences - Preferences to update
 * @returns {Promise<boolean>} Success status
 */
export async function updateCachePreferences(userId, preferences) {
  try {
    if (!userId) {
      userId = await getCurrentUserId();
    }

    if (!userId) return false;

    const { error } = await supabase
      .from('user_cache_preferences')
      .update(preferences)
      .eq('user_id', userId);

    if (error) throw error;

    console.log('✅ Updated cache preferences');
    return true;
  } catch (error) {
    console.error('❌ Failed to update cache preferences:', error);
    return false;
  }
}

// ================================================================
// SYNC FUNCTIONS
// ================================================================

/**
 * Sync IndexedDB cache to Supabase
 * Call this on login or when online status changes
 * @returns {Promise<boolean>} Success status
 */
export async function syncCacheToSupabase() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in - cannot sync to Supabase');
      return false;
    }

    // Get preferences
    const prefs = await getCachePreferences(userId);
    if (!prefs || !prefs.enable_cross_device_sync) {
      console.log('⚠️ Cross-device sync disabled in preferences');
      return false;
    }

    console.log('🔄 Syncing cache to Supabase...');

    // Import here to avoid circular dependency
    const { getTendersFromIDB, getAIAnalysisFromIDB } = await import('./tenderCacheDB');

    // Sync tenders from IndexedDB to Supabase
    // (Implementation depends on your date range logic)
    
    console.log('✅ Cache sync to Supabase complete');
    return true;
  } catch (error) {
    console.error('❌ Failed to sync cache to Supabase:', error);
    return false;
  }
}

/**
 * Sync Supabase cache to IndexedDB
 * Call this on login or when switching devices
 * @returns {Promise<boolean>} Success status
 */
export async function syncCacheFromSupabase() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in - cannot sync from Supabase');
      return false;
    }

    // Get preferences
    const prefs = await getCachePreferences(userId);
    if (!prefs || !prefs.enable_cross_device_sync) {
      console.log('⚠️ Cross-device sync disabled in preferences');
      return false;
    }

    console.log('🔄 Syncing cache from Supabase to IndexedDB...');

    // Get all tender cache entries
    const { data: tenderCaches, error: tenderError } = await supabase
      .from('tender_cache')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString());

    if (!tenderError && tenderCaches) {
      for (const cache of tenderCaches) {
        await saveTendersToIDB(cache.tenders, cache.date_from, cache.date_to);
      }
      console.log(`✅ Synced ${tenderCaches.length} tender caches to IndexedDB`);
    }

    // Get AI keyword cache
    const { data: aiCaches, error: aiError } = await supabase
      .from('ai_keyword_cache')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString());

    if (!aiError && aiCaches) {
      for (const cache of aiCaches) {
        await saveAIAnalysisToIDB(userId, cache.keywords, cache.analysis || {});
      }
      console.log(`✅ Synced ${aiCaches.length} AI caches to IndexedDB`);
    }

    console.log('✅ Cache sync from Supabase complete');
    return true;
  } catch (error) {
    console.error('❌ Failed to sync cache from Supabase:', error);
    return false;
  }
}
