/**
 * OpenAI Service for Smart Tender Matching
 *
 * ✅ ARCHITECTURE: All OpenAI calls are proxied through the Vercel backend.
 *    - The API key NEVER touches the browser.
 *    - Every call is automatically audit-logged server-side with the service_role key.
 *    - Rate limiting, cost tracking, and NIST AI RMF controls live on the server.
 *
 * Frontend  →  POST /api/ai/*  (Vercel)  →  OpenAI  →  audit_logs  (service_role)
 *
 * 🔒 SECURITY: Implements NIST AI RMF controls on the client side as well:
 * - Prompt injection prevention (sanitizeAIInput / buildSecurePrompt)
 * - AI data poisoning detection (detectAnomalies)
 * - Model hallucination mitigation (validateAIOutput)
 * - Privacy leakage prevention (anonymizeForAI / scrubPII)
 */

import {
  sanitizeAIInput,
  detectAnomalies,
  validateAIOutput,
  anonymizeForAI,
  scrubPII,
} from './aiSecurityControls.js';
import { logSystemError } from './auditLogger.js';

// Vercel backend base URL.  Empty string = same origin in production.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : import.meta.env.DEV
    ? 'http://localhost:3001'
    : '';

/**
 * Internal helper — POST to a Vercel AI endpoint and return the parsed JSON.
 * Throws on network error or non-2xx response.
 */
