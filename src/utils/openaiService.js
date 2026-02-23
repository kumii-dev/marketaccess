/**
 * OpenAI Service for Smart Tender Matching
 * Provides AI-powered tender analysis and matching recommendations
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Extract 5 relevant keywords from user's comprehensive profile data using OpenAI
 * @param {string} bioText - Combined rich text from all profile sources
 * @param {Object} profile - Full user profile for context
 * @param {Object} combinedData - Structured combined data object (optional)
 * @returns {Promise<Array<string>>} - Array of 5 relevant keywords
 */
export async function extractKeywordsFromBio(bioText, profile, combinedData = null) {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, skipping keyword extraction');
    return [];
  }

  // Check if we have any usable data
  if ((!bioText || bioText.trim().length === 0) && !combinedData) {
    console.warn('No bio text or combined data available for keyword extraction');
    return [];
  }

  try {
    // Use combinedData if provided (richer), otherwise extract from profile
    const dataSource = combinedData || {
      bio: bioText,
      industry: profile?.startup?.industry || profile?.profile?.industry_sectors || 'Not specified',
      skills: profile?.profile?.skills || [],
      interests: profile?.profile?.interests || [],
      location: profile?.startup?.location || profile?.profile?.location || 'Not specified'
    };

    // Build comprehensive prompt with ALL available data
    const prompt = `Analyze this comprehensive business profile and extract EXACTLY 5 keywords that are most relevant for matching government tenders.

COMPREHENSIVE PROFILE DATA:

${dataSource.bio ? `Bio/Description:\n${dataSource.bio}\n\n` : ''}${dataSource.startupDescription ? `Startup Description:\n${dataSource.startupDescription}\n\n` : ''}Industry/Sector: ${dataSource.industry || 'Not specified'}

${dataSource.skills && dataSource.skills.length > 0 ? `Skills & Capabilities:\n${dataSource.skills.join(', ')}\n\n` : ''}${dataSource.interests && dataSource.interests.length > 0 ? `Areas of Interest:\n${dataSource.interests.join(', ')}\n\n` : ''}${dataSource.keyProducts ? `Key Products/Services:\n${dataSource.keyProducts}\n\n` : ''}${dataSource.targetMarket ? `Target Market:\n${dataSource.targetMarket}\n\n` : ''}Location: ${dataSource.location || 'Not specified'}
${dataSource.stage ? `Business Stage: ${dataSource.stage}\n` : ''}${dataSource.companyName ? `Company: ${dataSource.companyName}` : ''}

INSTRUCTIONS:
Analyze ALL the data above holistically and extract EXACTLY 5 keywords that best represent this business for government tender matching.

Requirements:
1. Return EXACTLY 5 keywords (no more, no less)
2. Synthesize insights from ALL available fields (bio, description, industry, skills, interests, products, market)
3. Focus on: core services offered, industries served, capabilities, expertise areas
4. Use specific, actionable terms that would appear in tender descriptions
   Examples: "construction", "software development", "healthcare services", "civil engineering", "consulting"
5. Prioritize terms that match government procurement categories
6. Avoid generic terms like "quality", "professional", "excellence", "innovation"
7. Exclude prepositions, conjunctions, and filler words
8. Choose keywords with broad tender matching potential

Respond with ONLY a JSON array of 5 strings, nothing else.
Example: ["construction", "infrastructure", "project management", "civil engineering", "municipal services"]`;

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
            content: 'You are a keyword extraction expert. Respond only with valid JSON arrays.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 100
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error (keyword extraction):', error);
      return [];
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.error('No content in OpenAI response');
      return [];
    }

    // Parse JSON response
    const keywords = JSON.parse(content);
    
    if (!Array.isArray(keywords) || keywords.length !== 5) {
      console.error('Invalid keyword response format:', keywords);
      return [];
    }

    console.log('✅ Extracted keywords from bio:', keywords);
    return keywords;
    
  } catch (error) {
    console.error('Error extracting keywords from bio:', error);
    return [];
  }
}

