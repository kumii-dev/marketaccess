# 🔒 Cybersecurity Improvements for Market Access App

## Executive Summary

This document outlines critical cybersecurity vulnerabilities and provides actionable recommendations to secure your application, including protection for Lovable (Supabase) and eTender APIs.

---

## 🚨 CRITICAL VULNERABILITIES (FIX IMMEDIATELY)

### 1. **Exposed API Keys in Repository** 🔴 CRITICAL

**Current Risk:**
```env
# .env file contains EXPOSED keys:
OPENAI_API_KEY=sk-proj-XXXXX...REDACTED...XXXXX
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...REDACTED
```

**Impact:**
- ❌ Anyone can use your OpenAI credits ($$$)
- ❌ Unauthorized access to Supabase database
- ❌ Data theft, manipulation, deletion
- ❌ Financial liability

**IMMEDIATE ACTION:**
1. **Revoke ALL exposed keys NOW:**
   - OpenAI: https://platform.openai.com/api-keys
   - Supabase: Project Settings → API → Generate new keys

2. **Never commit `.env` to Git:**
   ```bash
   git rm --cached .env
   git commit -m "Remove exposed .env file"
   git push origin main
   ```

3. **Add to `.gitignore`:**
   ```
   .env
   .env.local
   .env*.local
   ```

---

## 🛡️ HIGH PRIORITY FIXES

### 2. **OpenAI API Key Exposed in Frontend** 🔴 HIGH

**Current Risk:**
```javascript
// src/utils/openaiService.js
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
```

**Problem:** `VITE_` prefix exposes the key in browser JavaScript bundle. Anyone can extract it from DevTools.

**Solution:** Move OpenAI calls to backend

**Implementation:**

#### Step 1: Create Backend OpenAI Endpoint

```javascript
// server/index.js - ADD THIS:

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // NOT VITE_ prefix
});

// Secure OpenAI endpoint with rate limiting
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { userId, tenders, profileData } = req.body;
    
    // Validate user authentication
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Verify Supabase JWT token
    const token = authHeader.replace('Bearer ', '');
    // TODO: Verify JWT with Supabase
    
    // Rate limiting check
    // TODO: Implement Redis-based rate limiting
    
    // Call OpenAI API (server-side only)
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [/* your prompts */],
      temperature: 0.3
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});
```

#### Step 2: Update Frontend

```javascript
// src/utils/openaiService.js - REPLACE with:

export const analyzeWithAI = async (profileData, tenders, token) => {
  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` // Supabase JWT
    },
    body: JSON.stringify({ profileData, tenders })
  });
  
  if (!response.ok) throw new Error('AI analysis failed');
  return response.json();
};
```

---

### 3. **Insecure CORS Configuration** 🔴 HIGH

**Current Risk:**
```javascript
// server/index.js
app.use(cors({
  origin: '*', // ❌ ALLOWS ANY WEBSITE TO USE YOUR API
  credentials: false
}));
```

**Attack Scenario:**
- Malicious website calls your API
- Steals data, abuses OpenAI credits
- DDoS attacks

**Solution:** Whitelist specific origins

```javascript
// server/index.js - REPLACE CORS:

