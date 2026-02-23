# Supabase Caching Strategy for Optimized Page Reloads

## 🎯 Goal
Achieve sub-second load times on page refresh with graceful degradation when Supabase is slow/unavailable.

## 📊 Current Architecture
```
User → SessionStorage (5min TTL) → External API → Display
```

## 🚀 Recommended Architecture: **Triple-Layer Cache**

```
User Refresh
    ↓
1. Memory Cache (Instant) ←─────────────┐
    ↓ miss                               │
2. IndexedDB (10-50ms) ←─────────┐      │
    ↓ miss                        │      │
3. Supabase Cache (50-200ms) ←───┤      │
    ↓ miss                        │      │
4. External API (1-3s)            │      │
    ↓                             │      │
    └─ Update all caches ─────────┴──────┘
```

### Layer 1: **Memory Cache** (React State/Ref)
- **Speed**: Instant (0ms)
- **Lifetime**: Single session
- **Size**: Unlimited
- **Use**: Current tenders in memory

### Layer 2: **IndexedDB** (Browser Storage)
- **Speed**: 10-50ms
- **Lifetime**: 30 days
- **Size**: 50MB - 1GB
- **Use**: Persistent tender cache + AI analysis results

### Layer 3: **Supabase Cache Table**
- **Speed**: 50-200ms (with CDN)
- **Lifetime**: 24 hours
- **Size**: Unlimited
- **Use**: Cross-device sync, AI keyword cache

### Layer 4: **External Tender API**
- **Speed**: 1-3 seconds
- **Lifetime**: N/A (always fresh)
- **Use**: Source of truth

---

## 🏗️ Implementation Plan

### Phase 1: IndexedDB Integration ⭐ **START HERE**

**Why IndexedDB?**
- ✅ Persists across page refreshes (unlike sessionStorage)
- ✅ Large storage capacity (50MB+)
- ✅ Fast read/write (10-50ms)
- ✅ Can store AI analysis results
- ✅ Works offline

**Implementation:**

```javascript
// src/utils/tenderCacheDB.js
import { openDB } from 'idb'; // npm install idb

const DB_NAME = 'MarketAccessCache';
const DB_VERSION = 1;
const TENDER_STORE = 'tenders';
const AI_STORE = 'aiAnalysis';

// Initialize IndexedDB
export const initTenderDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
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
};

// Save tenders to IndexedDB
export const saveTendersToIDB = async (tenders, dateFrom, dateTo) => {
  const db = await initTenderDB();
  const cacheKey = `${dateFrom}_${dateTo}`;
  
  await db.put(TENDER_STORE, {
    cacheKey,
    tenders,
    dateRange: { from: dateFrom, to: dateTo },
    timestamp: Date.now(),
  });
  
  console.log(`💾 Saved ${tenders.length} tenders to IndexedDB`);
};

// Get tenders from IndexedDB
export const getTendersFromIDB = async (dateFrom, dateTo, maxAge = 24 * 60 * 60 * 1000) => {
  const db = await initTenderDB();
  const cacheKey = `${dateFrom}_${dateTo}`;
  
  const cached = await db.get(TENDER_STORE, cacheKey);
  
  if (!cached) return null;
  
  // Check age
  const age = Date.now() - cached.timestamp;
  if (age > maxAge) {
    console.log('🕐 IndexedDB cache expired');
    return null;
  }
  
  console.log(`⚡ Loaded ${cached.tenders.length} tenders from IndexedDB (${Math.round(age/1000)}s old)`);
  return cached.tenders;
};

// Save AI analysis results
export const saveAIAnalysisToIDB = async (userId, keywords, analysis) => {
  const db = await initTenderDB();
  
  await db.put(AI_STORE, {
    userId,
    keywords,
    analysis,
    timestamp: Date.now(),
  });
  
  console.log(`🤖 Saved AI analysis to IndexedDB`);
};

// Get AI analysis results
export const getAIAnalysisFromIDB = async (userId, maxAge = 60 * 60 * 1000) => {
  const db = await initTenderDB();
  
  const cached = await db.get(AI_STORE, userId);
  
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > maxAge) return null;
  
  console.log(`🤖 Loaded AI analysis from IndexedDB`);
  return { keywords: cached.keywords, analysis: cached.analysis };
};
```

