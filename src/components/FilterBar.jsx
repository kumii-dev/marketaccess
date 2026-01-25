import React, { useState } from 'react';
import './FilterBar.css';

const FilterBar = ({ onFilterChange, totalCount, isLoading }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onFilterChange({ search: searchTerm });
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    onFilterChange({ search: '' });
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar-header">
        <h2>Featured Opportunities</h2>
        {totalCount !== null && (
          <span className="tender-count">
            {isLoading ? 'Loading...' : `${totalCount} tender${totalCount !== 1 ? 's' : ''} found`}
          </span>
        )}
      </div>
      
      <form className="search-form" onSubmit={handleSearchSubmit}>
        <div className="search-input-group">
          <input
            type="text"
            className="search-input"
            placeholder="Search tenders by keyword..."
            value={searchTerm}
            onChange={handleSearchChange}
            disabled={isLoading}
          />
          {searchTerm && (
            <button
              type="button"
              className="clear-button"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
          <button 
            type="submit" 
            className="search-button"
            disabled={isLoading}
          >
            Search
          </button>
        </div>
      </form>
    </div>
  );
};

export default FilterBar;