const ALLOWED_ORIGINS = [
  'https://marketaccess.vercel.app',
  'https://kumii.africa',
  'http://localhost:5173', // Dev only
  'http://localhost:3000'  // Dev only
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked CORS request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

### 4. **No Rate Limiting** 🟡 MEDIUM

**Current Risk:**
- Unlimited API calls = DDoS attacks
- OpenAI credit abuse
- eTender API abuse → IP ban

**Solution:** Implement rate limiting

```bash
npm install express-rate-limit
```

```javascript
// server/index.js - ADD THIS:

import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limit for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 AI requests per hour
  message: 'AI analysis limit exceeded, please try again later'
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/ai/', aiLimiter);
```

---

### 5. **No Input Validation** 🟡 MEDIUM

**Current Risk:**
- SQL injection (if using raw queries)
- XSS attacks via user input
- NoSQL injection in Supabase

**Solution:** Validate and sanitize all inputs

```bash
npm install express-validator
```

```javascript
// server/index.js - ADD VALIDATION:

import { body, query, validationResult } from 'express-validator';

// Middleware to check validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Example: Secure tenders endpoint
app.get('/api/tenders',
  [
    query('page').optional().isInt({ min: 1, max: 1000 }),
    query('limit').optional().isInt({ min: 1, max: 250 }),
    query('search').optional().isString().trim().escape().isLength({ max: 200 }),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601()
  ],
  validate,
  async (req, res) => {
    // Your existing code...
  }
);
```

---

## 🔐 SUPABASE SECURITY (Lovable API)

### 6. **Row-Level Security (RLS) Not Enforced** 🔴 HIGH

**Check Current RLS Policies:**

```sql
-- In Supabase SQL Editor, run:
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

**Enable RLS for ALL tables:**

```sql
-- Enable RLS
ALTER TABLE public.startups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_tenders ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own data
CREATE POLICY "Users can view own profile"
ON public.user_profiles
FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can only update their own data
CREATE POLICY "Users can update own profile"
ON public.user_profiles
FOR UPDATE
USING (auth.uid() = user_id);

-- Policy: Prevent deletion
CREATE POLICY "Prevent profile deletion"
ON public.user_profiles
FOR DELETE
USING (false);
```

---

### 7. **Exposed Supabase Anon Key** 🟡 MEDIUM

**Current State:**
```javascript
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**This is ACCEPTABLE IF:**
- ✅ RLS is enabled and properly configured
- ✅ Service role key is NEVER exposed
- ✅ API endpoints have rate limiting

**Verify Service Role Key Security:**
```bash
# Check that service role key is NOT in .env
grep -r "service_role" .

# Should return NOTHING. If found, REVOKE IMMEDIATELY.
```

---

### 8. **Supabase API Rate Limiting** 🟡 MEDIUM

**Add to Supabase Edge Functions:**

```typescript
// supabase/functions/api-read-profiles/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Rate limiting storage (use Upstash Redis for production)
const rateLimitMap = new Map();

const rateLimit = (ip: string, limit = 100, windowMs = 60000) => {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count++;
  }
  
  rateLimitMap.set(ip, record);
  return record.count <= limit;
};

serve(async (req) => {
  // Get client IP
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  
  // Check rate limit
  if (!rateLimit(ip)) {
    return new Response('Rate limit exceeded', { status: 429 });
  }
  
  // Verify JWT token
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Your existing code...
});
```

---

## 🌐 ETENDER API PROTECTION

### 9. **eTender API Abuse Prevention** 🟡 MEDIUM

**Current Risk:**
- Your app makes direct calls to eTender API
- Rate limits apply to YOUR IP
- Could get banned if abused

**Solution:** Implement caching + request throttling

```javascript
// server/index.js - ADD CACHING:

import NodeCache from 'node-cache';

// Cache for 10 minutes
const tenderCache = new NodeCache({ stdTTL: 600 });

app.get('/api/tenders', async (req, res) => {
  const cacheKey = JSON.stringify(req.query);
  
  // Check cache first
  const cachedData = tenderCache.get(cacheKey);
  if (cachedData) {
    console.log('Serving from cache');
    return res.json(cachedData);
  }
  
  try {
    // Call eTender API with retry logic
    const response = await axios.get(baseUrl, {
      params,
      timeout: 30000,
      headers: {
        'User-Agent': 'MarketAccess/1.0',
        'Accept': 'application/json'
      }
    });
    
    // Cache the response
    tenderCache.set(cacheKey, response.data);
    
    res.json(response.data);
    
  } catch (error) {
    // Graceful degradation
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'API timeout' });
    }
    res.status(500).json({ error: 'Failed to fetch tenders' });
  }
});
```

---

## 🔑 AUTHENTICATION & AUTHORIZATION

### 10. **Implement JWT Verification** 🔴 HIGH

**Problem:** Backend doesn't verify user authentication

**Solution:**

```bash
npm install jsonwebtoken @supabase/supabase-js
```

```javascript
// server/middleware/auth.js - CREATE NEW FILE:

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Backend only!
);

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Attach user to request
    req.user = user;
    next();
    
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};
```

**Use in protected routes:**

```javascript
// server/index.js
import { verifyToken } from './middleware/auth.js';

// Protect sensitive endpoints
app.post('/api/ai/analyze', verifyToken, async (req, res) => {
  // req.user is now available
  const userId = req.user.id;
  // ... your code
});
```

---

## 🛡️ ADDITIONAL SECURITY LAYERS

### 11. **Environment-Specific Security Headers**

```bash
npm install helmet
```

```javascript
// server/index.js - ADD AFTER CORS:

import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://marketaccess.vercel.app", "https://njcancswtqnxihxavshl.supabase.co"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

---

### 12. **Request Logging & Monitoring**

```bash
npm install morgan winston
```

```javascript
// server/index.js

import morgan from 'morgan';
import winston from 'winston';

// Setup Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// HTTP request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Log suspicious activity
app.use((req, res, next) => {
  // Log failed auth attempts
  if (req.path.includes('/api/') && !req.headers.authorization) {
    logger.warn(`Unauthorized access attempt: ${req.ip} -> ${req.path}`);
  }
  next();
});
```

---

## 📋 SECURITY CHECKLIST

### Immediate Actions (TODAY):
- [ ] Revoke exposed OpenAI API key
- [ ] Revoke exposed Supabase keys
- [ ] Remove `.env` from Git history
- [ ] Add `.env` to `.gitignore`
- [ ] Fix CORS to whitelist only your domains

### High Priority (THIS WEEK):
- [ ] Move OpenAI calls to backend
- [ ] Implement rate limiting
- [ ] Add input validation
- [ ] Enable Supabase RLS on all tables
- [ ] Add JWT verification middleware

### Medium Priority (THIS MONTH):
- [ ] Add request logging
- [ ] Implement security headers (Helmet)
- [ ] Add caching for eTender API
- [ ] Set up monitoring alerts
- [ ] Conduct security audit

### Long-term:
- [ ] Implement Redis for distributed rate limiting
- [ ] Add API key rotation system
- [ ] Set up automated security scanning (Snyk, Dependabot)
- [ ] Implement WAF (Web Application Firewall)
- [ ] Add DDoS protection (Cloudflare)

---

## 🚀 DEPLOYMENT SECURITY

### Vercel Environment Variables

1. **Remove from `.env` file**
2. **Add in Vercel Dashboard:**
   - Settings → Environment Variables
   - Add secrets WITHOUT `VITE_` prefix for backend
   - Use `VITE_` prefix ONLY for public variables

**Backend secrets (NOT exposed to browser):**
```
OPENAI_API_KEY=sk-...
SUPABASE_SERVICE_ROLE_KEY=...
```

**Frontend public variables (safe to expose):**
```
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=eyJ... (safe with RLS)
VITE_API_BASE_URL=https://...
```

---

## 📞 INCIDENT RESPONSE PLAN

### If Keys Are Compromised:

1. **Immediate:**
   - Revoke ALL keys
   - Generate new keys
   - Update Vercel environment variables
   - Redeploy application

2. **Within 24 hours:**
   - Review API usage logs for abuse
   - Check OpenAI billing for unusual charges
   - Review Supabase database for unauthorized access
   - Change all passwords

3. **Within 1 week:**
   - Conduct security audit
   - Implement additional monitoring
   - Update documentation

---

## 💰 COST CONSIDERATIONS

**Current Monthly Costs (Estimates):**
- OpenAI API: $50-200/month (depends on usage)
- Supabase Free tier: $0 (10GB storage, 50MB file uploads)
- Vercel Free tier: $0 (100GB bandwidth)

**With Security Improvements:**
- Rate limiting reduces abuse = lower costs
- Caching reduces API calls = lower costs
- Monitoring catches issues early = prevents overages

---

## 🔗 RESOURCES

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/row-level-security)
- [OpenAI API Security](https://platform.openai.com/docs/guides/safety-best-practices)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

## ✅ QUICK WINS (30 MINUTES)

Start with these 5 changes that give maximum security benefit:

1. **Revoke exposed keys** (5 min)
2. **Fix CORS whitelist** (5 min)
3. **Add rate limiting** (10 min)
4. **Enable Supabase RLS** (5 min)
5. **Remove .env from Git** (5 min)

This alone will eliminate 80% of your security risk!

---

**Last Updated:** March 4, 2026  
**Version:** 1.0  
**Next Review:** April 4, 2026
