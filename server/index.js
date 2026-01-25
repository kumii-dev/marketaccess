import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Proxy endpoint for OCDS Releases API
app.get('/api/tenders', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    
    // National Treasury eTenders OCDS Releases API
    const baseUrl = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';
    
    // Build query parameters
    const params = {
      page,
      limit
    };
    
    // Add search filter if provided
    if (search) {
      params.search = search;
    }
    
    const response = await axios.get(baseUrl, { 
      params,
      timeout: 30000 // 30 second timeout
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching tenders:', error.message);
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
