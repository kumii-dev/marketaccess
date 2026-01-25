import React from 'react';
import { 
  getTenderTitle, 
  getTenderDescription, 
  getTenderValue,
  getTenderDocumentUrl,
  formatDate 
} from '../lib/api';
import './TenderCard.css';

const TenderCard = ({ tender }) => {
  const title = getTenderTitle(tender);
  const description = getTenderDescription(tender);
  const value = getTenderValue(tender);
  const documentUrl = getTenderDocumentUrl(tender);
  
  // Extract dates
  const tenderPeriod = tender?.tender?.tenderPeriod || tender?.releases?.[0]?.tender?.tenderPeriod;
  const startDate = tenderPeriod?.startDate;
  const endDate = tenderPeriod?.endDate;
  
  // Extract buyer information
  const buyer = tender?.buyer?.name || 
                tender?.releases?.[0]?.buyer?.name || 
                'Unknown Buyer';
  
  // Extract OCID
  const ocid = tender?.ocid || tender?.releases?.[0]?.ocid || 'N/A';

  const handleApply = () => {
    if (documentUrl) {
      window.open(documentUrl, '_blank', 'noopener,noreferrer');
    } else {
      alert('Tender document URL not available');
    }
  };

  return (
    <div className="tender-card">
      <div className="tender-card-header">
        <div className="tender-badge-row">
          <span className="tender-badge">Tender</span>
          <span className="tender-ocid">{ocid}</span>
        </div>
        <h3 className="tender-title">{title}</h3>
      </div>
      
      <div className="tender-card-body">
        <div className="tender-info-row">
          <span className="info-label">Buyer:</span>
          <span className="info-value">{buyer}</span>
        </div>
        
        {value && (
          <div className="tender-info-row">
            <span className="info-label">Value:</span>
            <span className="info-value tender-value">
              {value.currency} {value.amount?.toLocaleString('en-ZA')}
            </span>
          </div>
        )}
        
        {startDate && (
          <div className="tender-info-row">
            <span className="info-label">Start Date:</span>
            <span className="info-value">{formatDate(startDate)}</span>
          </div>
        )}
        
        {endDate && (
          <div className="tender-info-row">
            <span className="info-label">End Date:</span>
            <span className="info-value">{formatDate(endDate)}</span>
          </div>
        )}
        
        <div className="tender-description">
          <p>{description}</p>
        </div>
      </div>
      
      <div className="tender-card-footer">
        <button 
          className="apply-button"
          onClick={handleApply}
          disabled={!documentUrl}
        >
          <span>💡</span>
          {documentUrl ? 'Apply Now' : 'No Document Available'}
        </button>
      </div>
    </div>
  );
};

export default TenderCard;
