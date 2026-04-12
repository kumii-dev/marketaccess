import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { 
  generalApiLimiter, 
  authLimiter, // TODO: Apply to /api/auth/* endpoints when implemented
  rateLimitCostEstimate 
} from './middleware/rateLimiters.js';
import aiRoutes from './routes/ai.js';
import auditRoutes from './routes/audit.js';
import auditAIRoutes from './routes/auditAI.js';
import tenderDocsRouter from './routes/tenderDocs.js';

const app = express();
const PORT = process.env.PORT || 3001;

// 🔒 SECURITY: Configure CORS (TODO: Whitelist specific origins in production)
app.use(cors({
  origin: '*', // ⚠️ WARNING: Allow all origins (change in production)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-API-Key', 'X-Application', 'X-Batch-Size'],
  credentials: false
}));

app.use(express.json({ limit: '1mb' })); // Audit batches can be ~100 entries

// 🔒 SECURITY: Apply general rate limiting to all API routes
app.use('/api/', generalApiLimiter);

// 🔒 SECURITY: Mount AI routes with specific rate limiters
app.use('/api/ai', aiRoutes);

// 🤖 AI AUDIT INTELLIGENCE: Threat summary, anomaly detection, compliance reports
app.use('/api/ai/audit', auditAIRoutes);

// 📄 TENDER DOCS: Server-side document fetch + text extraction
app.use('/api/tenders', tenderDocsRouter);

// 📊 AUDIT: Mount audit log receiver — ISO 27001, NIST SP 800-53, OWASP
app.use('/admin/audit-logs', auditRoutes);

