import axios from 'axios';
import { mockTenders } from './mockData';

// API base URL - use environment variable, empty string for production (relative paths), or default to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL !== undefined 
  ? import.meta.env.VITE_API_BASE_URL 
  : (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Use mock data for demo purposes when API is unavailable
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Fetch tenders from the National Treasury eTenders OCDS Releases API
 * @param {Object} params - Query parameters
 * @param {number} params.page - Page number
 * @param {number} params.limit - Items per page
 * @param {string} params.search - Search query
 * @param {string} params.dateFrom - Start date (YYYY-MM-DD)
 * @param {string} params.dateTo - End date (YYYY-MM-DD)
 * @param {AbortSignal} params.signal - AbortController signal
 * @returns {Promise<Object>} Tenders data
 */
export const fetchTenders = async ({ 
  page = 1, 
  limit = 250, 
  search = '', 
  dateFrom = '', 
  dateTo = '',
  signal = null 
} = {}) => {
  // Return mock data if enabled
  if (USE_MOCK_DATA) {
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    
    let filteredTenders = mockTenders;
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filteredTenders = mockTenders.filter(tender => {
        const title = tender.tender?.title?.toLowerCase() || '';
        const description = tender.tender?.description?.toLowerCase() || '';
        const buyer = tender.buyer?.name?.toLowerCase() || '';
        return title.includes(searchLower) || 
               description.includes(searchLower) || 
               buyer.includes(searchLower);
      });
    }
    
    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedTenders = filteredTenders.slice(startIndex, endIndex);
    
    return {
      results: paginatedTenders,
      total: filteredTenders.length,
      page,
      limit
    };
  }
  
  try {
    const params = { page, limit };
    if (search) {
      params.search = search;
    }
    if (dateFrom) {
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      params.dateTo = dateTo;
    }
    
    const config = { params };
    if (signal) {
      config.signal = signal;
    }
    
    const response = await axios.get(`${API_BASE_URL}/api/tenders`, config);
    return response.data;
  } catch (error) {
    // Re-throw abort errors
    if (axios.isCancel(error) || error.name === 'AbortError') {
      const abortError = new Error('Request canceled');
      abortError.name = 'AbortError';
      throw abortError;
    }
    
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
 * Extract all tender documents from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {Array} Array of document objects with title, url, and type
 */
export const getTenderDocuments = (release) => {
  try {
    // Try to find tender documents in various possible locations
    const documents = release?.tender?.documents || 
                     release?.releases?.[0]?.tender?.documents ||
                     [];
    
    // Map documents to a cleaner format
    return documents
      .filter(doc => doc.url) // Only include documents with URLs
      .map(doc => ({
        id: doc.id || Math.random().toString(36).substr(2, 9),
        title: doc.title || doc.description || 'Tender Document',
        url: doc.url,
        type: doc.documentType || 'unknown',
        format: doc.format || 'pdf',
        language: doc.language || 'en'
      }));
  } catch (error) {
    console.error('Error extracting documents:', error);
    return [];
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
  } catch {
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
