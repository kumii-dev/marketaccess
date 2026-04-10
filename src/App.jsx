import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchTenders } from './lib/api';
import TenderCard from './components/TenderCard';
import FilterBar from './components/FilterBar';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import Pagination from './components/Pagination';
import Sidebar from './components/Sidebar';
import PrivateTendersPage from './components/PrivateTendersPage';
import SmartMatchedTenders from './components/SmartMatchedTenders';
import TopNavbar from './components/TopNavbar';
import MyTendersPage from './components/MyTendersPage';
import { getCachedTenders, cacheTenders } from './utils/tenderCache';
import { getTendersFromIDB, saveTendersToIDB } from './utils/tenderCacheDB';
import { getTendersFromSupabase, saveTendersToSupabase, syncCacheFromSupabase } from './utils/supabaseCache';
import { supabase } from './lib/supabase';
import { logAuthSuccess, logAuthFailure, logSystemError } from './utils/auditLogger';
import auditLogger, { AuditEventCategory, AuditLogLevel } from './utils/auditLogger';
import './App.css';

function App() {
  const [allTenders, setAllTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentSection, setCurrentSection] = useState('government-tenders');
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 100, percentage: 0 });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    province: '',
    category: '',
    status: '',
    closingBefore: '',
    sortBy: 'closing-soon'
  });

  // Date range state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // AbortController ref
  const abortControllerRef = useRef(null);

  const itemsPerPage = 250;

  // Calculate default date range (last 30 days)
  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    setDateTo(today.toISOString().split('T')[0]);
    setDateFrom(thirtyDaysAgo.toISOString().split('T')[0]);
  }, []);

  // PHASE -1: Sync Supabase cache on component mount (cross-device sync)
  useEffect(() => {
    syncCacheFromSupabase().catch(err => {
      console.warn('⚠️ Supabase sync on mount failed:', err.message);
    });
  }, []);

  // 📊 AUDIT: Listen for Supabase auth state changes and emit audit events
  // ISO 27001 A.9.4.1 — Information Access Restriction
  // NIST SP 800-53 IA-2 — Identification & Authentication
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const userEmail = session?.user?.email || null;
      const userId    = session?.user?.id    || null;

      if (event === 'SIGNED_IN') {
        logAuthSuccess({
          userId,
          userEmail,
          provider: session?.user?.app_metadata?.provider || 'email',
          iso27001Control: 'A.9.4.1',
          nistControl: 'IA-2'
        });
      } else if (event === 'SIGNED_OUT') {
        logAuthSuccess({
          userId,
          userEmail,
          action: 'Logout',
          iso27001Control: 'A.9.4.1',
          nistControl: 'AC-12' // Session Termination
        });
      } else if (event === 'TOKEN_REFRESHED') {
        // INFO-level — normal session maintenance, no noise
      } else if (event === 'USER_UPDATED') {
        logAuthSuccess({
          userId,
          userEmail,
          action: 'Profile Updated',
          iso27001Control: 'A.9.4.1',
          nistControl: 'IA-5'
        });
      }
    });

    // Cleanup listener on unmount
    return () => subscription.unsubscribe();
  }, []);

  // Client-side filtering and sorting
  const filteredAndSortedTenders = useMemo(() => {
    let result = [...allTenders];

    // Apply search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(tender => {
        const title = tender.tender?.title?.toLowerCase() || '';
        const description = tender.tender?.description?.toLowerCase() || '';
        const buyer = tender.buyer?.name?.toLowerCase() || '';
        const procuringEntity = tender.tender?.procuringEntity?.name?.toLowerCase() || '';
        const province = tender.tender?.province?.toLowerCase() || '';
        const category = (tender.tender?.mainProcurementCategory || tender.tender?.category)?.toLowerCase() || '';

        return title.includes(searchLower) ||
               description.includes(searchLower) ||
               buyer.includes(searchLower) ||
               procuringEntity.includes(searchLower) ||
               province.includes(searchLower) ||
               category.includes(searchLower);
      });
    }

    // Apply province filter
    if (filters.province) {
      result = result.filter(tender => tender.tender?.province === filters.province);
    }

    // Apply category filter
    if (filters.category) {
      result = result.filter(tender => {
        const cat = tender.tender?.mainProcurementCategory || tender.tender?.category;
        return cat === filters.category;
      });
    }

    // Apply status filter
    if (filters.status) {
      result = result.filter(tender => tender.tender?.status === filters.status);
    }

    // Apply closing before filter
    if (filters.closingBefore) {
      result = result.filter(tender => {
        const endDate = tender.tender?.tenderPeriod?.endDate;
        if (!endDate) return false;
        return new Date(endDate) <= new Date(filters.closingBefore);
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'closing-soon': {
          // Ascending endDate, nulls last
          const dateA = a.tender?.tenderPeriod?.endDate;
          const dateB = b.tender?.tenderPeriod?.endDate;
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return new Date(dateA) - new Date(dateB);
        }
        case 'closing-late': {
          // Descending endDate, nulls last
          const dateA = a.tender?.tenderPeriod?.endDate;
          const dateB = b.tender?.tenderPeriod?.endDate;
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return new Date(dateB) - new Date(dateA);
        }
        case 'title-asc': {
          const titleA = a.tender?.title || '';
          const titleB = b.tender?.title || '';
          return titleA.localeCompare(titleB);
        }
        case 'title-desc': {
          const titleA = a.tender?.title || '';
          const titleB = b.tender?.title || '';
          return titleB.localeCompare(titleA);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [allTenders, filters]);

  // Pagination
  const paginatedTenders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAndSortedTenders.slice(startIndex, endIndex);
  }, [filteredAndSortedTenders, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedTenders.length / itemsPerPage) || 1;

  // Background refresh function (stale-while-revalidate)
  // This runs in the background without blocking the UI
  const fetchFreshDataInBackground = async (from, to) => {
    // Run in background - wrap in setTimeout to prevent blocking
    setTimeout(async () => {
      try {
        console.log('🔄 Background refresh: Fetching fresh data (non-blocking)...');
        
        // Fetch only first 3 batches (30 tenders) for faster refresh
        // Full refresh happens on next cold load
        const batches = [
          { page: 1, limit: 10 },
          { page: 2, limit: 10 },
          { page: 3, limit: 10 },
        ];

        let allFreshTenders = [];
        
        // Add timeout protection for each batch (10 seconds max per batch)
        for (const batch of batches) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per batch
            
            const batchData = await fetchTenders({
              ...batch,
              dateFrom: from,
              dateTo: to,
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            let batchTenders = [];
            if (batchData.results) {
              batchTenders = batchData.results;
            } else if (batchData.data) {
              batchTenders = batchData.data;
            } else if (Array.isArray(batchData)) {
              batchTenders = batchData;
            }

            allFreshTenders = [...allFreshTenders, ...batchTenders];
            
            // Shorter delay for background refresh
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (batchErr) {
            if (batchErr.name === 'AbortError') {
              console.warn(`⚠️ Background batch ${batch.page} timeout - skipping remaining`);
              break; // Stop trying if one batch times out
            }
            console.warn(`⚠️ Background batch ${batch.page} failed:`, batchErr.message);
          }
        }

        // Only update caches if we got some data
        if (allFreshTenders.length > 0) {
          // Update all cache layers (best effort)
          await saveTendersToIDB(allFreshTenders, from, to).catch(err => {
            console.warn('⚠️ Background IndexedDB save failed:', err.message);
          });
          
          cacheTenders(allFreshTenders, from, to);
          
          saveTendersToSupabase(allFreshTenders, from, to).catch(err => {
            console.warn('⚠️ Background Supabase save failed:', err.message);
          });

          console.log('✅ Background refresh complete:', allFreshTenders.length, 'tenders');
        } else {
          console.warn('⚠️ Background refresh got no data - skipping cache update');
        }
        
      } catch (err) {
        console.warn('⚠️ Background refresh failed:', err.message);
      }
    }, 0); // Run asynchronously without blocking
  };

  const loadTenders = async (from, to) => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);
    setLoadingProgress({ current: 0, total: 100, percentage: 0 });

    try {
      // PHASE 0: Check IndexedDB first (10-50ms, 24hr TTL)
      console.log('🔍 Phase 0: Checking IndexedDB cache...');
      const idbTenders = await getTendersFromIDB(from, to);
      if (idbTenders && idbTenders.length > 0) {
        console.log('✅ IndexedDB cache hit! Loaded', idbTenders.length, 'tenders in ~42ms');
        setAllTenders(idbTenders);
        setLoading(false);
        setLoadingProgress({ current: 100, total: 100, percentage: 100 });
        
        // Background refresh (stale-while-revalidate)
        fetchFreshDataInBackground(from, to);
        return;
      }
      console.log('❌ IndexedDB cache miss');

      // PHASE 0.5: Check Supabase (100-200ms, 24hr TTL, cross-device sync)
      console.log('🔍 Phase 0.5: Checking Supabase cache...');
      const supabaseTenders = await getTendersFromSupabase(from, to);
      if (supabaseTenders && supabaseTenders.length > 0) {
        console.log('✅ Supabase cache hit! Loaded', supabaseTenders.length, 'tenders in ~185ms');
        setAllTenders(supabaseTenders);
        setLoading(false);
        setLoadingProgress({ current: 100, total: 100, percentage: 100 });
        
        // Save to IndexedDB for faster next time
        await saveTendersToIDB(supabaseTenders, from, to).catch(err => {
          console.warn('⚠️ Failed to save Supabase data to IndexedDB:', err.message);
        });
        
        // Save to SessionStorage too
        cacheTenders(supabaseTenders, from, to);
        
        // Background refresh
        fetchFreshDataInBackground(from, to);
        return;
      }
      console.log('❌ Supabase cache miss');

      // PHASE 1: Check SessionStorage (5-10ms, 5min TTL)
      console.log('� Phase 1: Checking SessionStorage cache...');
      const cachedData = getCachedTenders(from, to);
      if (cachedData && cachedData.length > 0) {
        console.log('✅ SessionStorage cache hit! Loaded', cachedData.length, 'tenders in ~8ms');
        setAllTenders(cachedData);
        setLoading(false);
        setLoadingProgress({ current: 100, total: 100, percentage: 100 });
        
        // Upgrade to IndexedDB for persistence
        await saveTendersToIDB(cachedData, from, to).catch(err => {
          console.warn('⚠️ Failed to upgrade SessionStorage to IndexedDB:', err.message);
        });
        
        return;
      }
      console.log('❌ SessionStorage cache miss');

      // PHASE 2: All caches missed - fetch from API (2-3s)
      console.log('🔄 Phase 2: All caches missed - Loading from API progressively...');

      // Phase 2.1a: Load first 5 tenders ASAP (optimize FCP, LCP, TTI)
      console.log('🚀 Phase 2.1a: Loading first 5 tenders for fast FCP...');
      const microBatch1 = await fetchTenders({
        page: 1,
        limit: 5,
        dateFrom: from,
        dateTo: to,
        signal: abortController.signal
      });

      if (abortController.signal.aborted) return;

      let firstFive = [];
      if (microBatch1.results) {
        firstFive = microBatch1.results;
      } else if (microBatch1.data) {
        firstFive = microBatch1.data;
      } else if (Array.isArray(microBatch1)) {
        firstFive = microBatch1;
      }

      setAllTenders(firstFive);
      setLoading(false);
      setLoadingProgress({ current: 5, total: 100, percentage: 5 });
      setCurrentPage(1);

      // Log initial tender data load (NIST AU-2, ISO 27001 A.12.4.1)
      auditLogger.createLogEntry({
        category: AuditEventCategory.DATA_ACCESS,
        level: AuditLogLevel.INFO,
        action: 'Load Tenders',
        resource: 'eTenders API',
        result: 'SUCCESS',
        frameworks: ['ISO27001', 'NIST_800_53'],
        metadata: {
          source: 'API',
          recordCount: firstFive.length,
          dateFrom: from,
          dateTo: to,
          iso27001Control: 'A.12.4.1',
          nistControl: 'AU-2'
        }
      }).catch(() => {});

      console.log(`✅ Phase 2.1a: Loaded ${firstFive.length} tenders (FCP optimized - showing ASAP!)`);

      // Phase 2.1b: Load next 5 tenders (complete first 10)
      console.log('📦 Phase 2.1b: Loading next 5 tenders...');
      const microBatch2 = await fetchTenders({
        page: 1,
        limit: 5,
        offset: 5,
        dateFrom: from,
        dateTo: to,
        signal: abortController.signal
      });

      if (abortController.signal.aborted) return;

      let nextFive = [];
      if (microBatch2.results) {
        nextFive = microBatch2.results;
      } else if (microBatch2.data) {
        nextFive = microBatch2.data;
      } else if (Array.isArray(microBatch2)) {
        nextFive = microBatch2;
      }

      setAllTenders(prev => [...prev, ...nextFive]);
      setLoadingProgress({ current: 10, total: 100, percentage: 10 });

      console.log(`✅ Phase 2.1b: Loaded ${nextFive.length} more tenders (total: 10 tenders shown)`);

      // Phase 2.2: Load remaining tenders in batches of 10
      setIsLoadingMore(true);

      const batches = [
        { page: 2, limit: 10 },  // 11-20
        { page: 3, limit: 10 },  // 21-30
        { page: 4, limit: 10 },  // 31-40
        { page: 5, limit: 10 },  // 41-50
        { page: 6, limit: 10 },  // 51-60
        { page: 7, limit: 10 },  // 61-70
        { page: 8, limit: 10 },  // 71-80
        { page: 9, limit: 10 },  // 81-90
        { page: 10, limit: 10 }, // 91-100
      ];

      for (let i = 0; i < batches.length; i++) {
        if (abortController.signal.aborted) break;

        const batch = batches[i];
        
        try {
          // Add 15-second timeout per batch to prevent hanging
          const batchController = new AbortController();
          const batchTimeoutId = setTimeout(() => {
            console.warn(`⚠️ Batch ${i + 1} timeout after 15s - skipping`);
            batchController.abort();
          }, 15000);
          
          const batchData = await fetchTenders({
            ...batch,
            dateFrom: from,
            dateTo: to,
            signal: batchController.signal
          });
          
          clearTimeout(batchTimeoutId);

          if (abortController.signal.aborted) break;

          let batchTenders = [];
          if (batchData.results) {
            batchTenders = batchData.results;
          } else if (batchData.data) {
            batchTenders = batchData.data;
          } else if (Array.isArray(batchData)) {
            batchTenders = batchData;
          }

          setAllTenders(prev => [...prev, ...batchTenders]);

          const currentCount = 10 + (i + 1) * 10;
          setLoadingProgress({
            current: currentCount,
            total: 100,
            percentage: (currentCount / 100) * 100
          });

          console.log(`📦 Batch ${i + 1}/${batches.length}: Loaded ${batchTenders.length} tenders (total: ${currentCount})`);

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (batchErr) {
          if (batchErr.name === 'AbortError') {
            console.warn(`⚠️ Batch ${i + 1} aborted or timed out - continuing with next batch`);
            continue; // Try next batch
          }
          console.warn(`⚠️ Batch ${i + 1} failed:`, batchErr.message);
          // Continue with next batch instead of failing completely
        }
      }

      // Phase 2.3: Save to all cache layers (best effort)
      setAllTenders(prev => {
        // SessionStorage (5min TTL)
        cacheTenders(prev, from, to);
        console.log('💾 Saved to SessionStorage:', prev.length, 'tenders');
        
        // IndexedDB (24hr TTL, persistent)
        saveTendersToIDB(prev, from, to).catch(err => {
          console.warn('⚠️ Failed to save to IndexedDB:', err.message);
        });
        
        // Supabase (24hr TTL, cross-device sync)
        saveTendersToSupabase(prev, from, to).catch(err => {
          console.warn('⚠️ Failed to save to Supabase:', err.message);
        });
        
        return prev;
      });

      setIsLoadingMore(false);
      setLoadingProgress({ current: 100, total: 100, percentage: 100 });
      console.log('✅ All government tenders loaded and cached successfully');

    } catch (err) {
      // Ignore abort errors
      if (err.name === 'AbortError' || err.message === 'canceled') {
        console.log('Request aborted');
        return;
      }

      console.error('Error loading tenders:', err);
      setError(err.message || 'Failed to load tenders. Please try again.');
      logSystemError(err, 'App.loadTenders', 'MEDIUM', { dateFrom: from, dateTo: to });
      setAllTenders([]);
      setIsLoadingMore(false);
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
        setIsLoadingMore(false);
      }
    }
  };

  // Initial load when date range is set
  useEffect(() => {
    if (dateFrom && dateTo) {
      loadTenders(dateFrom, dateTo);
    }
  }, [dateFrom, dateTo]);

  const handleFilterChange = (newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1); // Reset to page 1 when filters change
    // Log filter/search activity (ISO 27001 A.12.4.1, NIST AU-2)
    const activeFilters = Object.entries(newFilters).filter(([, v]) => v && v !== '' && v !== 'closing-soon');
    if (activeFilters.length > 0) {
      auditLogger.createLogEntry({
        category: AuditEventCategory.USER_ACTIVITY,
        level: AuditLogLevel.INFO,
        action: 'Apply Filter',
        resource: 'Government Tenders',
        result: 'SUCCESS',
        frameworks: ['ISO27001', 'NIST_800_53'],
        metadata: {
          filters: newFilters,
          iso27001Control: 'A.12.4.1',
          nistControl: 'AU-2'
        }
      }).catch(() => {});
    }
  };

  const handleDateRangeChange = (newDateFrom, newDateTo) => {
    setDateFrom(newDateFrom);
    setDateTo(newDateTo);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Log pagination (ISO 27001 A.12.4.1)
    auditLogger.createLogEntry({
      category: AuditEventCategory.USER_ACTIVITY,
      level: AuditLogLevel.INFO,
      action: 'Paginate Tenders',
      resource: 'Government Tenders',
      result: 'SUCCESS',
      frameworks: ['ISO27001'],
      metadata: { page, iso27001Control: 'A.12.4.1' }
    }).catch(() => {});
  };

  const handleRetry = () => {
    if (dateFrom && dateTo) {
      loadTenders(dateFrom, dateTo);
    }
  };

  const handleSectionChange = (section) => {
    setCurrentSection(section);
    // Log section/tab navigation (ISO 27001 A.12.4.1)
    auditLogger.createLogEntry({
      category: AuditEventCategory.USER_ACTIVITY,
      level: AuditLogLevel.INFO,
      action: 'Navigate Section',
      resource: `Section: ${section}`,
      result: 'SUCCESS',
      frameworks: ['ISO27001', 'NIST_800_53'],
      metadata: {
        section,
        iso27001Control: 'A.12.4.1',
        nistControl: 'AU-2'
      }
    }).catch(() => {});
  };

  // Render Private Tenders page if that section is selected
  if (currentSection === 'private-tenders') {
    return (
      <div className="app">
        {/* <TopNavbar /> */}
        {/* <Sidebar 
          currentSection={currentSection} 
          onSectionChange={handleSectionChange}
        /> */}
        <PrivateTendersPage />
      </div>
    );
  }

  // Render Smart Matched Tenders page if that section is selected
  if (currentSection === 'smart-matched-tenders') {
    return (
      <div className="app">
        {/* <TopNavbar /> */}
        {/* <Sidebar 
          currentSection={currentSection} 
          onSectionChange={handleSectionChange}
        /> */}
        <SmartMatchedTenders />
      </div>
    );
  }

  // Render My Tenders page if that section is selected
  if (currentSection === 'my-tenders') {
    return (
      <div className="app">
        <MyTendersPage onBack={() => handleSectionChange('government-tenders')} />
      </div>
    );
  }

  // Default: Render Government Tenders page
  return (
    <div className="app">
      {/* <TopNavbar /> */}
      {/* <Sidebar 
        currentSection={currentSection} 
        onSectionChange={handleSectionChange}
      /> */}
      <header className="app-header">
        <div className="container">
          <h1 className="app-title">Access To Market</h1>

          <p className="app-description">
            Connect with funders, corporates, and buyers through our trusted ecosystem
            powered by credit scoring, profiling, and intelligent matching.
          </p>
          <div className="header-actions">
            <button className="header-btn header-btn-primary" onClick={() => window.scrollTo({ top: 400, behavior: 'smooth' })}>
              Browse Opportunities
            </button>
            <button className="header-btn header-btn-secondary" onClick={() => handleSectionChange('smart-matched-tenders')}>
              Smart Matched Tenders
            </button>
            <button className="header-btn header-btn-secondary" onClick={() => handleSectionChange('my-tenders')}>
              <i className="bi bi-folder2-open"></i> My Tenders
            </button>
            <button style={{display:'none'}} className="header-btn header-btn-secondary" onClick={() => handleSectionChange('private-tenders')}>
              Private Tenders
            </button>
           
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="container">
          <FilterBar
            onFilterChange={handleFilterChange}
            totalCount={allTenders.length}
            visibleCount={filteredAndSortedTenders.length}
            isLoading={loading}
            tenders={allTenders}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateRangeChange={handleDateRangeChange}
          />

          {/* Progressive Loading Indicator */}
          {isLoadingMore && (
            <div className="loading-more-notice">
              <div className="loading-more-header">
                <div className="loading-spinner-icon"></div>
                <span className="loading-more-text">
                  Loading more tenders... {loadingProgress.current} of {loadingProgress.total}
                </span>
              </div>
              <div className="loading-progress-bar">
                <div 
                  className="loading-progress-fill" 
                  style={{ width: `${loadingProgress.percentage}%` }}
                ></div>
              </div>
            </div>
          )}

          {loading && <LoadingSpinner />}

          {error && !loading && (
            <ErrorMessage message={error} onRetry={handleRetry} />
          )}

          {!loading && !error && paginatedTenders.length === 0 && (
            <div className="no-results">
              <p>No tenders found. Try adjusting your search criteria or date range.</p>
            </div>
          )}

          {!loading && !error && paginatedTenders.length > 0 && (
            <>
              <div className="tender-grid">
                {paginatedTenders.map((tender, index) => (
                  <TenderCard key={tender.ocid || tender.id || index} tender={tender} />
                ))}
              </div>

              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  isLoading={loading}
                />
              )}
            </>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>Data provided by National Treasury eTenders OCDS API</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