### Phase 2: Supabase Cache Table (Optional - Cross-Device Sync)

**Create Supabase table:**

```sql
-- Run in Supabase SQL Editor
CREATE TABLE tender_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  cache_key TEXT NOT NULL,
  tenders JSONB NOT NULL,
  date_range JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cache_key)
);

-- Index for fast lookups
CREATE INDEX idx_tender_cache_user_key ON tender_cache(user_id, cache_key);
CREATE INDEX idx_tender_cache_created ON tender_cache(created_at);

-- Auto-delete old entries (keep 24 hours)
CREATE OR REPLACE FUNCTION delete_old_tender_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM tender_cache 
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Run cleanup daily
SELECT cron.schedule(
  'delete-old-tender-cache',
  '0 2 * * *', -- 2 AM daily
  $$SELECT delete_old_tender_cache()$$
);

-- AI Keywords cache table
CREATE TABLE ai_keyword_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  profile_hash TEXT NOT NULL, -- Hash of profile data
  keywords TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 3: Update SmartMatchedTenders.jsx

**Modify loading logic to use multi-layer cache:**

```javascript
// In SmartMatchedTenders.jsx
import { getTendersFromIDB, saveTendersToIDB, getAIAnalysisFromIDB, saveAIAnalysisToIDB } from '../utils/tenderCacheDB';

const loadTenders = async (profile) => {
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
  const dateTo = today.toISOString().split('T')[0];

  try {
    // 1. Check IndexedDB first (10-50ms)
    console.log('⚡ Checking IndexedDB cache...');
    const cachedTenders = await getTendersFromIDB(dateFrom, dateTo);
    
    if (cachedTenders && cachedTenders.length > 0) {
      console.log('✅ Using IndexedDB cache - instant load!');
      setAllTenders(cachedTenders);
      const matched = matchTendersToProfile(cachedTenders, profile);
      setMatchedTenders(matched);
      setLoading(false);
      
      // Load AI analysis from cache
      const cachedAI = await getAIAnalysisFromIDB(profile.user_id);
      if (cachedAI) {
        console.log('🤖 Using cached AI analysis');
        // Apply cached AI data
      }
      
      // Fetch fresh data in background (stale-while-revalidate)
      fetchFreshTenders(dateFrom, dateTo, profile);
      return;
    }

    // 2. Fallback to session cache (5min TTL)
    const sessionCached = getCachedTenders(dateFrom, dateTo);
    if (sessionCached && sessionCached.length > 0) {
      console.log('⚡ Using session cache');
      setAllTenders(sessionCached);
      const matched = matchTendersToProfile(sessionCached, profile);
      setMatchedTenders(matched);
      setLoading(false);
      
      // Save to IndexedDB for next reload
      saveTendersToIDB(sessionCached, dateFrom, dateTo);
      return;
    }

    // 3. No cache - fetch from API
    console.log('🌐 Fetching from API (no cache available)');
    await fetchAndCacheTenders(dateFrom, dateTo, profile);

  } catch (err) {
    console.error('Error loading tenders:', err);
    setError(err.message);
    setLoading(false);
  }
};

