import { mockTenders } from './mockData';

// API base URL - use environment variable, empty string for production (relative paths), or default to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL !== undefined 
  ? import.meta.env.VITE_API_BASE_URL 
  : (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Use mock data for demo purposes when API is unavailable
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Fetch tenders from the National Treasury eTenders OCDS Releases API.
 *
 * The server streams Server-Sent Events so we can report real-time retry
 * status to the user ("Gov server is slower than usual, retrying with last
 * 30 days...") instead of showing a static spinner.
 *
 * @param {Object}   params
 * @param {number}   params.page
 * @param {number}   params.limit
 * @param {string}   params.search
 * @param {string}   params.dateFrom      - YYYY-MM-DD
 * @param {string}   params.dateTo        - YYYY-MM-DD
 * @param {AbortSignal} params.signal
 * @param {Function} params.onStatus      - Called with a status string on each
 *                                          retry so the UI can update in real time.
 * @returns {Promise<Object>} Tenders data ({ results, total, ... })
 */
export const fetchTenders = async ({
  page = 1,
  limit = 250,
  search = '',
  dateFrom = '',
  dateTo = '',
  signal = null,
  onStatus = null,
} = {}) => {
  // ── Mock data shortcut ────────────────────────────────────────────────────
  if (USE_MOCK_DATA) {
    await new Promise(resolve => setTimeout(resolve, 500));
    let filteredTenders = mockTenders;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredTenders = mockTenders.filter(tender => {
        const title       = tender.tender?.title?.toLowerCase() || '';
        const description = tender.tender?.description?.toLowerCase() || '';
        const buyer       = tender.buyer?.name?.toLowerCase() || '';
        return title.includes(searchLower) || description.includes(searchLower) || buyer.includes(searchLower);
      });
    }
    const startIndex = (page - 1) * limit;
    return { results: filteredTenders.slice(startIndex, startIndex + limit), total: filteredTenders.length, page, limit };
  }

  // ── Build query string ────────────────────────────────────────────────────
  const qs = new URLSearchParams({ page, limit });
  if (search)   qs.set('search',   search);
  if (dateFrom) qs.set('dateFrom', dateFrom);
  if (dateTo)   qs.set('dateTo',   dateTo);

  const url = `${API_BASE_URL}/api/tenders?${qs}`;

  // ── Stream SSE from server ────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    fetch(url, { signal: signal || undefined })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        const processChunk = (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6)); // strip "data: "
              if (event.type === 'status' && typeof onStatus === 'function') {
                onStatus(event.message);
              } else if (event.type === 'result') {
                resolve(event);
              } else if (event.type === 'error') {
                reject(new Error(event.message));
              }
            } catch {
              // ignore malformed SSE line
            }
          }
        };

        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            processChunk(decoder.decode(value, { stream: true }));
          }
          // flush any remaining buffer
          if (buffer.trim()) processChunk('\n');
        };

        await pump();
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          const abortError = new Error('Request canceled');
          abortError.name = 'AbortError';
          reject(abortError);
        } else {
          console.error('Error fetching tenders:', err);
          reject(new Error(err.message || 'Failed to fetch tenders'));
        }
      });
  });
};

/**
 * Extract tender document URL from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {string|null} Document URL or null
 */
export const getTenderDocumentUrl = (release) => {
  try {
    // The release parameter is already a single release object
    const documents = release?.tender?.documents || [];
    
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
    let allDocuments = [];
    
    // Helper function to add documents from an array
    const addDocuments = (docs, source = '') => {
      if (Array.isArray(docs)) {
        docs.forEach(doc => {
          if (doc.url) {
            allDocuments.push({
              id: doc.id || Math.random().toString(36).substr(2, 9),
              title: doc.title || doc.description || `${source} Document`,
              url: doc.url,
              type: doc.documentType || 'unknown',
              format: doc.format || 'pdf',
              language: doc.language || 'en',
              source: source // Add source to know where it came from
            });
          }
        });
      }
    };
    
    // The release parameter is already a single release object from the releases array
    // It has the structure: { ocid, tender, planning, contracts, awards, buyer, parties, etc. }
    
    // 1. Tender documents
    if (release?.tender?.documents) {
      addDocuments(release.tender.documents, 'Tender');
    }
    
    // 2. Planning documents
    if (release?.planning?.documents) {
      addDocuments(release.planning.documents, 'Planning');
    }
    
    // 3. Contract documents
    if (release?.contracts && Array.isArray(release.contracts)) {
      release.contracts.forEach((contract, index) => {
        // Contract documents
        if (contract.documents) {
          addDocuments(contract.documents, `Contract ${index + 1}`);
        }
        
        // Contract implementation documents
        if (contract.implementation?.documents) {
          addDocuments(contract.implementation.documents, `Implementation ${index + 1}`);
        }
      });
    }
    
    // 4. Awards documents (if they have any)
    if (release?.awards && Array.isArray(release.awards)) {
      release.awards.forEach((award, index) => {
        if (award.documents) {
          addDocuments(award.documents, `Award ${index + 1}`);
        }
      });
    }
    
    // Remove duplicates based on URL
    const uniqueDocuments = allDocuments.filter((doc, index, self) =>
      index === self.findIndex((d) => d.url === doc.url)
    );
    
    return uniqueDocuments;
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
  return release?.tender?.title || 'Untitled Tender';
};

/**
 * Extract tender description from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {string} Tender description
 */
export const getTenderDescription = (release) => {
  return release?.tender?.description || 'No description available';
};

/**
 * Extract tender value from OCDS release
 * @param {Object} release - OCDS release object
 * @returns {Object|null} Value object with amount and currency
 */
export const getTenderValue = (release) => {
  return release?.tender?.value || null;
};
