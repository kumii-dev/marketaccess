import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchTenders } from './lib/api';
import TenderCard from './components/TenderCard';
import FilterBar from './components/FilterBar';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import Pagination from './components/Pagination';
import Sidebar from './components/Sidebar';
import PrivateTendersPage from './components/PrivateTendersPage';
import './App.css';

function App() {
  const [allTenders, setAllTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentSection, setCurrentSection] = useState('government-tenders');
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

    try {
      const data = await fetchTenders({
        page: 1,
        limit: itemsPerPage,
        dateFrom: from,
        dateTo: to,
        signal: abortController.signal
      });

      // Check if request was aborted
      if (abortController.signal.aborted) {
        return;
      }

      // Handle different response structures
      let tendersData = [];

      if (data.results) {
        tendersData = data.results;
      } else if (data.data) {
        tendersData = data.data;
      } else if (Array.isArray(data)) {
        tendersData = data;
      }

      setAllTenders(tendersData);
      setCurrentPage(1); // Reset to page 1 when data changes
    } catch (err) {
      // Ignore abort errors
      if (err.name === 'AbortError' || err.message === 'canceled') {
        console.log('Request aborted');
        return;
      }

      console.error('Error loading tenders:', err);
      setError(err.message || 'Failed to load tenders. Please try again.');
      setAllTenders([]);
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
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
        <Sidebar 
          currentSection={currentSection} 
          onSectionChange={handleSectionChange}
        />
        <PrivateTendersPage />
      </div>
    );
  }

  // Default: Render Government Tenders page
  return (
    <div className="app">
      <Sidebar 
        currentSection={currentSection} 
        onSectionChange={handleSectionChange}
      />
      <header className="app-header">
        <div className="container">
          <h1 className="app-title">Access To Market</h1>
          <p className="app-subtitle">
            Connect with the right tenders, opportunities, and government contracts. 
            Get AI-powered recommendations based on your profile, capacity, and business needs.
          </p>
          <div className="header-actions">
            <button className="header-btn header-btn-primary" onClick={() => window.scrollTo({ top: 400, behavior: 'smooth' })}>
              <span>🔍</span> Browse Opportunities
            </button>
            <button className="header-btn header-btn-secondary">
              <span>📊</span> Dashboard
            </button>
            <button className="header-btn header-btn-secondary">
              <span>👤</span> My Profile
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
