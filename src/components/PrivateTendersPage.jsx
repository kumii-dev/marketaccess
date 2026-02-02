import { useState, useMemo } from 'react';
import TenderCard from './TenderCard';
import FilterBar from './FilterBar';
import Pagination from './Pagination';
import AddTenderModal from './AddTenderModal';
import './PrivateTendersPage.css';

const PrivateTendersPage = () => {
  const [privateTenders, setPrivateTenders] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    search: '',
    province: '',
    category: '',
    status: '',
    closingBefore: '',
    sortBy: 'closing-soon'
  });

  const itemsPerPage = 250;

  // Load private tenders from localStorage on mount
  useState(() => {
    const saved = localStorage.getItem('privateTenders');
    if (saved) {
      try {
        setPrivateTenders(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading private tenders:', error);
      }
    }
  });

  // Save to localStorage whenever tenders change
  const saveToLocalStorage = (tenders) => {
    try {
      localStorage.setItem('privateTenders', JSON.stringify(tenders));
    } catch (error) {
      console.error('Error saving private tenders:', error);
    }
  };

  const handleAddTender = (newTender) => {
    const updatedTenders = [newTender, ...privateTenders];
    setPrivateTenders(updatedTenders);
    saveToLocalStorage(updatedTenders);
    setCurrentPage(1);
  };

  const handleDeleteTender = (ocid) => {
    if (window.confirm('Are you sure you want to delete this tender?')) {
      const updatedTenders = privateTenders.filter(t => t.ocid !== ocid);
      setPrivateTenders(updatedTenders);
      saveToLocalStorage(updatedTenders);
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
          <FilterBar
            onFilterChange={handleFilterChange}
            totalCount={privateTenders.length}
            visibleCount={filteredAndSortedTenders.length}
            isLoading={false}
            tenders={privateTenders}
            hideDateRange={true}
          />

          {privateTenders.length === 0 ? (
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
