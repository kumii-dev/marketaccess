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
app.get('/api/tenders', async (req, res) => {
  try {
    const { page = 1, limit = 250, search = '', dateFrom = '', dateTo = '' } = req.query;
    
    // National Treasury eTenders OCDS Releases API
    const baseUrl = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';
    
    // API requires full ISO 8601 datetime format (date-time), not just YYYY-MM-DD
    const toDateTime = (dateStr, endOfDay = false) => {
      if (!dateStr) return null;
      if (dateStr.includes('T')) return dateStr;
      return endOfDay ? `${dateStr}T23:59:59` : `${dateStr}T00:00:00`;
    };

    const today = new Date();

    // ── Retry strategy: if the API 500s on the requested window, shrink it ──
    // etenders.gov.za 500s when the result set is too large or their server
    // times out internally. We try progressively shorter windows until one works.
    const resolvedDateTo = toDateTime(dateTo, true) || `${today.toISOString().split('T')[0]}T23:59:59`;

    // Build candidate date windows: requested → last 90d → last 60d → last 45d → last 30d
    const requestedFrom = toDateTime(dateFrom) || null;
    const fallbackWindows = [90, 60, 45, 30].map(days => {
      const d = new Date(today);
      d.setDate(d.getDate() - days);
      return `${d.toISOString().split('T')[0]}T00:00:00`;
    });
    const candidateFroms = requestedFrom
      ? [requestedFrom, ...fallbackWindows]
      : fallbackWindows;

    let response = null;
    let _usedDateFrom = null;

    for (const candidateFrom of candidateFroms) {
      const params = {
        PageNumber: page,
        PageSize: limit,
        dateFrom: candidateFrom,
        dateTo: resolvedDateTo,
      };

      console.log('Fetching from API with params:', params);

      try {
        response = await axios.get(baseUrl, {
          params,
          timeout: 55000,
          headers: { 'Accept': 'application/json' },
        });

        if (response.status === 200) {
          _usedDateFrom = candidateFrom;
          console.log(`✅ API responded 200 with dateFrom=${candidateFrom}`);
          break;
        }
      } catch (retryErr) {
        const status = retryErr.response?.status;
        console.warn(`⚠️ API returned ${status || retryErr.code} for dateFrom=${candidateFrom} — retrying with smaller window...`);
        if (!retryErr.response || status === 500 || status === 502 || status === 503) {
          continue; // try next window
        }
        throw retryErr; // non-retryable error (e.g. 401, 400)
      }
    }

    if (!response || response.status !== 200) {
      return res.status(502).json({
        error: 'eTenders API unavailable',
        message: 'The eTenders portal is currently experiencing difficulties. Please try again shortly.',
      });
    }

    console.log('API Response status:', response.status);
    
    // The API returns a ReleasePackage with releases array
    const data = response.data;
    const releases = data.releases || [];
    
    // Filter by search on server side if provided
    let filteredReleases = releases;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredReleases = releases.filter(release => {
        const title = release.tender?.title?.toLowerCase() || '';
        const description = release.tender?.description?.toLowerCase() || '';
        const buyer = release.buyer?.name?.toLowerCase() || '';
        const procuringEntity = release.tender?.procuringEntity?.name?.toLowerCase() || '';
        
        return title.includes(searchLower) || 
               description.includes(searchLower) || 
               buyer.includes(searchLower) ||
               procuringEntity.includes(searchLower);
      });
    }
    
    res.json({
      results: filteredReleases,
      total: filteredReleases.length,
      totalReleases: releases.length,
      page: parseInt(page),
      limit: parseInt(limit),
      dateFrom: _usedDateFrom || resolvedDateTo,
      dateTo: resolvedDateTo
    });
  } catch (error) {
    console.error('Error fetching tenders:', error.message);
    console.error('Error details:', error.response?.data);
    console.error('Request URL:', error.config?.url);
    console.error('Request params:', error.config?.params);
    
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch tenders',
      message: error.message,
      details: error.response?.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
