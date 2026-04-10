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
    
    // Calculate default date range (last 30 days) if not provided
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const defaultDateTo = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const defaultDateFrom = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Build query parameters using the correct API parameter names
    // Note: dateFrom and dateTo are REQUIRED by the API
    const params = {
      PageNumber: page,
      PageSize: limit,
      dateFrom: dateFrom || defaultDateFrom,
      dateTo: dateTo || defaultDateTo
    };
    
    console.log('Fetching from API with params:', params);
    
    const response = await axios.get(baseUrl, { 
      params,
      timeout: 50000, // 50 second timeout
      headers: {
        'Accept': 'application/json'
      }
    });
    
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
      dateFrom: params.dateFrom,
      dateTo: params.dateTo
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
