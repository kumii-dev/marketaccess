/**
 * Tender Document Fetcher
 * Securely fetches and extracts text from PDF/DOCX/HTML tender documents
 *
 * 🔒 SECURITY:
 * - Domain allowlist — only SA government eTender portals
 * - 10 MB file size cap
 * - 12,000 character output cap (fits GPT-4o-mini context)
 * - No user-supplied arbitrary URLs
 */

import express from 'express';
import axios from 'axios';
// pdf-parse v2 uses a class-based API — import the named export (no default in v2)
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const router = express.Router();

// ── Allowed domains (SA government tender portals only) ───────────
const ALLOWED_DOMAINS = [
  'etenders.gov.za',
  'treasury.gov.za',
  'publicworks.gov.za',
  'dpme.gov.za',
  'sita.co.za',
  'gov.za',
  'gpg.gov.za',
  'westerncape.gov.za',
  'kznonline.gov.za',
  'gauteng.gov.za',
  'limpopo.gov.za',
  'mpumalanga.gov.za',
  'fs.gov.za',
  'northern-cape.gov.za',
  'nwpg.gov.za',
  'ecprov.gov.za',
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS = 12000;

function isDomainAllowed(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch (_urlErr) { return false; } // invalid URL — not allowed
}

function getExtension(url, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('wordprocessingml') || ct.includes('docx')) return 'docx';
  if (ct.includes('msword')) return 'doc';
  if (ct.includes('html')) return 'html';
  // Fall back to URL extension
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.pdf')) return 'pdf';
    if (pathname.endsWith('.docx')) return 'docx';
    if (pathname.endsWith('.doc')) return 'doc';
    if (pathname.endsWith('.html') || pathname.endsWith('.htm')) return 'html';
  } catch (_urlParseErr) {}
  return 'unknown';
}

async function extractText(buffer, ext) {
  if (ext === 'pdf') {
    try {
      // pdf-parse v2: class-based API — pass buffer as Uint8Array via pdfjs-dist options
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      // getText() may return a string directly or an object with a .text property
      return typeof result === 'string' ? result : (result?.text || '');
    } catch (pdfErr) {
      console.warn('[tenderDocs] pdf-parse failed:', pdfErr.message);
      return '';
    }
  }
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (ext === 'html' || ext === 'unknown') {
    // Strip HTML tags for plain text
    const html = buffer.toString('utf-8');
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // For .doc (legacy) just try raw text
  return buffer.toString('utf-8', 0, Math.min(buffer.length, 50000)).replace(/[^\x20-\x7E\n\r\t]/g, ' ');
}

/**
 * POST /api/tenders/fetch-document
 * Body: { url: string }
 * Returns: { text, ext, charCount, truncated }
 */
router.post('/fetch-document', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  if (!isDomainAllowed(url)) {
    return res.status(403).json({ error: 'Domain not in allowlist', domain: (() => { try { return new URL(url).hostname; } catch { return url; } })() });
  }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_BYTES,
      timeout: 20000,
      headers: { 'User-Agent': 'MarketAccess-TenderBot/1.0 (kumii.africa)' }
    });

    const contentType = response.headers['content-type'] || '';
    const ext = getExtension(url, contentType);
    const buffer = Buffer.from(response.data);

    let text = '';
    try {
      text = await extractText(buffer, ext);
    } catch (parseErr) {
      console.warn(`⚠️ [tenderDocs] Could not parse ${ext} from ${url}:`, parseErr.message);
      text = '';
    }

    // Normalise whitespace
    text = text.replace(/\s+/g, ' ').trim();

    const truncated = text.length > MAX_CHARS;
    const excerpt = truncated ? text.slice(0, MAX_CHARS) : text;

    return res.json({ text: excerpt, ext, charCount: excerpt.length, truncated, originalLength: text.length });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({ error: `Remote returned ${err.response.status}`, url });
    }
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({ error: 'Document fetch timed out', url });
    }
    if (err.message.includes('maxContentLength')) {
      return res.status(413).json({ error: 'Document exceeds 10 MB limit', url });
    }
    console.error('[tenderDocs] fetch-document error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch document', detail: err.message });
  }
});

/**
 * POST /api/tenders/fetch-best-document
 * Body: { documents: [{ url, title, description }] }
 * Returns: same as fetch-document but picks the highest-priority doc
 *
 * Priority: PDF > DOCX > HTML. Prefers "specification", "bid", "rfq", "rfp", "scope" in title.
 */
router.post('/fetch-best-document', async (req, res) => {
  const { documents } = req.body || {};

  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: 'documents array is required' });
  }

  // Filter to allowed domains
  const allowed = documents.filter(d => d?.url && isDomainAllowed(d.url));
  if (allowed.length === 0) {
    return res.status(403).json({ error: 'No documents from allowed domains' });
  }

  // Score each document
  const PRIORITY_KEYWORDS = ['specification', 'scope', 'rfq', 'rfp', 'bid', 'terms', 'requirements', 'sitbd', 'sbd'];
  function scoreDoc(doc) {
    let score = 0;
    const title = (doc.title || '').toLowerCase();
    const url   = (doc.url || '').toLowerCase();
    if (url.endsWith('.pdf'))  score += 10;
    if (url.endsWith('.docx')) score += 7;
    if (url.endsWith('.doc'))  score += 5;
    if (url.endsWith('.html') || url.endsWith('.htm')) score += 2;
    for (const kw of PRIORITY_KEYWORDS) {
      if (title.includes(kw) || url.includes(kw)) { score += 5; break; }
    }
    return score;
  }

  const sorted = [...allowed].sort((a, b) => scoreDoc(b) - scoreDoc(a));

  // Try each in priority order until one succeeds
  for (const doc of sorted.slice(0, 3)) {
    if (!doc.url) continue;
    try {
      const response = await axios.get(doc.url, {
        responseType: 'arraybuffer',
        maxContentLength: MAX_BYTES,
        timeout: 20000,
        headers: { 'User-Agent': 'MarketAccess-TenderBot/1.0 (kumii.africa)' }
      });
      const contentType = response.headers['content-type'] || '';
      const ext = getExtension(doc.url, contentType);
      const buffer = Buffer.from(response.data);
      let text = '';
      try { text = await extractText(buffer, ext); } catch (_parseErr) { text = ''; }
      text = text.replace(/\s+/g, ' ').trim();
      const truncated = text.length > MAX_CHARS;
      const excerpt = truncated ? text.slice(0, MAX_CHARS) : text;
      if (excerpt.length < 50) continue; // too short — try next
      return res.json({ text: excerpt, ext, charCount: excerpt.length, truncated, originalLength: text.length, sourceUrl: doc.url, sourceTitle: doc.title });
    } catch (err) {
      console.warn(`[tenderDocs] fetch-best-document: skip ${doc.url} — ${err.message}`);
      continue;
    }
  }

  // All failed — return empty
  return res.json({ text: '', ext: null, charCount: 0, truncated: false, sourceUrl: null });
});

export default router;
