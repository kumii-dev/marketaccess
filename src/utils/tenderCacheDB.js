/**
 * IndexedDB Tender Cache Service
 * Provides persistent browser storage for tenders and AI analysis
 * Much faster than API calls and persists across sessions
 */

import { openDB } from 'idb';

const DB_NAME = 'MarketAccessCache';
const DB_VERSION = 1;
const TENDER_STORE = 'tenders';
const AI_STORE = 'aiAnalysis';

/**
 * Initialize IndexedDB with stores for tenders and AI analysis
 */
export const initTenderDB = async () => {
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Tenders store
        if (!db.objectStoreNames.contains(TENDER_STORE)) {
          const tenderStore = db.createObjectStore(TENDER_STORE, { keyPath: 'cacheKey' });
          tenderStore.createIndex('timestamp', 'timestamp');
          tenderStore.createIndex('dateRange', 'dateRange');
        }
        
        // AI Analysis store
        if (!db.objectStoreNames.contains(AI_STORE)) {
          const aiStore = db.createObjectStore(AI_STORE, { keyPath: 'userId' });
          aiStore.createIndex('timestamp', 'timestamp');
        }
      },
    });
  } catch (error) {
    console.error('Failed to initialize IndexedDB:', error);
    return null;
  }
};

/**
 * Save tenders to IndexedDB
 * @param {Array} tenders - Array of tender objects
 * @param {string} dateFrom - Start date (YYYY-MM-DD)
 * @param {string} dateTo - End date (YYYY-MM-DD)
 */
export const saveTendersToIDB = async (tenders, dateFrom, dateTo) => {
  try {
    const db = await initTenderDB();
    if (!db) return false;
    
    const cacheKey = `${dateFrom}_${dateTo}`;
    
    await db.put(TENDER_STORE, {
      cacheKey,
      tenders,
      dateRange: { from: dateFrom, to: dateTo },
      timestamp: Date.now(),
    });
    
    console.log(`💾 IndexedDB: Saved ${tenders.length} tenders (${cacheKey})`);
    return true;
  } catch (error) {
    console.error('Failed to save tenders to IndexedDB:', error);
    return false;
  }
};

/**
 * Get tenders from IndexedDB
 * @param {string} dateFrom - Start date (YYYY-MM-DD)
 * @param {string} dateTo - End date (YYYY-MM-DD)
 * @param {number} maxAge - Maximum age in milliseconds (default: 24 hours)
 * @returns {Array|null} - Cached tenders or null
 */
export const getTendersFromIDB = async (dateFrom, dateTo, maxAge = 24 * 60 * 60 * 1000) => {
  try {
    const db = await initTenderDB();
    if (!db) return null;
    
    const cacheKey = `${dateFrom}_${dateTo}`;
    const cached = await db.get(TENDER_STORE, cacheKey);
    
    if (!cached) {
      console.log('📭 IndexedDB: No cached tenders found');
      return null;
    }
    
    // Check age
    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      console.log(`🕐 IndexedDB: Cache expired (${Math.round(age / 1000 / 60)} minutes old)`);
      await db.delete(TENDER_STORE, cacheKey);
      return null;
    }
    
    const ageMinutes = Math.round(age / 1000 / 60);
    console.log(`⚡ IndexedDB: Loaded ${cached.tenders.length} tenders (${ageMinutes}min old)`);
    return cached.tenders;
  } catch (error) {
    console.error('Failed to read tenders from IndexedDB:', error);
    return null;
  }
};

/**
 * Save AI analysis results to IndexedDB
 * @param {string} userId - User ID
 * @param {Array} keywords - Extracted keywords
 * @param {Object} analysis - AI analysis results
 */
export const saveAIAnalysisToIDB = async (userId, keywords, analysis) => {
  try {
    const db = await initTenderDB();
    if (!db) return false;
    
    await db.put(AI_STORE, {
      userId,
      keywords,
      analysis,
      timestamp: Date.now(),
    });
    
    console.log(`🤖 IndexedDB: Saved AI analysis for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Failed to save AI analysis to IndexedDB:', error);
    return false;
  }
};

/**
 * Get AI analysis results from IndexedDB
 * @param {string} userId - User ID
 * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
 * @returns {Object|null} - Cached AI analysis or null
 */
export const getAIAnalysisFromIDB = async (userId, maxAge = 60 * 60 * 1000) => {
  try {
    const db = await initTenderDB();
    if (!db) return null;
    
    const cached = await db.get(AI_STORE, userId);
    
    if (!cached) {
      console.log('📭 IndexedDB: No cached AI analysis found');
      return null;
    }
    
    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      console.log(`🕐 IndexedDB: AI cache expired (${Math.round(age / 1000 / 60)} minutes old)`);
      await db.delete(AI_STORE, userId);
      return null;
    }
    
    console.log(`🤖 IndexedDB: Loaded cached AI analysis (${Math.round(age / 1000)}s old)`);
    return { keywords: cached.keywords, analysis: cached.analysis };
  } catch (error) {
    console.error('Failed to read AI analysis from IndexedDB:', error);
    return null;
  }
};

/**
 * Clear all tender cache from IndexedDB
 */
export const clearTenderCacheIDB = async () => {
  try {
    const db = await initTenderDB();
    if (!db) return false;
    
    await db.clear(TENDER_STORE);
    console.log('🗑️ IndexedDB: Cleared all tender cache');
    return true;
  } catch (error) {
    console.error('Failed to clear tender cache:', error);
    return false;
  }
};

/**
 * Clear AI analysis cache from IndexedDB
 */
export const clearAIAnalysisCacheIDB = async () => {
  try {
    const db = await initTenderDB();
    if (!db) return false;
    
    await db.clear(AI_STORE);
    console.log('🗑️ IndexedDB: Cleared AI analysis cache');
    return true;
  } catch (error) {
    console.error('Failed to clear AI analysis cache:', error);
    return false;
  }
};

/**
 * Clear all caches (tenders + AI analysis)
 */
export const clearAllCachesIDB = async () => {
  try {
    await clearTenderCacheIDB();
    await clearAIAnalysisCacheIDB();
    console.log('🗑️ IndexedDB: Cleared all caches');
    return true;
  } catch (error) {
    console.error('Failed to clear all caches:', error);
    return false;
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
  try {
    const db = await initTenderDB();
    if (!db) return null;
    
    const tenders = await db.getAll(TENDER_STORE);
    const aiAnalysis = await db.getAll(AI_STORE);
    
    const stats = {
      tenderCacheCount: tenders.length,
      aiAnalysisCount: aiAnalysis.length,
      totalTenders: tenders.reduce((sum, cache) => sum + (cache.tenders?.length || 0), 0),
      oldestCache: tenders.length > 0 ? Math.min(...tenders.map(c => c.timestamp)) : null,
      newestCache: tenders.length > 0 ? Math.max(...tenders.map(c => c.timestamp)) : null,
    };
    
    if (stats.oldestCache) {
      stats.oldestCacheAge = Math.round((Date.now() - stats.oldestCache) / 1000 / 60);
      stats.newestCacheAge = Math.round((Date.now() - stats.newestCache) / 1000 / 60);
    }
    
    return stats;
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return null;
  }
};
