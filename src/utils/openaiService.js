/**
 * OpenAI Service for Smart Tender Matching
 * Provides AI-powered tender analysis and matching recommendations
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Generate AI-powered match analysis for a tender
 * @param {Object} tender - The tender object
 * @param {Object} profile - User profile data
 * @returns {Promise<Object>} - Match analysis with score and reasons
 */
export async function analyzeMatch(tender, profile) {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, skipping AI analysis');
    return null;
  }

  try {
    const tenderInfo = {
      title: tender.tender?.title || 'No title',
      description: tender.tender?.description || 'No description',
      category: tender.tender?.mainProcurementCategory || tender.tender?.category || 'Not specified',
      province: tender.tender?.province || 'Not specified'
    };

    const userInfo = {
      industry: profile.startup?.industry || 'Not specified',
      industrySectors: profile.profile?.industry_sectors || [],
      skills: profile.profile?.skills || [],
      interests: profile.profile?.interests || [],
      bio: profile.profile?.bio || '',
      location: profile.startup?.location || 'Not specified',
      stage: profile.startup?.stage || 'Not specified'
    };

    const prompt = `You are an expert at matching business opportunities with companies.

Analyze how well this tender matches the user's profile:

TENDER:
- Title: ${tenderInfo.title}
- Description: ${tenderInfo.description.substring(0, 500)}
- Category: ${tenderInfo.category}
- Location: ${tenderInfo.province}

USER PROFILE:
- Industry: ${userInfo.industry}
- Sectors: ${userInfo.industrySectors.join(', ')}
- Skills: ${userInfo.skills.join(', ')}
- Interests: ${userInfo.interests.join(', ')}
- Bio: ${userInfo.bio}
- Location: ${userInfo.location}
- Stage: ${userInfo.stage}

Provide a JSON response with:
1. matchScore: 0-100 (how relevant is this tender)
2. confidenceLevel: "high", "medium", or "low"
3. topReasons: Array of 3-5 specific reasons why this matches (be concise, actionable)
4. concerns: Array of 1-2 potential challenges or mismatches (if any)
5. recommendation: Brief recommendation (1 sentence)

Focus on semantic understanding, not just keyword matching. Consider industry relevance, capability fit, and strategic alignment.

Respond ONLY with valid JSON, no other text.`;

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a business opportunity matching expert. Respond only with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.error('No content in OpenAI response');
      return null;
    }

    // Parse JSON response
    const analysis = JSON.parse(content);
    
    return {
      aiScore: analysis.matchScore || 0,
      confidence: analysis.confidenceLevel || 'low',
      reasons: analysis.topReasons || [],
      concerns: analysis.concerns || [],
      recommendation: analysis.recommendation || ''
    };
    
  } catch (error) {
    console.error('Error in AI match analysis:', error);
    return null;
  }
}

/**
 * Generate batch AI analysis for multiple tenders (with rate limiting)
 * @param {Array} tenders - Array of tender objects
 * @param {Object} profile - User profile data
 * @param {number} maxTenders - Maximum number of tenders to analyze
 * @returns {Promise<Map>} - Map of tender IDs to analysis results
 */
export async function batchAnalyzeMatches(tenders, profile, maxTenders = 10) {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, skipping batch AI analysis');
    return new Map();
  }

  // Limit to top tenders to manage API costs
  const tendersToAnalyze = tenders.slice(0, maxTenders);
  const results = new Map();

  console.log(`Starting AI analysis for ${tendersToAnalyze.length} tenders...`);

  // Process sequentially to avoid rate limits (with small delay)
  for (let i = 0; i < tendersToAnalyze.length; i++) {
    const tender = tendersToAnalyze[i];
    const tenderId = tender.ocid || tender.id || `tender-${i}`;
    
    console.log(`Analyzing tender ${i + 1}/${tendersToAnalyze.length}: ${tender.tender?.title?.substring(0, 50)}...`);
    
    const analysis = await analyzeMatch(tender, profile);
    
    if (analysis) {
      results.set(tenderId, analysis);
    }
    
    // Small delay to respect rate limits (adjust as needed)
    if (i < tendersToAnalyze.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`AI analysis complete: ${results.size} tenders analyzed`);
  return results;
}

/**
 * Generate an overall portfolio summary using AI
 * @param {Array} matchedTenders - Array of matched tenders with scores
 * @param {Object} profile - User profile data
 * @returns {Promise<string>} - AI-generated summary
 */
export async function generatePortfolioSummary(matchedTenders, profile) {
  if (!OPENAI_API_KEY || !matchedTenders || matchedTenders.length === 0) {
    return null;
  }

  try {
    const topTenders = matchedTenders.slice(0, 5).map(t => ({
      title: t.tender?.title || 'Untitled',
      score: t.matchScore || 0,
      category: t.tender?.mainProcurementCategory || 'Not specified'
    }));

    const userInfo = {
      industry: profile.startup?.industry || 'Not specified',
      skills: profile.profile?.skills || [],
      interests: profile.profile?.interests || [],
      location: profile.startup?.location || 'Not specified'
    };

    const prompt = `As a business advisor, provide a brief strategic summary (2-3 sentences) of tender opportunities for this profile:

USER: ${userInfo.industry} company in ${userInfo.location}
Skills: ${userInfo.skills.join(', ')}
Interests: ${userInfo.interests.join(', ')}

TOP MATCHES:
${topTenders.map((t, i) => `${i + 1}. ${t.title} (${t.score}% match) - ${t.category}`).join('\n')}

Total Opportunities: ${matchedTenders.length}

Provide actionable insights about the opportunity landscape and strategic recommendations.`;

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a concise business strategy advisor. Provide brief, actionable insights.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
    
  } catch (error) {
    console.error('Error generating portfolio summary:', error);
    return null;
  }
}
