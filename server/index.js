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

// Proxy endpoint for OCDS Releases API
// Tries progressively shorter date windows when the gov server times out.
// Returns plain JSON — SSE was removed because the API is too unreliable
// for streaming (frequent 500s make the stream hang before any data arrives).
app.get('/api/tenders', async (req, res) => {
  const { search = '', dateFrom = '', dateTo = '' } = req.query;

  try {
    const baseUrl = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';

    const toDate = (dateStr) => {
      if (!dateStr) return null;
      // Strip any time component — API accepts plain YYYY-MM-DD (confirmed via Postman)
      return dateStr.split('T')[0];
    };

    const today = new Date();
    const resolvedDateTo = toDate(dateTo) || today.toISOString().split('T')[0];
    const requestedFrom  = toDate(dateFrom) || null;

    // Start with the narrowest window (today only = fastest response),
    // then widen progressively if the gov IIS server times out or 500s.
    // Postman confirmed a 2-day window took ~1m 42s; 1-day should be ~30-60s.
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    };

    const candidates = requestedFrom
      // Caller supplied explicit dates — honour them, then fall back narrower
      ? [
          { from: requestedFrom,  label: null },
          { from: daysAgo(1),     label: 'today + yesterday (2 days)' },
          { from: daysAgo(3),     label: 'last 3 days' },
          { from: daysAgo(7),     label: 'last 7 days' },
        ]
      // No dates supplied — start from today (1 day) for fastest first paint
      : [
          { from: resolvedDateTo, label: null },              // today only (~1 day)
          { from: daysAgo(1),     label: 'last 2 days' },
          { from: daysAgo(3),     label: 'last 3 days' },
          { from: daysAgo(7),     label: 'last 7 days' },
        ];

    let apiResponse = null;
    let usedDateFrom = null;

    for (const { from: candidateFrom, label } of candidates) {
      if (label) {
        console.warn(`⚠️ Gov server slower than usual — retrying with ${label}...`);
      }

      try {
        apiResponse = await axios.get(baseUrl, {
          params: {
            PageNumber: 1,
            PageSize:   50,
            dateFrom:   candidateFrom,
            dateTo:     resolvedDateTo,
          },
          timeout: 120000, // 2 min — Postman confirmed API can take ~1m 42s
          headers: { Accept: 'application/json' },
        });

        if (apiResponse.status === 200) {
          usedDateFrom = candidateFrom;
          console.log(`✅ API 200 — dateFrom=${candidateFrom}, releases=${apiResponse.data?.releases?.length ?? 0}`);
          break;
        }
      } catch (err) {
        const status = err.response?.status;
        console.warn(`⚠️ API ${status || err.code} for dateFrom=${candidateFrom}`);
        if (!err.response || status === 500 || status === 502 || status === 503) continue;
        throw err; // non-retryable (400, 401, etc.)
      }
    }

    if (!apiResponse || apiResponse.status !== 200) {
      return res.status(503).json({
        error: 'eTenders API unavailable',
        message: 'The eTenders portal is currently experiencing technical difficulties.',
      });
    }

    const releases = apiResponse.data?.releases || [];

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

    res.json({
      results:  filtered,
      total:    filtered.length,
      dateFrom: usedDateFrom,
      dateTo:   resolvedDateTo,
    });

  } catch (error) {
    console.error('Error fetching tenders:', error.message);
    res.status(error.response?.status || 500).json({
      error:   'Failed to fetch tenders',
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
