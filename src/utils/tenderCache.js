/**
 * Tender Cache Service
 * Provides session-based caching for tender data to improve performance
 */

const CACHE_KEY = 'smartMatchedTenders_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Cache structure:
 * {
 *   timestamp: number,
 *   tenders: Array,
 *   dateRange: { from: string, to: string }
 * }
 */

/**
 * Save tenders to session cache
 * @param {Array} tenders - Tenders to cache
 * @param {string} dateFrom - Start date
 * @param {string} dateTo - End date
 */
export const cacheTenders = (tenders, dateFrom, dateTo) => {
  try {
    const cacheData = {
      timestamp: Date.now(),
      tenders,
      dateRange: { from: dateFrom, to: dateTo }
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    console.log(`📦 Cached ${tenders.length} tenders for session`);
  } catch (error) {
    console.warn('Failed to cache tenders:', error);
  }
};

/**
 * Get tenders from cache if valid
 * @param {string} dateFrom - Start date
 * @param {string} dateTo - End date
 * @returns {Array|null} - Cached tenders or null
 */
export const getCachedTenders = (dateFrom, dateTo) => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) {
      return null;
    }

    const cacheData = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is expired
    if (now - cacheData.timestamp > CACHE_DURATION) {
      console.log('⏰ Cache expired, clearing...');
      clearTenderCache();
      return null;
    }

    // Check if date range matches
    if (cacheData.dateRange.from !== dateFrom || cacheData.dateRange.to !== dateTo) {
      console.log('📅 Date range changed, cache invalid');
      return null;
    }

    console.log(`✅ Using cached tenders: ${cacheData.tenders.length} items`);
    return cacheData.tenders;
  } catch (error) {
    console.warn('Failed to read tender cache:', error);
    return null;
  }
};

/**
 * Clear tender cache
 */
export const clearTenderCache = () => {
  try {
    sessionStorage.removeItem(CACHE_KEY);
    console.log('🗑️ Tender cache cleared');
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
};

/**
 * Get cache info for debugging
 * @returns {Object|null} - Cache metadata
 */
export const getCacheInfo = () => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) {
      return null;
    }

    const cacheData = JSON.parse(cached);
    const now = Date.now();
    const age = now - cacheData.timestamp;
    const remaining = CACHE_DURATION - age;

    return {
      tenderCount: cacheData.tenders.length,
      ageMs: age,
      remainingMs: remaining,
      expired: remaining <= 0,
      dateRange: cacheData.dateRange
    };
  } catch (error) {
    return null;
  }
};
