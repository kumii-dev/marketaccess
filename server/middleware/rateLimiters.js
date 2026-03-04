/**
 * Rate Limiting Middleware
 * 
 * 🔒 OWASP API4: Unrestricted Resource Consumption Protection
 * Implements multiple rate limiting tiers to prevent:
 * - API abuse and DoS attacks
 * - Excessive OpenAI API costs
 * - Resource exhaustion
 * 
 * NIST AI RMF: MANAGE-4.1 (Resource Management)
 */

import rateLimit from 'express-rate-limit';

/**
 * General API Rate Limiter
 * Applies to all /api/* endpoints
 * Prevents general API abuse
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per IP
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Use default IP-based key generator (handles IPv6 correctly)
  handler: (req, res) => {
    console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime.getTime() / 1000)
    });
  }
});

/**
 * AI Endpoint Rate Limiter (STRICT)
 * Applies to /api/ai/* endpoints
 * 120 calls/hour per user (2 calls/minute average)
 * 
 * Cost Protection:
 * - gpt-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
 * - Average call: ~500 input + 200 output tokens = $0.0002
 * - 120 calls/hour = ~$0.024/hour/user = ~$17.50/month/user (24/7)
 * - Realistic usage: ~$2-5/month/user
 */
export const aiEndpointLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 120, // 120 AI calls per hour per user
  message: {
    error: 'AI rate limit exceeded',
    limit: '120 calls per hour',
    retryAfter: 'Please wait before making more AI requests'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator (handles IPv6 correctly)
  // TODO: When JWT auth is implemented, use user ID instead
  handler: (req, res) => {
    const identifier = req.user?.id ? `User ${req.user.id}` : `IP ${req.ip}`;
    console.warn(`🚨 AI rate limit exceeded for ${identifier}`);
    
    // Log to security monitoring (TODO: integrate with Supabase logging)
    logRateLimitViolation({
      userId: req.user?.id || null,
      ip: req.ip,
      endpoint: req.path,
      timestamp: new Date().toISOString(),
      violationType: 'AI_RATE_LIMIT'
    });

    res.status(429).json({
      error: 'AI rate limit exceeded',
      message: 'You have made too many AI requests. Please wait before trying again.',
      limit: '120 calls per hour',
      retryAfter: Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000),
      costSavings: 'This limit protects against excessive API costs and ensures fair usage.'
    });
  },
  // Skip rate limiting for certain conditions (e.g., admin users)
  skip: (req) => {
    // Example: Skip for admin users (implement based on your auth system)
    if (req.user && req.user.role === 'admin') {
      return true;
    }
    return false;
  }
});

/**
 * Keyword Extraction Rate Limiter (MODERATE)
 * Specific to /api/ai/extract-keywords
 * More permissive since this is a core feature
 * 50 calls per hour per user
 */
export const keywordExtractionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 keyword extractions per hour
  message: {
    error: 'Keyword extraction rate limit exceeded',
    limit: '50 extractions per hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator (handles IPv6 correctly)
  handler: (req, res) => {
    console.warn(`⚠️ Keyword extraction limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      error: 'Keyword extraction limit exceeded',
      message: 'You have extracted keywords too many times. Please wait before trying again.',
      limit: '50 extractions per hour',
      retryAfter: Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
    });
  }
});

/**
 * Tender Analysis Rate Limiter (STRICT)
 * Specific to /api/ai/analyze-tender
 * Most expensive operation - strict limits
 * 30 calls per hour per user
 */
export const tenderAnalysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 tender analyses per hour
  message: {
    error: 'Tender analysis rate limit exceeded',
    limit: '30 analyses per hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator (handles IPv6 correctly)
  handler: (req, res) => {
    console.warn(`🚨 Tender analysis limit exceeded for user: ${req.user?.id || req.ip}`);
    
    logRateLimitViolation({
      userId: req.user?.id || null,
      ip: req.ip,
      endpoint: req.path,
      timestamp: new Date().toISOString(),
      violationType: 'TENDER_ANALYSIS_LIMIT'
    });

    res.status(429).json({
      error: 'Tender analysis limit exceeded',
      message: 'You have analyzed too many tenders. Please wait before requesting more analyses.',
      limit: '30 analyses per hour',
      retryAfter: Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000),
      tip: 'Focus on your highest-scoring matches to stay within limits.'
    });
  }
});

/**
 * Authentication Endpoint Rate Limiter (VERY STRICT)
 * Applies to login/signup endpoints
 * Prevents brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    error: 'Too many authentication attempts',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    console.warn(`🚨 Auth rate limit exceeded for IP: ${req.ip}`);
    
    logRateLimitViolation({
      userId: null,
      ip: req.ip,
      endpoint: req.path,
      timestamp: new Date().toISOString(),
      violationType: 'AUTH_BRUTE_FORCE'
    });

    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Too many failed login attempts. Please try again after 15 minutes.',
      retryAfter: Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
    });
  }
});

/**
 * Batch Operations Rate Limiter (MODERATE)
 * Applies to batch processing endpoints
 * 10 batch operations per hour
 */
export const batchOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 batch operations per hour
  message: {
    error: 'Batch operation rate limit exceeded',
    limit: '10 batch operations per hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator (handles IPv6 correctly)
  handler: (req, res) => {
    console.warn(`⚠️ Batch operation limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      error: 'Batch operation limit exceeded',
      message: 'You have performed too many batch operations. Please wait before trying again.',
      limit: '10 batch operations per hour',
      retryAfter: Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
    });
  }
});