// Fetch fresh data in background
const fetchFreshTenders = async (dateFrom, dateTo, profile) => {
  try {
    console.log('🔄 Fetching fresh data in background...');
    const freshData = await fetchTenders({ page: 1, limit: 100, dateFrom, dateTo });
    
    // Update caches
    await saveTendersToIDB(freshData, dateFrom, dateTo);
    cacheTenders(freshData, dateFrom, dateTo);
    
    // Only update UI if data changed
    console.log('✅ Background refresh complete');
  } catch (err) {
    console.warn('Background refresh failed:', err);
  }
};
```

---

## 📈 Expected Performance

### Before (Current):
```
Page Refresh → SessionStorage (miss after 5min) → API (2-3s) → Display
TOTAL: 2-3 seconds
```

### After (With IndexedDB):
```
Page Refresh → IndexedDB (hit) → Display → Background API update
TOTAL: 10-50ms (instant feel!)
```

### Load Time Comparison:
| Scenario | Current | With IndexedDB | Improvement |
|----------|---------|----------------|-------------|
| Fresh visit | 2-3s | 2-3s | Same |
| Reload < 5min | Instant | Instant | Same |
| Reload > 5min | 2-3s | **50ms** | **60x faster** |
| Reload next day | 2-3s | **50ms** | **60x faster** |
| Offline | ❌ Fails | ✅ Works | Infinite |

---

## 🎨 User Experience Flow

### Optimal UX Pattern:
1. **Show cached data instantly** (IndexedDB)
2. **Display "Refreshing..." indicator** (subtle, non-blocking)
3. **Update in background** (fetch fresh data)
4. **Show "Updated" notification** (if data changed)

```javascript
// UI feedback pattern
const [isRefreshing, setIsRefreshing] = useState(false);

// Show cached data immediately
setAllTenders(cachedTenders);
setLoading(false);

// Background refresh
setIsRefreshing(true);
const fresh = await fetchFreshTenders();
setIsRefreshing(false);

// Notify if updated
if (hasChanges(cachedTenders, fresh)) {
  toast.info('📊 Tenders updated with latest data');
}
```

---

## 🛡️ Graceful Degradation Chain

```
1. Memory Cache (instant)
   ↓ fail
2. IndexedDB (10-50ms)
   ↓ fail
3. SessionStorage (instant)
   ↓ fail
4. Supabase Cache (50-200ms)
   ↓ fail
5. External API (2-3s)
   ↓ fail
6. Show error + offer offline mode
```

---

## 🚀 Implementation Priority

### High Priority (Implement First):
1. ✅ **IndexedDB integration** - Biggest impact on reload speed
2. ✅ **Stale-while-revalidate pattern** - Best UX
3. ✅ **AI analysis caching** - Avoid redundant OpenAI calls

### Medium Priority:
4. ⏳ **Supabase cache table** - Cross-device sync
5. ⏳ **Service Worker caching** - Offline support

### Low Priority:
6. ⏸️ **Redis/Vercel KV** - For server-side caching
7. ⏸️ **GraphQL with Apollo Client** - Advanced caching

---

## 📦 Required Packages

```bash
npm install idb              # IndexedDB wrapper (5KB)
npm install react-toastify   # User notifications (optional)
```

---

## 🔧 Quick Start

1. **Install packages:**
   ```bash
   npm install idb
   ```

2. **Create `src/utils/tenderCacheDB.js`** (see Phase 1 code above)

3. **Update SmartMatchedTenders.jsx** to use IndexedDB first

4. **Test:** Reload page multiple times - should be instant after first load!

---

## 📊 Monitoring

Add performance metrics:

```javascript
// Track cache hit rates
export const trackCachePerformance = () => {
  const metrics = {
    memoryHits: 0,
    idbHits: 0,
    sessionHits: 0,
    apiCalls: 0,
    avgLoadTime: 0
  };
  
  // Log to analytics
  console.table(metrics);
};
```

---

## 🎯 Success Metrics

- ✅ **Page reload < 100ms** (from IndexedDB)
- ✅ **API calls reduced by 80%** (cache hit rate)
- ✅ **Works offline** (cached data available)
- ✅ **AI keywords cached** (avoid duplicate OpenAI calls)
- ✅ **Cross-device sync** (optional with Supabase)

---

## 🔐 Security Considerations

1. **User-specific caching** - Don't share cache between users
2. **Encrypt sensitive data** - Use Web Crypto API if needed
3. **Cache invalidation** - Clear on logout
4. **Size limits** - Monitor IndexedDB size (50MB soft limit)

```javascript
// Clear cache on logout
export const clearAllCaches = async () => {
  await deleteDB(DB_NAME);
  sessionStorage.clear();
  console.log('🗑️ All caches cleared');
};
```

---

**RECOMMENDATION:** Start with Phase 1 (IndexedDB). It's the biggest win with minimal complexity. Add Supabase cache table later if you need cross-device sync.