/**
 * Analyze tender description against extracted keywords
 * @param {Object} tender - The tender object
 * @param {Array<string>} keywords - Array of 5 keywords from user bio
 * @param {Object} profile - User profile data
 * @returns {Promise<Object>} - Match analysis with keyword relevance
 */
export async function analyzeTenderWithKeywords(tender, keywords, profile) {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, skipping tender analysis');
    return null;
  }

  if (!keywords || keywords.length === 0) {
    console.warn('No keywords provided for tender analysis');
    return null;
  }

  try {
    const tenderInfo = {
      title: tender.tender?.title || 'No title',
      description: tender.tender?.description || 'No description',
      category: tender.tender?.mainProcurementCategory || tender.tender?.category || 'Not specified',
      province: tender.tender?.province || 'Not specified'
    };

    const prompt = `You are a tender matching expert. Analyze how well this tender matches the user's business keywords.

USER'S BUSINESS KEYWORDS (from bio analysis):
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

TENDER:
- Title: ${tenderInfo.title}
- Description: ${tenderInfo.description.substring(0, 600)}
- Category: ${tenderInfo.category}
- Location: ${tenderInfo.province}

USER LOCATION: ${profile.startup?.location || profile.profile?.location || 'Not specified'}

Analyze and provide JSON response:
{
  "matchScore": 0-100 (semantic match between keywords and tender),
  "confidenceLevel": "high" | "medium" | "low",
  "keywordMatches": ["keyword1", "keyword2", ...] (which keywords are relevant),
  "topReasons": [3-5 specific reasons why this matches],
  "concerns": [0-2 potential challenges],
  "recommendation": "brief actionable recommendation (1 sentence)"
}

Focus on semantic understanding - the tender doesn't need exact keyword matches, but should be relevant to the business domain.

Respond ONLY with valid JSON.`;

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
            content: 'You are a tender matching expert. Respond only with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 400
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error (tender analysis):', error);
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
      keywordMatches: analysis.keywordMatches || [],
      reasons: analysis.topReasons || [],
      concerns: analysis.concerns || [],
      recommendation: analysis.recommendation || ''
    };
    
  } catch (error) {
    console.error('Error in AI tender analysis:', error);
    return null;
  }
}

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
 * Optimized batch analysis - processes only top 2 tenders per batch
 * @param {Array} tenders - Array of tender objects (batch of 10)
 * @param {Array<string>} keywords - User's 5 business keywords
 * @param {Object} profile - User profile data
 * @returns {Promise<Map>} - Map of tender IDs to analysis results
 */
export async function analyzeTopTendersInBatch(tenders, keywords, profile) {
  if (!OPENAI_API_KEY || !tenders || tenders.length === 0) {
    console.warn('Cannot analyze tenders: missing API key or tenders');
    return new Map();
  }

  if (!keywords || keywords.length === 0) {
    console.warn('No keywords available for analysis');
    return new Map();
  }

  // Sort by match score (descending) and take top 2
  const sortedTenders = [...tenders].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  const topTwoTenders = sortedTenders.slice(0, 2);

  const results = new Map();

  console.log(`🎯 Analyzing top 2 tenders from batch of ${tenders.length}`);

  for (let i = 0; i < topTwoTenders.length; i++) {
    const tender = topTwoTenders[i];
    const tenderId = tender.ocid || tender.id || `tender-${i}`;
    
    console.log(`  Analyzing #${i + 1}: ${tender.tender?.title?.substring(0, 50)}... (score: ${tender.matchScore || 0})`);
    
    const analysis = await analyzeTenderWithKeywords(tender, keywords, profile);
    
    if (analysis) {
      results.set(tenderId, analysis);
      console.log(`    ✅ AI Score: ${analysis.aiScore}, Confidence: ${analysis.confidence}`);
    }
    
    // Small delay between requests
    if (i < topTwoTenders.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`✅ Batch analysis complete: ${results.size} tenders analyzed`);
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
