import { useState, useMemo, useEffect } from 'react';
import TenderCard from './TenderCard';
import FilterBar from './FilterBar';
import Pagination from './Pagination';
import AddTenderModal from './AddTenderModal';
import { 
  fetchPrivateTenders, 
  addPrivateTender, 
  deletePrivateTender,
  syncLocalStorageToSupabase 
} from '../lib/supabase';
import './PrivateTendersPage.css';

const PrivateTendersPage = () => {
  const [privateTenders, setPrivateTenders] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    province: '',
    category: '',
    status: '',
    closingBefore: '',
    sortBy: 'closing-soon'
  });

  const itemsPerPage = 250;

  // Load private tenders from Supabase on mount
  useEffect(() => {
    loadTenders();
  }, []);

  const loadTenders = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Try to sync any existing localStorage data first
      const localData = localStorage.getItem('privateTenders');
      if (localData) {
        try {
          const localTenders = JSON.parse(localData);
          await syncLocalStorageToSupabase(localTenders);
          console.log('Successfully synced localStorage data to Supabase');
        } catch (syncError) {
          console.warn('Could not sync localStorage data:', syncError);
        }
      }

      // Fetch from Supabase
      const tenders = await fetchPrivateTenders();
      setPrivateTenders(tenders);
      
      // Keep localStorage as backup
      localStorage.setItem('privateTenders', JSON.stringify(tenders));
    } catch (err) {
      console.error('Error loading tenders:', err);
      setError('Failed to load tenders. Please check your internet connection.');
      
      // Fallback to localStorage if Supabase fails
      const saved = localStorage.getItem('privateTenders');
      if (saved) {
        try {
          setPrivateTenders(JSON.parse(saved));
          console.log('Loaded tenders from localStorage backup');
        } catch (parseError) {
          console.error('Error parsing localStorage data:', parseError);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTender = async (newTender) => {
    try {
      setError(null);
      
      // Add to Supabase
      const createdTender = await addPrivateTender(newTender);
      
      // Update local state
      const updatedTenders = [createdTender, ...privateTenders];
      setPrivateTenders(updatedTenders);
      
      // Update localStorage backup
      localStorage.setItem('privateTenders', JSON.stringify(updatedTenders));
      
      setCurrentPage(1);
      
      // Show success message (optional)
      console.log('Tender added successfully to Supabase');
    } catch (err) {
      console.error('Error adding tender:', err);
      setError('Failed to add tender. Please try again.');
      
      // Fallback to localStorage only if Supabase fails
      const updatedTenders = [newTender, ...privateTenders];
      setPrivateTenders(updatedTenders);
      localStorage.setItem('privateTenders', JSON.stringify(updatedTenders));
      setCurrentPage(1);
    }
  };

  const handleDeleteTender = async (ocid) => {
    if (!window.confirm('Are you sure you want to delete this tender?')) {
      return;
    }

    try {
      setError(null);
      
      // Delete from Supabase
      await deletePrivateTender(ocid);
      
      // Update local state
      const updatedTenders = privateTenders.filter(t => t.ocid !== ocid);
      setPrivateTenders(updatedTenders);
      
      // Update localStorage backup
      localStorage.setItem('privateTenders', JSON.stringify(updatedTenders));
      
      console.log('Tender deleted successfully from Supabase');
    } catch (err) {
      console.error('Error deleting tender:', err);
      setError('Failed to delete tender. Please try again.');
      
      // Fallback: delete from localStorage anyway
      const updatedTenders = privateTenders.filter(t => t.ocid !== ocid);
      setPrivateTenders(updatedTenders);
      localStorage.setItem('privateTenders', JSON.stringify(updatedTenders));
    }
  };

  // Client-side filtering and sorting
  const filteredAndSortedTenders = useMemo(() => {
    let result = [...privateTenders];

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
          const aEnd = a.tender?.tenderPeriod?.endDate;
          const bEnd = b.tender?.tenderPeriod?.endDate;
          if (!aEnd && !bEnd) return 0;
          if (!aEnd) return 1;
          if (!bEnd) return -1;
          return new Date(aEnd) - new Date(bEnd);
        }
        case 'recently-added': {
          return new Date(b.date || 0) - new Date(a.date || 0);
        }
        case 'title-asc': {
          const aTitle = a.tender?.title || '';
          const bTitle = b.tender?.title || '';
          return aTitle.localeCompare(bTitle);
        }
        case 'title-desc': {
          const aTitle = a.tender?.title || '';
          const bTitle = b.tender?.title || '';
          return bTitle.localeCompare(aTitle);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [privateTenders, filters]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedTenders.length / itemsPerPage);
  const paginatedTenders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedTenders.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAndSortedTenders, currentPage, itemsPerPage]);

  const handleFilterChange = (newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="private-tenders-page">
      <header className="private-header">
        <div className="container">
          <div className="header-content">
            <div className="header-text">
              <h1 className="page-title">Private Tenders</h1>
              <p className="page-subtitle">
                Manage your organization's private tender opportunities. Add, track, and manage
                tenders that are not publicly available on government platforms.
              </p>
            </div>
            <button 
              className="add-tender-btn"
              onClick={() => setIsModalOpen(true)}
            >
              <i className="bi bi-plus-circle"></i>
              Add Tender
            </button>
          </div>
        </div>
      </header>

      <main className="private-main">
        <div className="container">
          {error && (
            <div className="error-banner" style={{
              padding: '1rem',
              marginBottom: '1rem',
              backgroundColor: '#fee',
              border: '1px solid #fcc',
              borderRadius: '8px',
              color: '#c33'
            }}>
              <i className="bi bi-exclamation-triangle"></i> {error}
              <button 
                onClick={() => loadTenders()}
                style={{
                  marginLeft: '1rem',
                  padding: '0.25rem 0.75rem',
                  backgroundColor: '#fff',
                  border: '1px solid #c33',
                  borderRadius: '4px',
                  color: '#c33',
                  cursor: 'pointer'
                }}
              >
                Retry
              </button>
            </div>
          )}
          
          <FilterBar
            onFilterChange={handleFilterChange}
            totalCount={privateTenders.length}
            visibleCount={filteredAndSortedTenders.length}
            isLoading={isLoading}
            tenders={privateTenders}
            hideDateRange={true}
          />

          {isLoading ? (
            <div className="loading-state" style={{ textAlign: 'center', padding: '3rem' }}>
              <div className="spinner" style={{
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #6B7C5D',
                borderRadius: '50%',
                width: '50px',
                height: '50px',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 1rem'
              }}></div>
              <p>Loading private tenders...</p>
            </div>
          ) : privateTenders.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-inbox"></i>
              <h2>No Private Tenders Yet</h2>
              <p>Start by adding your first private tender using the "Add Tender" button above.</p>
              <button 
                className="empty-state-btn"
                onClick={() => setIsModalOpen(true)}
              >
                <i className="bi bi-plus-circle"></i>
                Add Your First Tender
              </button>
            </div>
          ) : filteredAndSortedTenders.length === 0 ? (
            <div className="no-results">
              <p>No tenders found matching your filters. Try adjusting your search criteria.</p>
            </div>
          ) : (
            <>
              <div className="tender-grid">
                {paginatedTenders.map((tender) => (
                  <div key={tender.ocid} className="tender-card-wrapper">
                    <TenderCard tender={tender} />
                    <button
                      className="delete-tender-btn"
                      onClick={() => handleDeleteTender(tender.ocid)}
                      title="Delete tender"
                    >
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  isLoading={false}
                />
              )}
            </>
          )}
        </div>
      </main>

      <AddTenderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddTender={handleAddTender}
      />
    </div>
  );
};

export default PrivateTendersPage;
