import axios from 'axios';
import { mockTenders } from './mockData';
import fallbackSnapshot from '../etender/01112025.json';
import { saveDailySnapshot, getLatestDailySnapshot } from '../utils/etenderDailyCache';

// API base URL - use environment variable, empty string for production (relative paths), or default to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL !== undefined 
  ? import.meta.env.VITE_API_BASE_URL 
  : (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Use mock data for demo purposes when API is unavailable
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Fetch tenders from the National Treasury eTenders OCDS Releases API.
 *
 * @param {Object}      params
 * @param {string}      params.search
 * @param {string}      params.dateFrom   - YYYY-MM-DD
 * @param {string}      params.dateTo     - YYYY-MM-DD
 * @param {AbortSignal} params.signal
 * @returns {Promise<{ results: Release[], total: number }>}
 */
export const fetchTenders = async ({
  search   = '',
  dateFrom = '',
  dateTo   = '',
  signal   = null,
  /* eslint-disable no-unused-vars */
  onStatus, onBatch, page, limit, offset,
  /* eslint-enable no-unused-vars */
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
    return { results: filtered.slice(0, 50), total: filtered.length };
  }

  // ── Live API call ─────────────────────────────────────────────────────────
  try {
    const params = {};
    if (search)   params.search   = search;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo)   params.dateTo   = dateTo;

    const config = { params };
    if (signal) config.signal = signal;

    const response = await axios.get(`${API_BASE_URL}/api/tenders`, config);

    // After every successful live fetch, persist to daily cache (fire-and-forget)
    const liveData = response.data;
    if (Array.isArray(liveData?.results) && liveData.results.length > 0) {
      saveDailySnapshot(liveData.results).catch(() => null);
    }

    // Server already serves the static fallback with isFallback=true — pass it through
    return liveData; // { results, total, dateFrom, dateTo, isFallback?, fallbackMsg? }
  } catch (error) {
    if (axios.isCancel(error) || error.name === 'AbortError') {
      const e = new Error('Request canceled');
      e.name = 'AbortError';
      throw e;
    }

    const status = error.response?.status;
    const isServerError = !status || status >= 500;

    // ── Client-side fallback chain ────────────────────────────────────────────
    if (isServerError) {
      // 1️⃣ Try Supabase daily cache (shared, rolling 2-day window)
      // 2️⃣ Try localStorage daily cache (this device, rolling 2-day window)
      try {
        const cached = await getLatestDailySnapshot();
        if (cached && Array.isArray(cached.tenders) && cached.tenders.length > 0) {
          console.warn(
            `⚠️ [api.js] eTenders unavailable — using daily cache from ${cached.date} (${cached.source})`
          );
          const releases = cached.tenders;
          const filtered = search
            ? releases.filter(r => {
                const q = search.toLowerCase();
                return (
                  r.tender?.title?.toLowerCase().includes(q) ||
                  r.tender?.description?.toLowerCase().includes(q) ||
                  r.buyer?.name?.toLowerCase().includes(q) ||
                  r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
                );
              })
            : releases;
          return {
            results:     filtered,
            total:       filtered.length,
            isFallback:  true,
            fallbackMsg: `eTenders is currently unavailable. Showing cached tenders from ${cached.date}.`,
            fallbackSource: cached.source,
            fallbackDate:   cached.date,
          };
        }
      } catch (cacheErr) {
        console.warn('[api.js] Daily cache lookup failed:', cacheErr.message);
      }

      // 3️⃣ Last resort: bundled static 01112025.json snapshot
      console.warn('⚠️ [api.js] No daily cache available — using bundled static snapshot (01112025.json)');
      const releases = fallbackSnapshot.Releases || [];
      const filtered = search
        ? releases.filter(r => {
            const q = search.toLowerCase();
            return (
              r.tender?.title?.toLowerCase().includes(q) ||
              r.tender?.description?.toLowerCase().includes(q) ||
              r.buyer?.name?.toLowerCase().includes(q) ||
              r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
            );
          })
        : releases;
      return {
        results:        filtered,
        total:          filtered.length,
        isFallback:     true,
        fallbackMsg:    'eTenders is currently unavailable. Showing cached tenders.',
        fallbackSource: 'static',
        fallbackDate:   null,
      };
    }

    console.error('Error fetching tenders:', error);
    throw new Error(error.response?.data?.message || error.message || 'Failed to fetch tenders');
  }
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