// Print cost estimates on startup
console.log('\n🔒 Rate Limiting Enabled:');
console.log('   General API: 100 requests / 15 min');
console.log('   AI Endpoints: 120 calls / hour per user');
console.log('   Keyword Extraction: 50 calls / hour per user');
console.log('   Tender Analysis: 30 calls / hour per user');
console.log('   Authentication: 5 attempts / 15 min');
console.log('\n📊 Audit Logging Enabled:');
console.log('   Receiver: POST /admin/audit-logs');
console.log('   Health:   GET  /admin/audit-logs/health');
console.log('   Stats:    GET  /admin/audit-logs/stats');
console.log('\n🤖 AI Audit Intelligence Enabled:');
console.log('   Threat Summary:     POST /api/ai/audit/threat-summary');
console.log('   Anomaly Detection:  POST /api/ai/audit/anomaly-detect');
console.log('   Compliance Report:  POST /api/ai/audit/compliance-report');
rateLimitCostEstimate.printEstimate();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Proxy endpoint for OCDS Releases API — uses Server-Sent Events to stream
// results incrementally: fetches page 1 (1 release) → page 2 (2 releases) →
// ... → page 5 (10 releases), accumulating up to 50 releases total.
// Each successful page is sent to the client immediately as a 'batch' event
// so the UI can render results as they arrive.
app.get('/api/tenders', async (req, res) => {
  const { search = '', dateFrom = '', dateTo = '' } = req.query;

  // ── SSE setup ─────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  try {
    const baseUrl = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';

    const toDateTime = (dateStr, endOfDay = false) => {
      if (!dateStr) return null;
      if (dateStr.includes('T')) return dateStr;
      return endOfDay ? `${dateStr}T23:59:59` : `${dateStr}T00:00:00`;
    };

    const today = new Date();
    const resolvedDateTo = toDateTime(dateTo, true) || `${today.toISOString().split('T')[0]}T23:59:59`;
    const requestedFrom  = toDateTime(dateFrom) || null;

    // Fallback date windows — tried in order when the API returns 500
    const fallbackWindows = [
      [30, 'last 30 days'],
      [14, 'last 14 days'],
      [7,  'last 7 days'],
      [3,  'last 3 days'],
    ].map(([days, label]) => {
      const d = new Date(today);
      d.setDate(d.getDate() - days);
      return { from: `${d.toISOString().split('T')[0]}T00:00:00`, label };
    });

    // ── Step 1: Probe with 1 release to find a working date window ──────────
    // This is fast and tells us which window the API will accept before we
    // commit to fetching all 50 releases.
    send('status', { message: 'Connecting to eTenders portal...' });

    const dateCandidates = [
      { from: requestedFrom || fallbackWindows[0].from, label: null },
      ...fallbackWindows,
    ];

    let workingDateFrom = null;

    for (const { from: candidateFrom, label } of dateCandidates) {
      if (label) {
        const msg = `Gov server is slower than usual, retrying with ${label}...`;
        console.warn(`⚠️ ${msg}`);
        send('status', { message: msg });
      }

      try {
        const probe = await axios.get(baseUrl, {
          params: { PageNumber: 1, PageSize: 1, dateFrom: candidateFrom, dateTo: resolvedDateTo },
          timeout: 30000,
          headers: { Accept: 'application/json' },
        });
        if (probe.status === 200) {
          workingDateFrom = candidateFrom;
          console.log(`✅ Probe succeeded with dateFrom=${candidateFrom}`);
          break;
        }
      } catch (probeErr) {
        const status = probeErr.response?.status;
        console.warn(`⚠️ Probe returned ${status || probeErr.code} for dateFrom=${candidateFrom}`);
        if (!probeErr.response || status === 500 || status === 502 || status === 503) continue;
        throw probeErr;
      }
    }

    if (!workingDateFrom) {
      send('error', { message: 'The eTenders portal is currently experiencing difficulties. Please try again shortly.' });
      return res.end();
    }

    // ── Step 2: Fetch pages 1–5 (1, 2, 5, 10, 10 releases = 28 → up to 50) ─
    // Page sizes ramp up: start tiny so the first results appear almost
    // instantly, then grow to fill up to 50 total.
    const pages = [
      { pageNumber: 1, pageSize: 1  },   // release 1       — appears in ~500ms
      { pageNumber: 1, pageSize: 4  },   // releases 1-4    — overlap OK, dedup by ocid
      { pageNumber: 1, pageSize: 10 },   // releases 1-10
      { pageNumber: 2, pageSize: 10 },   // releases 11-20
      { pageNumber: 3, pageSize: 10 },   // releases 21-30
      { pageNumber: 4, pageSize: 10 },   // releases 31-40
      { pageNumber: 5, pageSize: 10 },   // releases 41-50
    ];

    const seenOcids   = new Set();
    let   totalSent   = 0;

    const applySearch = (releases) => {
      if (!search) return releases;
      const q = search.toLowerCase();
      return releases.filter(r =>
        r.tender?.title?.toLowerCase().includes(q) ||
        r.tender?.description?.toLowerCase().includes(q) ||
        r.buyer?.name?.toLowerCase().includes(q) ||
        r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
      );
    };

    for (let i = 0; i < pages.length; i++) {
      const { pageNumber, pageSize } = pages[i];

      send('status', { message: `Loading tenders… (${Math.min(totalSent + pageSize, 50)} of 50)` });

      try {
        const response = await axios.get(baseUrl, {
          params: {
            PageNumber: pageNumber,
            PageSize:   pageSize,
            dateFrom:   workingDateFrom,
            dateTo:     resolvedDateTo,
          },
          timeout: 30000,
          headers: { Accept: 'application/json' },
        });

        const releases = response.data?.releases || [];

        // Deduplicate by ocid across pages
        const fresh = releases.filter(r => {
          if (!r.ocid || seenOcids.has(r.ocid)) return false;
          seenOcids.add(r.ocid);
          return true;
        });

        const filtered = applySearch(fresh);
        totalSent += fresh.length;

        console.log(`📦 Page ${i + 1}/${pages.length} (PageNumber=${pageNumber}, PageSize=${pageSize}): ${fresh.length} new releases (total: ${totalSent})`);

        // Stream this batch to the client immediately
        send('batch', {
          results:    filtered,
          batchIndex: i,
          totalSent,
          isLast:     i === pages.length - 1,
          dateFrom:   workingDateFrom,
          dateTo:     resolvedDateTo,
        });

      } catch (pageErr) {
        // A mid-stream page failure is non-fatal — log and stop paging
        const status = pageErr.response?.status;
        console.warn(`⚠️ Page ${i + 1} failed (${status || pageErr.code}) — stopping at ${totalSent} releases`);
        send('status', { message: `Loaded ${totalSent} tenders (some pages unavailable).` });
        break;
      }
    }

    send('done', { totalSent });

  } catch (error) {
    console.error('Error fetching tenders:', error.message);
    send('error', { message: error.response?.data?.message || error.message || 'Failed to fetch tenders' });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
