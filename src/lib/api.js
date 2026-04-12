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
 * The server streams SSE events:
 *   status  — retry / progress messages
 *   batch   — a page of results (called multiple times, 1 → up to 50)
 *   done    — stream complete
 *   error   — unrecoverable failure
 *
 * @param {Object}   params
 * @param {string}   params.search
 * @param {string}   params.dateFrom    - YYYY-MM-DD
 * @param {string}   params.dateTo      - YYYY-MM-DD
 * @param {AbortSignal} params.signal
 * @param {Function} params.onStatus    - (message: string) => void
 * @param {Function} params.onBatch     - (results: Release[], meta) => void
 *                                        Called on each batch so the UI can
 *                                        append rows incrementally.
 * @returns {Promise<{ results: Release[], total: number }>}
 */
export const fetchTenders = async ({
  search = '',
  dateFrom = '',
  dateTo = '',
  signal = null,
  onStatus = null,
  onBatch = null,
  // Legacy params (page, limit, offset) swallowed — server no longer uses them
  // eslint-disable-next-line no-unused-vars
  ...rest
} = {}) => {
  // ── Mock data shortcut ────────────────────────────────────────────────────
  if (USE_MOCK_DATA) {
    await new Promise(resolve => setTimeout(resolve, 500));
    let filtered = mockTenders;
    if (search) {
      const q = search.toLowerCase();
      filtered = mockTenders.filter(t =>
        t.tender?.title?.toLowerCase().includes(q) ||
        t.tender?.description?.toLowerCase().includes(q) ||
        t.buyer?.name?.toLowerCase().includes(q)
      );
    }
    const results = filtered.slice(0, 50);
    if (typeof onBatch === 'function') onBatch(results, { batchIndex: 0, isLast: true, totalSent: results.length });
    return { results, total: results.length };
  }

  // ── Build query string ────────────────────────────────────────────────────
  const qs = new URLSearchParams();
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
        const allResults = [];

        const processChunk = (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === 'status') {
                if (typeof onStatus === 'function') onStatus(event.message);

              } else if (event.type === 'batch') {
                // Accumulate and surface to the UI immediately
                allResults.push(...(event.results || []));
                if (typeof onBatch === 'function') {
                  onBatch(event.results || [], {
                    batchIndex: event.batchIndex,
                    totalSent:  event.totalSent,
                    isLast:     event.isLast,
                    dateFrom:   event.dateFrom,
                    dateTo:     event.dateTo,
                  });
                }
                // If this is the last batch, resolve now so callers that
                // await fetchTenders() also get the full result set.
                if (event.isLast) {
                  resolve({ results: allResults, total: allResults.length });
                }

              } else if (event.type === 'done') {
                // Safety-net resolve in case isLast was never set
                resolve({ results: allResults, total: allResults.length });

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
          if (buffer.trim()) processChunk('\n');
          // Final safety-net if stream ended without 'done'
          if (allResults.length > 0) {
            resolve({ results: allResults, total: allResults.length });
          }
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
