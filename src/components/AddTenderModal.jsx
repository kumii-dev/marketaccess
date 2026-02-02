import { useState } from 'react';
import './AddTenderModal.css';

const AddTenderModal = ({ isOpen, onClose, onAddTender }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    buyer: '',
    ocid: '',
    province: '',
    category: '',
    status: 'active',
    startDate: '',
    endDate: '',
    briefingSessionEnabled: false,
    briefingCompulsory: false,
    briefingDate: '',
    briefingVenue: '',
    documentTitle: '',
    documentUrl: '',
  });

  const [documents, setDocuments] = useState([]);
  const [errors, setErrors] = useState({});

  const provinces = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape'
  ];

  const categories = [
    'goods',
    'works',
    'services',
    'consultingServices'
  ];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const handleAddDocument = () => {
    if (!formData.documentTitle || !formData.documentUrl) {
      setErrors(prev => ({
        ...prev,
        document: 'Both document title and URL are required'
      }));
      return;
    }

    const newDocument = {
      id: `doc-${Date.now()}`,
      title: formData.documentTitle,
      url: formData.documentUrl,
      documentType: 'tenderNotice',
      format: 'application/pdf',
      source: 'Tender'
    };

    setDocuments(prev => [...prev, newDocument]);
    setFormData(prev => ({
      ...prev,
      documentTitle: '',
      documentUrl: ''
    }));
    setErrors(prev => ({ ...prev, document: null }));
  };

  const handleRemoveDocument = (docId) => {
    setDocuments(prev => prev.filter(doc => doc.id !== docId));
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }
    if (!formData.buyer.trim()) {
      newErrors.buyer = 'Buyer/Organization is required';
    }
    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required';
    }
    if (!formData.endDate) {
      newErrors.endDate = 'End date is required';
    }
    if (formData.startDate && formData.endDate && new Date(formData.endDate) < new Date(formData.startDate)) {
      newErrors.endDate = 'End date must be after start date';
    }
    if (formData.briefingSessionEnabled && formData.briefingDate && new Date(formData.briefingDate) < new Date()) {
      newErrors.briefingDate = 'Briefing date must be in the future';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Generate OCID if not provided using crypto.randomUUID for uniqueness
    const ocid = formData.ocid || `private-${crypto.randomUUID()}`;

    // Create tender object in the same format as API tenders
    const newTender = {
      ocid: ocid,
      id: ocid,
      date: new Date().toISOString(),
      tag: ['tender'],
      initiationType: 'tender',
      isPrivate: true, // Flag to identify private tenders
      tender: {
        id: ocid,
        title: formData.title,
        description: formData.description,
        status: formData.status,
        province: formData.province,
        mainProcurementCategory: formData.category,
        tenderPeriod: {
          startDate: formData.startDate,
          endDate: formData.endDate
        },
        documents: documents,
        ...(formData.briefingSessionEnabled && {
          briefingSession: {
            isSession: true,
            compulsory: formData.briefingCompulsory,
            date: formData.briefingDate,
            venue: formData.briefingVenue
          }
        }),
        procuringEntity: {
          name: formData.buyer
        }
      },
      buyer: {
        name: formData.buyer
      }
    };

    onAddTender(newTender);
    handleClose();
  };

  const handleClose = () => {
    setFormData({
      title: '',
      description: '',
      buyer: '',
      ocid: '',
      province: '',
      category: '',
      status: 'active',
      startDate: '',
      endDate: '',
      briefingSessionEnabled: false,
      briefingCompulsory: false,
      briefingDate: '',
      briefingVenue: '',
      documentTitle: '',
      documentUrl: '',
    });
    setDocuments([]);
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Private Tender</h2>
          <button className="modal-close" onClick={handleClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-section">
            <h3>Basic Information</h3>
            
            <div className="form-group">
              <label htmlFor="title">Tender Title *</label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                className={errors.title ? 'error' : ''}
                placeholder="Enter tender title"
              />
              {errors.title && <span className="error-message">{errors.title}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="description">Description *</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                className={errors.description ? 'error' : ''}
                placeholder="Enter tender description"
                rows="4"
              />
              {errors.description && <span className="error-message">{errors.description}</span>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="buyer">Buyer/Organization *</label>
                <input
                  type="text"
                  id="buyer"
                  name="buyer"
                  value={formData.buyer}
                  onChange={handleInputChange}
                  className={errors.buyer ? 'error' : ''}
                  placeholder="Enter buyer name"
                />
                {errors.buyer && <span className="error-message">{errors.buyer}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="ocid">Reference Number (Optional)</label>
                <input
                  type="text"
                  id="ocid"
                  name="ocid"
                  value={formData.ocid}
                  onChange={handleInputChange}
                  placeholder="Auto-generated if empty"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="province">Province</label>
                <select
                  id="province"
                  name="province"
                  value={formData.province}
                  onChange={handleInputChange}
                >
                  <option value="">Select Province</option>
                  {provinces.map(prov => (
                    <option key={prov} value={prov}>{prov}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="category">Category</label>
                <select
                  id="category"
                  name="category"
                  value={formData.category}
                  onChange={handleInputChange}
                >
                  <option value="">Select Category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="status">Status</label>
                <select
                  id="status"
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                >
                  <option value="active">Active</option>
                  <option value="complete">Complete</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Timeline</h3>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="startDate">Start Date *</label>
                <input
                  type="date"
                  id="startDate"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleInputChange}
                  className={errors.startDate ? 'error' : ''}
                />
                {errors.startDate && <span className="error-message">{errors.startDate}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="endDate">End Date *</label>
                <input
                  type="date"
                  id="endDate"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleInputChange}
                  className={errors.endDate ? 'error' : ''}
                />
                {errors.endDate && <span className="error-message">{errors.endDate}</span>}
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Briefing Session</h3>
            
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  name="briefingSessionEnabled"
                  checked={formData.briefingSessionEnabled}
                  onChange={handleInputChange}
                />
                <span>This tender has a briefing session</span>
              </label>
            </div>

            {formData.briefingSessionEnabled && (
              <>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      name="briefingCompulsory"
                      checked={formData.briefingCompulsory}
                      onChange={handleInputChange}
                    />
                    <span>Attendance is compulsory</span>
                  </label>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="briefingDate">Briefing Date</label>
                    <input
                      type="date"
                      id="briefingDate"
                      name="briefingDate"
                      value={formData.briefingDate}
                      onChange={handleInputChange}
                      className={errors.briefingDate ? 'error' : ''}
                    />
                    {errors.briefingDate && <span className="error-message">{errors.briefingDate}</span>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="briefingVenue">Venue</label>
                    <input
                      type="text"
                      id="briefingVenue"
                      name="briefingVenue"
                      value={formData.briefingVenue}
                      onChange={handleInputChange}
                      placeholder="Enter briefing venue"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="form-section">
            <h3>Documents</h3>
            
            <div className="document-input-group">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="documentTitle">Document Title</label>
                  <input
                    type="text"
                    id="documentTitle"
                    name="documentTitle"
                    value={formData.documentTitle}
                    onChange={handleInputChange}
                    placeholder="e.g., Tender Document"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="documentUrl">Document URL</label>
                  <input
                    type="url"
                    id="documentUrl"
                    name="documentUrl"
                    value={formData.documentUrl}
                    onChange={handleInputChange}
                    placeholder="https://..."
                  />
                </div>
              </div>
              
              <button
                type="button"
                className="add-document-btn"
                onClick={handleAddDocument}
              >
                <i className="bi bi-plus-circle"></i>
                Add Document
              </button>
              
              {errors.document && <span className="error-message">{errors.document}</span>}
            </div>

            {documents.length > 0 && (
              <div className="documents-list">
                <h4>Added Documents ({documents.length})</h4>
                {documents.map(doc => (
                  <div key={doc.id} className="document-item">
                    <i className="bi bi-file-earmark-text"></i>
                    <span className="document-title">{doc.title}</span>
                    <button
                      type="button"
                      className="remove-doc-btn"
                      onClick={() => handleRemoveDocument(doc.id)}
                    >
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              <i className="bi bi-plus-circle"></i>
              Add Tender
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddTenderModal;
