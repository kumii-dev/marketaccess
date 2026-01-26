import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Configure CORS to allow requests from any origin
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));
app.use(express.json());

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
      timeout: 30000, // 30 second timeout
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
