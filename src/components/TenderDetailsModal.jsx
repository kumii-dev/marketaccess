import { useState } from 'react';
import './TenderDetailsModal.css';

const TenderDetailsModal = ({ isOpen, onClose, tender }) => {
  const [activeTab, setActiveTab] = useState('overview');

  if (!isOpen || !tender) return null;

  const formatDate = (dateString) => {
    if (!dateString) return 'Not specified';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const formatCurrency = (amount, currency = 'ZAR') => {
    if (!amount) return 'Not specified';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const tenderData = tender.tender || {};
  const buyer = tender.buyer || tenderData.procuringEntity || {};
  const documents = tenderData.documents || [];
  const briefingSession = tenderData.briefingSession || {};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content tender-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{tenderData.title || 'Tender Details'}</h2>
          <button className="modal-close" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="modal-tabs">
          <button 
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <i className="bi bi-info-circle"></i> Overview
          </button>
          <button 
            className={`tab-btn ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            <i className="bi bi-list-ul"></i> Details
          </button>
          <button 
            className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            <i className="bi bi-file-earmark-text"></i> Documents ({documents.length})
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'overview' && (
            <div className="tab-content">
              <div className="details-section">
                <h3>Basic Information</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Reference Number:</span>
                    <span className="detail-value">{tender.ocid || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Status:</span>
                    <span className={`status-badge status-${tenderData.status}`}>
                      {tenderData.status || 'Unknown'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Category:</span>
                    <span className="detail-value">
                      {tenderData.mainProcurementCategory || tenderData.category || 'Not specified'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Province:</span>
                    <span className="detail-value">{tenderData.province || 'Not specified'}</span>
                  </div>
                </div>
              </div>

              <div className="details-section">
                <h3>Description</h3>
                <p className="tender-description">
                  {tenderData.description || 'No description available'}
                </p>
              </div>

              <div className="details-section">
                <h3>Timeline</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Opening Date:</span>
                    <span className="detail-value">
                      {formatDate(tenderData.tenderPeriod?.startDate)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Closing Date:</span>
                    <span className="detail-value">
                      {formatDate(tenderData.tenderPeriod?.endDate)}
                    </span>
                  </div>
                </div>
              </div>

              {tenderData.value && (
                <div className="details-section">
                  <h3>Value</h3>
                  <div className="details-grid">
                    <div className="detail-item">
                      <span className="detail-label">Estimated Value:</span>
                      <span className="detail-value value-highlight">
                        {formatCurrency(tenderData.value.amount, tenderData.value.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="details-section">
                <h3>Buyer Information</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Organization:</span>
                    <span className="detail-value">{buyer.name || 'Not specified'}</span>
                  </div>
                  {buyer.id && (
                    <div className="detail-item">
                      <span className="detail-label">Buyer ID:</span>
                      <span className="detail-value">{buyer.id}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'details' && (
            <div className="tab-content">
              <div className="details-section">
                <h3>Procurement Details</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Procurement Method:</span>
                    <span className="detail-value">
                      {tenderData.procurementMethod || 'Not specified'}
                    </span>
                  </div>
                  {tenderData.procurementMethodDetails && (
                    <div className="detail-item full-width">
                      <span className="detail-label">Method Details:</span>
                      <span className="detail-value">
                        {tenderData.procurementMethodDetails}
                      </span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">Initiation Type:</span>
                    <span className="detail-value">
                      {tender.initiationType || 'Not specified'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Tender ID:</span>
                    <span className="detail-value">{tenderData.id || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {briefingSession && briefingSession.isSession && (
                <div className="details-section briefing-section">
                  <h3>
                    <i className="bi bi-calendar-event"></i> Briefing Session
                  </h3>
                  <div className="details-grid">
                    <div className="detail-item">
                      <span className="detail-label">Compulsory:</span>
                      <span className="detail-value">
                        {briefingSession.compulsory ? (
                          <span className="badge-required">Yes - Required</span>
                        ) : (
                          <span className="badge-optional">No - Optional</span>
                        )}
                      </span>
                    </div>
                    {briefingSession.date && (
                      <div className="detail-item">
                        <span className="detail-label">Date:</span>
                        <span className="detail-value">{formatDate(briefingSession.date)}</span>
                      </div>
                    )}
                    {briefingSession.venue && (
                      <div className="detail-item full-width">
                        <span className="detail-label">Venue:</span>
                        <span className="detail-value">{briefingSession.venue}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="details-section">
                <h3>Additional Information</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Published Date:</span>
                    <span className="detail-value">{formatDate(tender.date)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Tags:</span>
                    <span className="detail-value">
                      {tender.tag?.join(', ') || 'None'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="tab-content">
              <div className="details-section">
                <h3>Available Documents</h3>
                {documents.length > 0 ? (
                  <div className="documents-list">
                    {documents.map((doc, index) => (
                      <div key={doc.id || index} className="document-item">
                        <div className="document-icon">
                          <i className="bi bi-file-earmark-pdf"></i>
                        </div>
                        <div className="document-info">
                          <div className="document-title">{doc.title || `Document ${index + 1}`}</div>
                          {doc.documentType && (
                            <div className="document-type">{doc.documentType}</div>
                          )}
                          {doc.format && (
                            <div className="document-format">{doc.format}</div>
                          )}
                        </div>
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="document-download-btn"
                          onClick={(e) => {
                            e.preventDefault();
                            // Use same postMessage approach as TenderCard
                            const isInIframe = window.self !== window.top;
                            if (isInIframe) {
                              try {
                                window.parent.postMessage({
                                  type: 'OPEN_DOCUMENT',
                                  url: doc.url
                                }, '*');
                              } catch {
                                window.open(doc.url, '_blank', 'noopener,noreferrer');
                              }
                            } else {
                              window.open(doc.url, '_blank', 'noopener,noreferrer');
                            }
                          }}
                        >
                          <i className="bi bi-download"></i> Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-documents">
                    <i className="bi bi-file-earmark-x"></i>
                    <p>No documents available for this tender</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default TenderDetailsModal;
