import React, { useState, useEffect, useMemo } from 'react';
import './FilterBar.css';

const FilterBar = ({ 
  onFilterChange, 
  totalCount, 
  visibleCount,
  isLoading,
  tenders = [],
  dateFrom,
  dateTo,
  onDateRangeChange,
  hideDateRange = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [province, setProvince] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [closingBefore, setClosingBefore] = useState('');
  const [sortBy, setSortBy] = useState('closing-soon');
  const [debounceTimeout, setDebounceTimeout] = useState(null);

  // Predefined categories from public API
  const API_CATEGORIES = [
    "Accommodation",
    "Activities auxiliary to financial service and insurance activities.",
    "Activities of head offices; management consultancy activities",
    "Activities of households as employers of domestic personnel",
    "Administrative and support activities",
    "Advertising and market research",
    "Agricultural Products and Services",
    "Air transport",
    "Architectural and engineering activities; technical testing and analysis",
    "Arts, entertainment and recreation",
    "Civil engineering",
    "Computer programming, consultancy and related activities",
    "Construction",
    "Construction of buildings",
    "Creative, arts and entertainment activities",
    "Disposals: General",
    "Education",
    "Electricity, gas, steam and air conditioning",
    "Employment activities",
    "Financial and insurance activities",
    "Financial service activities, except insurance and pension funding",
    "Food and beverage service activities",
    "Human health activities",
    "Human health and social work activities",
    "Information and communication",
    "Information service activities",
    "Insurance, reinsurance and pension funding, except compulsory social security",
    "Land transport and transport via pipelines",
    "Legal and accounting activities",
    "Libraries, archives, museums and other cultural activities",
    "Manufacture of basic metals",
    "Manufacture of chemicals and chemical products",
    "Manufacture of coke and refined petroleum products",
    "Manufacture of computer, electronic and optical products",
    "Manufacture of electrical equipment",
    "Manufacture of fabricated metal products, except machinery and equipment",
    "Manufacture of furniture",
    "Manufacture of machinery and equipment n.e.c.",
    "Manufacture of motor vehicles, trailers and semi-trailers",
    "Manufacture of other non-metallic mineral products",
    "Manufacture of paper and paper products",
    "Manufacture of rubber and plastics products",
    "Manufacture of textiles",
    "Manufacturing",
    "Mining and quarrying",
    "Mining of coal and lignite",
    "Mining support service activities",
    "Motion picture, video and television programme production, sound recording and music publishing activities",
    "Office administrative, office support and other business support activities",
    "Other manufacturing",
    "Other personal service activities",
    "Other professional, scientific and technical activities",
    "Other service activities",
    "Postal and courier activities",
    "Printing and reproduction of recorded media",
    "Professional, scientific and technical activities",
    "Programming and broadcasting activities",
    "Publishing activities",
    "Real estate activities",
    "Remediation activities and other waste management services",
    "Rental and leasing activities",
    "Repair and installation of machinery and equipment",
    "Residential care activities",
    "Scientific research and development",
    "Security and investigation activities",
    "Services to buildings and landscape activities",
    "Services: Building",
    "Services: Civil",
    "Services: Electrical",
    "Services: Functional (Including Cleaning and Security Services)",
    "Services: General",
    "Services: Professional",
    "Sewerage",
    "Specialised construction activities",
    "Sports activities and amusement and recreation activities",
    "Supplies: Clothing/Textiles/Footwear",
    "Supplies: Computer Equipment",
    "Supplies: Electrical Equipment",
    "Supplies: General",
    "Supplies: Medical",
    "Supplies: Perishable Provisions",
    "Supplies: Stationery/Printing",
    "Telecommunications",
    "Transportation and storage",
    "Travel agency, tour operator, reservation service and related activities",
    "Warehousing and support activities for transportation",
    "Waste collection, treatment and disposal activities; materials recovery",
    "Water collection, treatment and supply",
    "Water supply; sewerage, waste management and remediation activities",
    "Water transport",
    "Wholesale and retail trade and repair of motor vehicles and motorcycles"
  ];

  // Extract unique values from tenders (provinces and statuses only, use predefined categories)
  const { provinces, statuses } = useMemo(() => {
    const provinceSet = new Set();
    const statusSet = new Set();

    tenders.forEach(tender => {
      const prov = tender?.tender?.province;
      const stat = tender?.tender?.status;

      if (prov) provinceSet.add(prov);
      if (stat) statusSet.add(stat);
    });

    return {
      provinces: Array.from(provinceSet).sort(),
      statuses: Array.from(statusSet).sort()
    };
  }, [tenders]);

  // Debounced search
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);

    // Clear existing timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    // Set new timeout for 250ms
    const timeout = setTimeout(() => {
      applyFilters({ search: value });
    }, 250);

    setDebounceTimeout(timeout);
  };

  // Apply all filters
  const applyFilters = (overrides = {}) => {
    const filters = {
      search: searchTerm,
      province,
      category,
      status,
      closingBefore,
      sortBy,
      ...overrides
    };
    onFilterChange(filters);
  };

  const handleProvinceChange = (e) => {
    const value = e.target.value;
    setProvince(value);
    applyFilters({ province: value });
  };

  const handleCategoryChange = (e) => {
    const value = e.target.value;
    setCategory(value);
    applyFilters({ category: value });
  };

  const handleStatusChange = (e) => {
    const value = e.target.value;
    setStatus(value);
    applyFilters({ status: value });
  };

  const handleClosingBeforeChange = (e) => {
    const value = e.target.value;
    setClosingBefore(value);
    applyFilters({ closingBefore: value });
  };

  const handleSortChange = (e) => {
    const value = e.target.value;
    setSortBy(value);
    applyFilters({ sortBy: value });
  };

  const handleReset = () => {
    setSearchTerm('');
    setProvince('');
    setCategory('');
    setStatus('');
    setClosingBefore('');
    setSortBy('closing-soon');
    onFilterChange({
      search: '',
      province: '',
      category: '',
      status: '',
      closingBefore: '',
      sortBy: 'closing-soon'
    });
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [debounceTimeout]);

  return (
    <div className="filter-bar">
      <div className="filter-bar-header">
        <h2>Featured Opportunities</h2>
        <div className="filter-bar-meta">
          {visibleCount !== undefined && totalCount !== null && (
            <span className="tender-count">
              {isLoading ? 'Loading...' : `${visibleCount} of ${totalCount} tenders`}
            </span>
          )}
        </div>
      </div>

      {/* Date Range Filters */}
      {!hideDateRange && (
        <div className="date-range-section">
          <div className="date-input-group">
            <label htmlFor="dateFrom">From:</label>
            <input
              id="dateFrom"
              type="date"
              className="date-input"
              value={dateFrom}
              onChange={(e) => onDateRangeChange(e.target.value, dateTo)}
              disabled={isLoading}
            />
          </div>
          <div className="date-input-group">
            <label htmlFor="dateTo">To:</label>
            <input
              id="dateTo"
              type="date"
              className="date-input"
              value={dateTo}
              onChange={(e) => onDateRangeChange(dateFrom, e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>
      )}
      
      {/* Search Input */}
      <div className="search-section">
        <div className="search-input-group">
          <input
            type="text"
            className="search-input"
            placeholder="Search by title, description, buyer, province, category..."
            value={searchTerm}
            onChange={handleSearchChange}
            disabled={isLoading}
          />
          {searchTerm && (
            <button
              type="button"
              className="clear-button"
              onClick={() => {
                setSearchTerm('');
                applyFilters({ search: '' });
              }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Dropdown Filters */}
      <div className="filters-grid">
        <div className="filter-group">
          <label htmlFor="province">Province:</label>
          <select
            id="province"
            className="filter-select"
            value={province}
            onChange={handleProvinceChange}
            disabled={isLoading}
          >
            <option value="">All Provinces</option>
            {provinces.map(prov => (
              <option key={prov} value={prov}>{prov}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="category">Category:</label>
          <select
            id="category"
            className="filter-select"
            value={category}
            onChange={handleCategoryChange}
            disabled={isLoading}
          >
            <option value="">All Categories</option>
            {API_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="status">Status:</label>
          <select
            id="status"
            className="filter-select"
            value={status}
            onChange={handleStatusChange}
            disabled={isLoading}
          >
            <option value="">All Statuses</option>
            {statuses.map(stat => (
              <option key={stat} value={stat}>{stat}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="closingBefore">Closing Before:</label>
          <input
            id="closingBefore"
            type="date"
            className="filter-input"
            value={closingBefore}
            onChange={handleClosingBeforeChange}
            disabled={isLoading}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="sortBy">Sort By:</label>
          <select
            id="sortBy"
            className="filter-select"
            value={sortBy}
            onChange={handleSortChange}
            disabled={isLoading}
          >
            <option value="closing-soon">Closing Soon</option>
            <option value="closing-late">Closing Date</option>
            <option value="title-asc">Title A-Z</option>
            <option value="title-desc">Title Z-A</option>
          </select>
        </div>

        <div className="filter-group">
          <button
            type="button"
            className="reset-button"
            onClick={handleReset}
            disabled={isLoading}
          >
            Reset Filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterBar;
