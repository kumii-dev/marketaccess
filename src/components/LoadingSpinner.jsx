import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ statusMessage = 'Loading tenders...' }) => {
  return (
    <div className="loading-container">
      <div className="spinner"></div>
      <p className="loading-text">{statusMessage}</p>
    </div>
  );
};

export default LoadingSpinner;