/**
 * Log rate limit violations for security monitoring
 * Integrated with enterprise audit logging system
 * @param {Object} violation - Violation details
 */
async function logRateLimitViolation(violation) {
  console.log('📊 Rate Limit Violation:', JSON.stringify(violation, null, 2));
  
  // Send to centralized audit logging system
  try {
    await fetch('https://kumii.africa/admin/audit-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.AUDIT_API_KEY || 'development-key',
        'X-Application': 'MarketAccess-Server',
      },
      body: JSON.stringify({
        batch: [{
          timestamp: violation.timestamp,
          category: 'RATE_LIMIT',
          level: 'MEDIUM',
          action: 'Rate Limit Exceeded',
          resource: violation.endpoint,
          result: 'BLOCKED',
          userId: violation.userId || 'anonymous',
          sourceIp: violation.ip,
          frameworks: ['OWASP_API', 'ISO27001'],
          metadata: {
            violationType: violation.violationType,
            endpoint: violation.endpoint,
            owaspCategory: 'API4:2023 - Unrestricted Resource Consumption',
            iso27001Control: 'A.12.1.3'
          }
        }]
      })
    });
  } catch (err) {
    console.warn('⚠️ Failed to send audit log:', err.message);
  }
}

/**
 * Create a custom rate limiter with specific configuration
 * @param {Object} options - Rate limit configuration
 * @returns {Function} - Express middleware
 */
export function createCustomLimiter(options) {
  const defaults = {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
    // Use default IP-based key generator (handles IPv6 correctly)
  };

  return rateLimit({ ...defaults, ...options });
}

/**
 * Rate Limit Cost Calculator
 * Estimates OpenAI costs based on current limits
 */
export const rateLimitCostEstimate = {
  aiCallsPerHour: 120,
  avgTokensPerCall: 700, // 500 input + 200 output
  costPerMillionInputTokens: 0.15,
  costPerMillionOutputTokens: 0.60,
  
  calculateHourlyCost() {
    const inputCost = (this.aiCallsPerHour * 500 / 1_000_000) * this.costPerMillionInputTokens;
    const outputCost = (this.aiCallsPerHour * 200 / 1_000_000) * this.costPerMillionOutputTokens;
    return inputCost + outputCost;
  },
  
  calculateMonthlyCostPerUser() {
    const hourlyAverage = 2; // Realistic average: 2 hours active per day
    const daysPerMonth = 30;
    return this.calculateHourlyCost() * hourlyAverage * daysPerMonth;
  },
  
  calculateMaxMonthlyCostPerUser() {
    // 24/7 usage (unrealistic but maximum possible)
    return this.calculateHourlyCost() * 24 * 30;
  },
  
  printEstimate() {
    console.log('\n💰 OpenAI Cost Estimates (per user):');
    console.log(`   Hourly Rate Limit: ${this.aiCallsPerHour} calls`);
    console.log(`   Cost per call: ~$${(this.calculateHourlyCost() / this.aiCallsPerHour).toFixed(6)}`);
    console.log(`   Hourly cost (max): $${this.calculateHourlyCost().toFixed(4)}`);
    console.log(`   Monthly cost (typical): $${this.calculateMonthlyCostPerUser().toFixed(2)}`);
    console.log(`   Monthly cost (max 24/7): $${this.calculateMaxMonthlyCostPerUser().toFixed(2)}`);
    console.log('');
  }
};

// Export all limiters as a collection
export default {
  generalApiLimiter,
  aiEndpointLimiter,
  keywordExtractionLimiter,
  tenderAnalysisLimiter,
  authLimiter,
  batchOperationLimiter,
  createCustomLimiter,
  rateLimitCostEstimate
};