async function callVercelAI(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

/**
 * Extract 5 relevant keywords from user's comprehensive profile data.
 * Proxied through POST /api/ai/extract-keywords — OpenAI key stays on the server.
 *
 * @param {string} bioText - Combined rich text from all profile sources
 * @param {Object} profile - Full user profile for context
 * @param {Object} combinedData - Structured combined data object (optional)
 * @returns {Promise<Array<string>>} Array of 5 relevant keywords
 */
export async function extractKeywordsFromBio(bioText, profile, combinedData = null) {
  // Check if we have any usable data
  if ((!bioText || bioText.trim().length === 0) && !combinedData) {
    console.warn('No bio text or combined data available for keyword extraction');
    return [];
  }

  try {
    // 🔒 SECURITY: Anonymize user data before sending (NIST GOVERN-3.1)
    const anonymizedProfile = anonymizeForAI(profile);

    const dataSource = combinedData || {
      bio: bioText,
      industry: anonymizedProfile.industry || 'Not specified',
      skills: anonymizedProfile.skills || [],
      interests: anonymizedProfile.interests || [],
      location: anonymizedProfile.location || 'Not specified',
    };

    // 🔒 SECURITY: Sanitize inputs (NIST MANAGE-1.1)
    const sanitizedBio = sanitizeAIInput(dataSource.bio || '');

    // 🔒 SECURITY: Detect anomalies (NIST MAP-2.1)
    if (sanitizedBio) {
      const anomalyCheck = detectAnomalies(sanitizedBio);
      if (anomalyCheck.isSuspicious && anomalyCheck.riskScore > 75) {
        console.warn('⚠️ High-risk bio content detected:', anomalyCheck.reasons);
      }
    }

    const result = await callVercelAI('/api/ai/extract-keywords', {
      bioText: sanitizedBio,
      profile: anonymizedProfile,
      combinedData: { ...dataSource, bio: sanitizedBio },
    });

    const keywords = result.keywords || [];

    // 🔒 SECURITY: Scrub PII from outputs (NIST GOVERN-3.1)
    const safeKeywords = keywords.map((kw) => scrubPII(kw));

    console.log('✅ Extracted keywords (server-side):', safeKeywords);
    return safeKeywords;
  } catch (error) {
    console.error('Error extracting keywords from bio:', error);
    logSystemError(error, 'extractKeywordsFromBio', 'MEDIUM', {});
    return [];
  }
}

/**
 * Analyze tender description against extracted keywords.
 * Proxied through POST /api/ai/analyze-tender — audited server-side.
 *
 * @param {Object} tender - The tender object
 * @param {Array<string>} keywords - Array of 5 keywords from user bio
 * @param {Object} profile - User profile data
 * @returns {Promise<Object|null>} Match analysis with keyword relevance
 */
export async function analyzeTenderWithKeywords(tender, keywords, profile) {
  if (!keywords || keywords.length === 0) {
    console.warn('No keywords provided for tender analysis');
    return null;
  }

  try {
    // 🔒 SECURITY: Sanitize tender data (NIST MANAGE-1.1)
    const tenderInfo = {
      title: sanitizeAIInput(tender.tender?.title || 'No title'),
      description: sanitizeAIInput(tender.tender?.description || 'No description'),
      category: sanitizeAIInput(
        tender.tender?.mainProcurementCategory ||
        tender.tender?.category ||
        'Not specified'
      ),
      province: tender.tender?.province || 'Not specified',
    };

    // 🔒 SECURITY: Detect anomalies in tender data (NIST MAP-2.1)
    const descriptionCheck = detectAnomalies(tenderInfo.description);
    if (descriptionCheck.isSuspicious && descriptionCheck.riskScore > 50) {
      console.warn('⚠️ Suspicious tender data detected:', descriptionCheck.reasons);
    }

    // 🔒 SECURITY: Anonymize profile (NIST GOVERN-3.1)
    const anonymizedProfile = anonymizeForAI(profile);

    const result = await callVercelAI('/api/ai/analyze-tender', {
      tender: { ...tender, tender: tenderInfo },
      keywords,
      profile: anonymizedProfile,
      userEmail: profile?.user?.email || null,
    });

    const analysis = result.analysis;
    if (!analysis) return null;

    // 🔒 SECURITY: Validate AI output (NIST MEASURE-1.1)
    const validation = validateAIOutput(analysis.keywordMatches || [], {
      title: tenderInfo.title,
      description: tenderInfo.description,
    });

    if (validation.confidence < 40) {
      console.warn('⚠️ Low confidence AI analysis detected');
    }

    // 🔒 SECURITY: Scrub PII from AI output (NIST GOVERN-3.1)
    const safeRecommendation = scrubPII(analysis.recommendation || '');
    const safeReasons = (analysis.topReasons || []).map((r) => scrubPII(r));

    return {
      aiScore: analysis.matchScore || 0,
      confidence: analysis.confidenceLevel || 'low',
      keywordMatches: validation.validatedKeywords.map((kw) => kw.keyword),
      reasons: safeReasons,
      concerns: analysis.concerns || [],
      recommendation: safeRecommendation,
      securityMetadata: {
        validationConfidence: validation.confidence,
        validatedKeywords: validation.totalValidated,
        totalKeywords: validation.totalProvided,
      },
    };
  } catch (error) {
    console.error('Error in AI tender analysis:', error);
    logSystemError(error, 'analyzeTenderWithKeywords', 'MEDIUM', { tenderId: tender?.ocid });
    return null;
  }
}

/**
 * Generate AI-powered match analysis for a tender (uses analyzeTenderWithKeywords internally).
 * Proxied through POST /api/ai/analyze-tender — audited server-side.
 *
 * @param {Object} tender - The tender object
 * @param {Object} profile - User profile data
 * @returns {Promise<Object|null>} Match analysis with score and reasons
 */
export async function analyzeMatch(tender, profile) {
  // Build a keyword list from the profile so we can call the shared endpoint
  const keywords = [
    profile.startup?.industry,
    ...(profile.profile?.skills || []).slice(0, 2),
    ...(profile.profile?.interests || []).slice(0, 2),
  ].filter(Boolean);

  if (keywords.length === 0) {
    console.warn('No profile keywords available for analyzeMatch');
    return null;
  }

  return analyzeTenderWithKeywords(tender, keywords, profile);
}

/**
 * Generate batch AI analysis for multiple tenders (legacy wrapper).
 * Splits into chunks of 2 and calls analyzeTopTendersInBatch for each chunk.
 *
 * @param {Array} tenders - Array of tender objects
 * @param {Object} profile - User profile data
 * @param {number} maxTenders - Maximum number of tenders to analyze
 * @returns {Promise<Map>} Map of tender IDs to analysis results
 */
export async function batchAnalyzeMatches(tenders, profile, maxTenders = 10) {
  const keywords = [
    profile.startup?.industry,
    ...(profile.profile?.skills || []).slice(0, 2),
    ...(profile.profile?.interests || []).slice(0, 2),
  ].filter(Boolean);

  const batch = tenders.slice(0, maxTenders);
  const results = new Map();

  console.log(`Starting AI analysis for ${batch.length} tenders (server-side, chunked)...`);

  for (let i = 0; i < batch.length; i += 2) {
    const chunk = batch.slice(i, i + 2);
    const chunkResults = await analyzeTopTendersInBatch(chunk, keywords, profile);
    chunkResults.forEach((v, k) => results.set(k, v));
    if (i + 2 < batch.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`AI analysis complete: ${results.size} tenders analyzed`);
  return results;
}

/**
 * Optimized batch analysis — top 2 tenders per batch.
 * Proxied through POST /api/ai/batch-analyze — audited server-side.
 *
 * @param {Array} tenders - Array of tender objects (batch of 10)
 * @param {Array<string>} keywords - User's 5 business keywords
 * @param {Object} profile - User profile data
 * @returns {Promise<Map>} Map of tender IDs to analysis results
 */
export async function analyzeTopTendersInBatch(tenders, keywords, profile) {
  if (!tenders || tenders.length === 0) {
    console.warn('Cannot analyze tenders: no tenders provided');
    return new Map();
  }

  if (!keywords || keywords.length === 0) {
    console.warn('No keywords available for batch analysis');
    return new Map();
  }

  // Sort by match score (descending) and take top 2
  const sortedTenders = [...tenders].sort(
    (a, b) => (b.matchScore || 0) - (a.matchScore || 0)
  );
  const topTwo = sortedTenders.slice(0, 2);

  const results = new Map();
  console.log(`🎯 Batch-analyzing top 2 tenders from batch of ${tenders.length} (server-side)`);

  try {
    // 🔒 SECURITY: Sanitize tender fields before sending
    const sanitizedTenders = topTwo.map((t) => ({
      ...t,
      tender: {
        ...t.tender,
        title: sanitizeAIInput(t.tender?.title || ''),
        description: sanitizeAIInput(t.tender?.description || ''),
      },
    }));

    const result = await callVercelAI('/api/ai/batch-analyze', {
      tenders: sanitizedTenders,
      keywords,
      maxTenders: 2,
      userEmail: profile?.user?.email || null,
    });

    const serverResults = result.results || {};
    for (const [tenderId, analysis] of Object.entries(serverResults)) {
      if (analysis) {
        const safeReasons = (analysis.topReasons || []).map((r) => scrubPII(r));
        results.set(tenderId, {
          aiScore: analysis.matchScore || 0,
          confidence: analysis.confidenceLevel || 'low',
          reasons: safeReasons,
          concerns: analysis.concerns || [],
          recommendation: scrubPII(analysis.recommendation || ''),
        });
        console.log(`    ✅ ${tenderId}: score=${analysis.matchScore}, confidence=${analysis.confidenceLevel}`);
      }
    }
  } catch (error) {
    console.error('Error in batch analysis:', error);
    logSystemError(error, 'analyzeTopTendersInBatch', 'MEDIUM', {});
  }

  console.log(`✅ Batch analysis complete: ${results.size} tenders analyzed`);
  return results;
}

/**
 * Generate an overall portfolio summary.
 * Proxied through POST /api/ai/portfolio-summary — audited server-side.
 *
 * @param {Array} matchedTenders - Array of matched tenders with scores
 * @param {Object} profile - User profile data
 * @returns {Promise<string|null>} AI-generated summary paragraph
 */
export async function generatePortfolioSummary(matchedTenders, profile) {
  if (!matchedTenders || matchedTenders.length === 0) return null;

  try {
    const topTenders = matchedTenders.slice(0, 5).map((t) => ({
      title: sanitizeAIInput(t.tender?.title || 'Untitled'),
      score: t.matchScore || 0,
      category: t.tender?.mainProcurementCategory || 'Not specified',
    }));

    const anonymizedProfile = anonymizeForAI(profile);

    const result = await callVercelAI('/api/ai/portfolio-summary', {
      topTenders,
      totalCount: matchedTenders.length,
      profile: anonymizedProfile,
      userEmail: profile?.user?.email || null,
    });

    return result.summary || null;
  } catch (error) {
    console.error('Error generating portfolio summary:', error);
    logSystemError(error, 'generatePortfolioSummary', 'MEDIUM', {});
    return null;
  }
}
