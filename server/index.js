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
// retry status messages to the client in real time.
app.get('/api/tenders', async (req, res) => {
  const { page = 1, limit = 50, search = '', dateFrom = '', dateTo = '' } = req.query;

  // Hard-cap PageSize at 50 — the API's own documented example value.
  // Asking for more (e.g. 250) across a wide date range causes their IIS
  // server to time out internally and return 500.
  const pageSize = Math.min(parseInt(limit, 10) || 50, 50);

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

    const candidates = [
      { from: requestedFrom || fallbackWindows[0].from, label: null },
      ...fallbackWindows,
    ];

    send('status', { message: 'Connecting to eTenders portal...' });

    let apiResponse = null;
    let usedDateFrom = null;

    for (let i = 0; i < candidates.length; i++) {
      const { from: candidateFrom, label } = candidates[i];

      if (label) {
        const msg = `Gov server is slower than usual, retrying with ${label}...`;
        console.warn(`⚠️ ${msg}`);
        send('status', { message: msg });
      }

      const params = { PageNumber: page, PageSize: pageSize, dateFrom: candidateFrom, dateTo: resolvedDateTo };
      console.log('Fetching from API with params:', params);

      try {
        apiResponse = await axios.get(baseUrl, {
          params,
          timeout: 55000,
          headers: { 'Accept': 'application/json' },
        });

        if (apiResponse.status === 200) {
          usedDateFrom = candidateFrom;
          console.log(`✅ API responded 200 with dateFrom=${candidateFrom}`);
          break;
        }
      } catch (retryErr) {
        const status = retryErr.response?.status;
        console.warn(`⚠️ API returned ${status || retryErr.code} for dateFrom=${candidateFrom}`);
        if (!retryErr.response || status === 500 || status === 502 || status === 503) {
          continue;
        }
        throw retryErr;
      }
    }

    if (!apiResponse || apiResponse.status !== 200) {
      send('error', { message: 'The eTenders portal is currently experiencing difficulties. Please try again shortly.' });
      return res.end();
    }

    const data     = apiResponse.data;
    const releases = data.releases || [];

    let filteredReleases = releases;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredReleases = releases.filter(release => {
        const title           = release.tender?.title?.toLowerCase() || '';
        const description     = release.tender?.description?.toLowerCase() || '';
        const buyer           = release.buyer?.name?.toLowerCase() || '';
        const procuringEntity = release.tender?.procuringEntity?.name?.toLowerCase() || '';
        return title.includes(searchLower) || description.includes(searchLower) ||
               buyer.includes(searchLower) || procuringEntity.includes(searchLower);
      });
    }

    send('result', {
      results:       filteredReleases,
      total:         filteredReleases.length,
      totalReleases: releases.length,
      page:          parseInt(page),
      limit:         pageSize,
      dateFrom:      usedDateFrom || resolvedDateTo,
      dateTo:        resolvedDateTo,
    });

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
