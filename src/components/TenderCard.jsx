import React, { useState } from 'react';
import { 
  getTenderTitle, 
  getTenderDescription, 
  getTenderValue,
  getTenderDocuments,
  formatDate 
} from '../lib/api';
import './TenderCard.css';

const TenderCard = ({ tender }) => {
  const [showDocuments, setShowDocuments] = useState(false);
  
  const title = getTenderTitle(tender);
  const description = getTenderDescription(tender);
  const value = getTenderValue(tender);
  const documents = getTenderDocuments(tender);
  
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

  const handleDownloadDocument = (url) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownloadAll = () => {
    if (documents.length === 0) {
      alert('No documents available for this tender');
      return;
    }
    
    // Open all documents in new tabs with a slight delay to prevent popup blocking
    documents.forEach((doc, index) => {
      setTimeout(() => {
        window.open(doc.url, '_blank', 'noopener,noreferrer');
      }, index * 200); // 200ms delay between each document
    });
  };

  const hasDocuments = documents.length > 0;

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
        {hasDocuments ? (
          <>
            {documents.length === 1 ? (
              <button 
                className="apply-button"
                onClick={() => handleDownloadDocument(documents[0].url)}
              >
                <i className="bi bi-download"></i>
                Download Document
              </button>
            ) : (
              <div className="document-actions">
                <button 
                  className="apply-button"
                  onClick={handleDownloadAll}
                >
                  <i className="bi bi-download"></i>
                  Download All ({documents.length})
                </button>
                <button 
                  className="documents-toggle"
                  onClick={() => setShowDocuments(!showDocuments)}
                >
                  <i className={`bi bi-chevron-${showDocuments ? 'up' : 'down'}`}></i>
                  {showDocuments ? 'Hide' : 'Show'} Documents
                </button>
              </div>
            )}
            
            {showDocuments && documents.length > 1 && (
              <div className="documents-list">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    className="document-item"
                    onClick={() => handleDownloadDocument(doc.url)}
                  >
                    <i className="bi bi-file-earmark-text"></i>
                    <span className="document-title">{doc.title}</span>
                    <i className="bi bi-download"></i>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <button 
            className="apply-button"
            disabled
          >
            <i className="bi bi-x-circle"></i>
            No Documents Available
          </button>
        )}
      </div>
    </div>
  );
};

export default TenderCard;
