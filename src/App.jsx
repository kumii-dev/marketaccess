import { useState, useEffect } from 'react';
import { fetchTenders } from './lib/api';
import TenderCard from './components/TenderCard';
import FilterBar from './components/FilterBar';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import Pagination from './components/Pagination';
import './App.css';

function App() {
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(null);
  const [filters, setFilters] = useState({
    search: ''
  });

  const itemsPerPage = 250; // Match the original spec - default PageSize to 250

  const loadTenders = async (page = 1, searchQuery = '') => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTenders({
        page,
        limit: itemsPerPage,
        search: searchQuery
      });

      // Handle different response structures
      let tendersData = [];
      let total = 0;

      if (data.results) {
        tendersData = data.results;
        total = data.total || data.count || tendersData.length;
      } else if (data.data) {
        tendersData = data.data;
        total = data.total || data.count || tendersData.length;
      } else if (Array.isArray(data)) {
        tendersData = data;
        total = data.length;
      } else {
        tendersData = [];
        total = 0;
      }

      setTenders(tendersData);
      setTotalCount(total);
      setTotalPages(Math.ceil(total / itemsPerPage) || 1);
      setCurrentPage(page);
    } catch (err) {
      console.error('Error loading tenders:', err);
      setError(err.message || 'Failed to load tenders. Please try again.');
      setTenders([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenders(1, '');
  }, []);

  const handleFilterChange = (newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    loadTenders(1, newFilters.search);
  };

  const handlePageChange = (page) => {
    loadTenders(page, filters.search);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRetry = () => {
    loadTenders(currentPage, filters.search);
  };

  return (
    <div className="app">
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
            totalCount={totalCount}
            isLoading={loading}
          />

          {loading && <LoadingSpinner />}

          {error && !loading && (
            <ErrorMessage message={error} onRetry={handleRetry} />
          )}

          {!loading && !error && tenders.length === 0 && (
            <div className="no-results">
              <p>No tenders found. Try adjusting your search criteria.</p>
            </div>
          )}

          {!loading && !error && tenders.length > 0 && (
            <>
              <div className="tender-grid">
                {tenders.map((tender, index) => (
                  <TenderCard key={tender.ocid || tender.id || index} tender={tender} />
                ))}
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                isLoading={loading}
              />
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
