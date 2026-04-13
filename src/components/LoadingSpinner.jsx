import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ statusMessage = 'Loading tenders...', subMessage = '' }) => {
  return (
    <div className="loading-container">
      <div className="spinner"></div>
      <p className="loading-text">{statusMessage}</p>
      {subMessage && <p className="loading-sub-text">{subMessage}</p>}
    </div>
  );
};

export default LoadingSpinner;

