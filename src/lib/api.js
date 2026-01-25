import axios from 'axios';

// API base URL - use environment variable or default to localhost
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Fetch tenders from the National Treasury eTenders OCDS Releases API
 * @param {Object} params - Query parameters
 * @param {number} params.page - Page number
 * @param {number} params.limit - Items per page
 * @param {string} params.search - Search query
 * @returns {Promise<Object>} Tenders data
 */
export const fetchTenders = async ({ page = 1, limit = 20, search = '' } = {}) => {
  try {
    const params = { page, limit };
    if (search) {
      params.search = search;
    }
    
    const response = await axios.get(`${API_BASE_URL}/api/tenders`, { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching tenders:', error);
    throw new Error(error.response?.data?.message || 'Failed to fetch tenders');
  }
};

/**
 * Extract tender document URL from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {string|null} Document URL or null
 */
export const getTenderDocumentUrl = (release) => {
  try {
    // Try to find tender documents in various possible locations
    const documents = release?.tender?.documents || 
                     release?.releases?.[0]?.tender?.documents ||
                     [];
    
    // Find the main tender document
    const tenderDoc = documents.find(doc => 
      doc.documentType === 'tenderNotice' || 
      doc.documentType === 'biddingDocuments'
    );
    
    return tenderDoc?.url || documents[0]?.url || null;
  } catch (error) {
    console.error('Error extracting document URL:', error);
    return null;
  }
};

/**
 * Format date to readable string
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-ZA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return dateString;
  }
};

/**
 * Extract tender title from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {string} Tender title
 */
export const getTenderTitle = (release) => {
  return release?.tender?.title || 
         release?.releases?.[0]?.tender?.title || 
         'Untitled Tender';
};

/**
 * Extract tender description from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {string} Tender description
 */
export const getTenderDescription = (release) => {
  return release?.tender?.description || 
         release?.releases?.[0]?.tender?.description || 
         'No description available';
};

/**
 * Extract tender value from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {Object|null} Value object with amount and currency
 */
export const getTenderValue = (release) => {
  const value = release?.tender?.value || 
                release?.releases?.[0]?.tender?.value || 
                null;
  
  return value;
};
