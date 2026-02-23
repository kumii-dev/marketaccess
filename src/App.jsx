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
import { getCachedTenders, cacheTenders } from './utils/tenderCache';
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
      // Check cache first
      const cachedData = getCachedTenders(from, to);
      if (cachedData && cachedData.length > 0) {
        console.log('📦 Using cached government tenders:', cachedData.length);
        setAllTenders(cachedData);
        setLoading(false);
        setLoadingProgress({ current: 100, total: 100, percentage: 100 });
        return;
      }

      console.log('🔄 Loading government tenders progressively...');

      // Phase 1: Load initial 10 tenders immediately
      const initialData = await fetchTenders({
        page: 1,
        limit: 10,
        dateFrom: from,
        dateTo: to,
        signal: abortController.signal
      });

      if (abortController.signal.aborted) return;

      let tendersData = [];
      if (initialData.results) {
        tendersData = initialData.results;
      } else if (initialData.data) {
        tendersData = initialData.data;
      } else if (Array.isArray(initialData)) {
        tendersData = initialData;
      }

      setAllTenders(tendersData);
      setLoading(false);
      setLoadingProgress({ current: 10, total: 100, percentage: 10 });
      setCurrentPage(1);

      console.log(`✅ Phase 1: Loaded ${tendersData.length} tenders (showing immediately)`);

      // Phase 2: Load remaining tenders in batches of 10
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
        const batchData = await fetchTenders({
          ...batch,
          dateFrom: from,
          dateTo: to,
          signal: abortController.signal
        });

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
      }

      // Phase 3: Cache the results
      setAllTenders(prev => {
        cacheTenders(prev, from, to);
        console.log('💾 Cached government tenders:', prev.length);
        return prev;
      });

      setIsLoadingMore(false);
      setLoadingProgress({ current: 100, total: 100, percentage: 100 });
      console.log('✅ All government tenders loaded successfully');

    } catch (err) {
      // Ignore abort errors
      if (err.name === 'AbortError' || err.message === 'canceled') {
        console.log('Request aborted');
        return;
      }

      console.error('Error loading tenders:', err);
      setError(err.message || 'Failed to load tenders. Please try again.');
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
  };

  const handleDateRangeChange = (newDateFrom, newDateTo) => {
    setDateFrom(newDateFrom);
    setDateTo(newDateTo);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRetry = () => {
    if (dateFrom && dateTo) {
      loadTenders(dateFrom, dateTo);
    }
  };

  const handleSectionChange = (section) => {
    setCurrentSection(section);
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
          <h1 style={{fontSize: '4rem', fontWeight: 700, lineHeight: '1.1'}} className="app-title">Access To Market</h1>

          <p style={{lineHeight: '1.5'}} className="app-description">
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
            <button className="header-btn header-btn-secondary" onClick={() => handleSectionChange('private-tenders')}>
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
