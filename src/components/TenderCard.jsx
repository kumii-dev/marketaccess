import React, { useState } from 'react';
import { 
  getTenderTitle, 
  getTenderDescription, 
  getTenderDocuments,
  formatDate 
} from '../lib/api';
import TenderDetailsModal from './TenderDetailsModal';
import './TenderCard.css';

const TenderCard = ({ tender }) => {
  const [showDocuments, setShowDocuments] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  
  const title = getTenderTitle(tender);
  const description = getTenderDescription(tender);
  const documents = getTenderDocuments(tender);
  
  // Extract dates
  const tenderPeriod = tender?.tender?.tenderPeriod;
  const startDate = tenderPeriod?.startDate;
  const endDate = tenderPeriod?.endDate;
  
  // Extract buyer information
  const buyer = tender?.buyer?.name || 'Unknown Buyer';
  
  // Extract OCID
  const ocid = tender?.ocid || 'N/A';
  
  // Extract category
  const category = tender?.tender?.mainProcurementCategory || tender?.tender?.category || 'General';
  
  // Extract briefing session information
  const briefingSession = tender?.tender?.briefingSession;

  const handleDownloadDocument = (url) => {
    if (!url) {
      console.error('No URL provided for document download');
      alert('Document URL is missing');
      return;
    }

    console.log('Opening document:', url);
    
    // Check if we're in an iframe
    const isInIframe = window.self !== window.top;
    
    if (isInIframe) {
      // In iframe: send message to parent window to open the document
      try {
        window.parent.postMessage({
          type: 'OPEN_DOCUMENT',
          url: url
        }, '*');
        console.log('Posted message to parent window:', url);
      } catch (error) {
        console.error('Failed to post message to parent:', error);
        // Fallback: try to open directly
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else {
      // Not in iframe: open in new tab
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleDownloadAll = () => {
    if (documents.length === 0) {
      alert('No documents available for this tender');
      return;
    }
    
    console.log(`Downloading ${documents.length} documents...`);
    
    // Open all documents in new tabs with a slight delay to prevent popup blocking
    documents.forEach((doc, index) => {
      setTimeout(() => {
        console.log(`Opening document ${index + 1}:`, doc.title, doc.url);
        handleDownloadDocument(doc.url);
      }, index * 300); // 300ms delay between each document
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
        <div className="tender-title-row">
          <h3 className="tender-title">{title}</h3>
          <span className="tender-category-badge">{category}</span>
        </div>
      </div>
      
      <div className="tender-card-body">
        <div className="tender-info-row">
          <span className="info-label">Organ Of State:</span>
          <span className="info-value">{buyer}</span>
        </div>
        
        {briefingSession?.isSession && (
          <>
            <div className="tender-info-row">
              <span className="info-label">Briefing Session:</span>
              <span className="info-value">
                {briefingSession.compulsory ? 'Compulsory' : 'Optional'}
              </span>
            </div>
            
            {briefingSession.date && (
              <div className="tender-info-row">
                <span className="info-label">Session Date:</span>
                <span className="info-value">{formatDate(briefingSession.date)}</span>
              </div>
            )}
            
            {briefingSession.venue && (
              <div className="tender-info-row">
                <span className="info-label">Venue:</span>
                <span className="info-value">{briefingSession.venue}</span>
              </div>
            )}
          </>
        )}
        
        {startDate && (
          <div className="tender-info-row">
            <span className="info-label">Published Date:</span>
            <span className="info-value">{formatDate(startDate)}</span>
          </div>
        )}
        
        {endDate && (
          <div className="tender-info-row">
            <span className="info-label">Closing Date:</span>
            <span className="info-value">{formatDate(endDate)}</span>
          </div>
        )}
        
        <div className="tender-description">
          <p>{description}</p>
        </div>
      </div>
      
      <div className="tender-card-footer">
        <button 
          className="view-details-btn"
          onClick={() => setIsDetailsOpen(true)}
        >
          <i className="bi bi-info-circle"></i>
          View Details
        </button>
        
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
                    <div className="document-info">
                      <span className="document-title">{doc.title}</span>
                      {doc.source && (
                        <span className="document-source">{doc.source}</span>
                      )}
                    </div>
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
      
      <TenderDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        tender={tender}
      />
    </div>
  );
};

export default TenderCard;
