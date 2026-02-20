import { useState, useEffect, useRef } from 'react';
import { fetchTenders } from '../lib/api';
import { batchAnalyzeMatches, generatePortfolioSummary } from '../utils/openaiService';
import { getCachedTenders, cacheTenders, getCacheInfo } from '../utils/tenderCache';
import TenderCard from './TenderCard';
import LoadingSpinner from './LoadingSpinner';
import ErrorMessage from './ErrorMessage';
import './SmartMatchedTenders.css';

const SmartMatchedTenders = () => {
  const [authToken, setAuthToken] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [allTenders, setAllTenders] = useState([]);
  const [matchedTenders, setMatchedTenders] = useState([]);
  const [filteredTenders, setFilteredTenders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(true);
  const [matchingScore, setMatchingScore] = useState({});
  const [aiAnalysis, setAiAnalysis] = useState(new Map());
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  
  // Ref to track latest matched tenders for AI enhancement
  const latestMatchedRef = useRef([]);
  // Filter state
  const [filters, setFilters] = useState({
    keywords: '',
    province: '',
    category: '',
    minScore: 0,
    sortBy: 'score-desc'
  });

  // Listen for KUMII_AUTH_TOKEN from parent window
  useEffect(() => {
    const handleMessage = (event) => {
      // Security: In production, validate event.origin
      if (event.data && event.data.type === 'KUMII_AUTH_TOKEN') {
        console.log('Received KUMII_AUTH_TOKEN from parent window');
        const token = event.data.token;
        if (token) {
          setAuthToken(token);
          setIsWaitingForAuth(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Request token from parent on mount
    if (window.parent !== window.self) {
      window.parent.postMessage({ type: 'REQUEST_AUTH_TOKEN' }, '*');
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Fetch profile data and public tenders when auth token is available
  useEffect(() => {
    if (!authToken) return;

    const fetchProfileAndTenders = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch profile data
        const profileResponse = await fetch(
          'https://qypazgkngxhazgkuevwq.supabase.co/functions/v1/api-read-profiles?type=both',
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (!profileResponse.ok) {
          throw new Error(`Failed to fetch profile data: ${profileResponse.status} ${profileResponse.statusText}`);
        }

        const profile = await profileResponse.json();
        console.log('Profile data received:', profile);
        setProfileData(profile);

        // Date range setup
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);
        const dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        const dateTo = today.toISOString().split('T')[0];

        // Check cache first
        const cachedTenders = getCachedTenders(dateFrom, dateTo);
        const cacheInfo = getCacheInfo();
        
        if (cachedTenders && cachedTenders.length > 0) {
          console.log('⚡ Using cached tenders:', cacheInfo);
          setAllTenders(cachedTenders);
          const cachedMatched = matchTendersToProfile(cachedTenders, profile);
          setMatchedTenders(cachedMatched);
          setLoading(false);
          
          // Still enhance with AI in background
          if (cachedMatched.length > 0) {
            enhanceWithAI(cachedMatched, profile);
          }
          return; // Skip fetching
        }

        // PHASE 1: Quick initial load (50 tenders)
        console.log('🚀 Phase 1: Loading initial 50 tenders...');
        const initialData = await fetchTenders({
          page: 1,
          limit: 50,
          dateFrom,
          dateTo
        });

        let initialTenders = [];
        if (initialData.results) {
          initialTenders = initialData.results;
        } else if (initialData.data) {
          initialTenders = initialData.data;
        } else if (Array.isArray(initialData)) {
          initialTenders = initialData;
        }

        // Show initial matches immediately
        if (initialTenders.length > 0) {
          setAllTenders(initialTenders);
          const initialMatched = matchTendersToProfile(initialTenders, profile);
          setMatchedTenders(initialMatched);
          setLoadingProgress({ current: 50, total: 250, percentage: 20 });
          
          console.log(`✅ Initial ${initialTenders.length} tenders loaded and matched`);
        }

        // Initial loading complete - user can see results now
        setLoading(false);

        // PHASE 2: Progressive background loading (200 more tenders in batches)
        console.log('🔄 Phase 2: Loading additional tenders in background...');
        setIsLoadingMore(true);
        
        const batches = [
          { page: 2, limit: 50 }, // 51-100
          { page: 3, limit: 50 }, // 101-150
          { page: 4, limit: 50 }, // 151-200
          { page: 5, limit: 50 }  // 201-250
        ];

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          
          try {
            const batchData = await fetchTenders({
              page: batch.page,
              limit: batch.limit,
              dateFrom,
              dateTo
            });

            let batchTenders = [];
            if (batchData.results) {
              batchTenders = batchData.results;
            } else if (batchData.data) {
              batchTenders = batchData.data;
            } else if (Array.isArray(batchData)) {
              batchTenders = batchData;
            }

            if (batchTenders.length > 0) {
              // Append new tenders
              setAllTenders(prev => {
                const combined = [...prev, ...batchTenders];
                // Re-match with all tenders so far
                const newMatched = matchTendersToProfile(combined, profile);
                setMatchedTenders(newMatched);
                
                // Update ref with latest matches
                latestMatchedRef.current = newMatched;
                
                // Cache the combined result after last batch
                if (i === batches.length - 1) {
                  cacheTenders(combined, dateFrom, dateTo);
                }
                
                return combined;
              });

              const currentCount = 50 + (i + 1) * 50;
              const percentage = Math.round((currentCount / 250) * 100);
              setLoadingProgress({ current: currentCount, total: 250, percentage });
              
              console.log(`📦 Batch ${i + 1}/4 loaded: +${batchTenders.length} tenders (Total: ${currentCount})`);
            }

            // Small delay between batches to avoid overwhelming the API
            if (i < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch (batchError) {
            console.error(`Error loading batch ${i + 1}:`, batchError);
            // Continue with next batch even if one fails
          }
        }

        setIsLoadingMore(false);
        console.log('✅ All tenders loaded successfully');

        // PHASE 3: AI Enhancement (use ref to get latest matches)
        if (latestMatchedRef.current && latestMatchedRef.current.length > 0) {
          enhanceWithAI(latestMatchedRef.current, profile);
        }

      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message || 'Failed to load matched tenders');
        setLoading(false);
        setIsLoadingMore(false);
      }
    };

    fetchProfileAndTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]); // matchTendersToProfile is stable and doesn't need to be in deps
  const enhanceWithAI = async (tenders, profile) => {
    try {
      setAiLoading(true);
      console.log('Starting AI enhancement for top tenders...');

      // Analyze top 10 matches with AI
      const topTenders = tenders.slice(0, 10);
      const analysis = await batchAnalyzeMatches(topTenders, profile, 10);
      setAiAnalysis(analysis);

      // Generate portfolio summary
      const summary = await generatePortfolioSummary(tenders, profile);
      setAiSummary(summary);

      console.log('AI enhancement complete:', {
        analyzedCount: analysis.size,
        hasSummary: !!summary
      });
    } catch (err) {
      console.error('AI enhancement error:', err);
      // Don't throw - AI is optional enhancement
    } finally {
      setAiLoading(false);
    }
  };

  // Extract business strengths from profile
  const getBusinessStrengths = (profile) => {
    if (!profile) {
      console.log('No profile data available for strengths extraction');
      return [];
    }
    
    console.log('Extracting business strengths from profile:', profile);
    const strengths = [];
    
    // Industry/Sector
    const industry = extractProfileField(profile, [
      'startup.industry',
      'profile.industry_sectors',
      'company.industry', 
      'industry', 
      'company.sector', 
      'sector'
    ]);
    console.log('Industry extracted:', industry);
    if (industry) {
      const displayValue = Array.isArray(industry) ? industry.join(', ') : industry;
      strengths.push({
        icon: 'bi-briefcase',
        label: 'Industry',
        value: displayValue
      });
    }
    
    // Services/Products offered
    const services = extractProfileField(profile, [
      'startup.key_products_services',
      'profile.skills',
      'company.services', 
      'services', 
      'company.offerings', 
      'offerings'
    ]);
    console.log('Services/Skills extracted:', services);
    if (services) {
      const displayValue = Array.isArray(services) ? services.join(', ') : services;
      strengths.push({
        icon: 'bi-tools',
        label: 'Services/Skills',
        value: displayValue
      });
    }
    
    // Location/Province
    const province = extractProfileField(profile, [
      'startup.location',
      'profile.location',
      'company.province', 
      'user.province', 
      'province', 
      'company.location', 
      'location'
    ]);
    console.log('Province extracted:', province);
    if (province) {
      strengths.push({
        icon: 'bi-geo-alt',
        label: 'Location',
        value: province
      });
    }
    
    // Business Stage
    const stage = extractProfileField(profile, [
      'startup.stage',
      'company.stage',
      'stage'
    ]);
    console.log('Stage extracted:', stage);
    if (stage) {
      strengths.push({
        icon: 'bi-graph-up',
        label: 'Business Stage',
        value: stage.charAt(0).toUpperCase() + stage.slice(1)
      });
    }
    
    // Interests/Focus Areas
    const interests = extractProfileField(profile, [
      'profile.interests',
      'interests',
      'profile.industry_sectors',
      'company.categories', 
      'categories'
    ]);
    console.log('Interests extracted:', interests);
    if (interests && Array.isArray(interests) && interests.length > 0) {
      strengths.push({
        icon: 'bi-tags',
        label: 'Focus Areas',
        value: interests.join(', ')
      });
    }
    
    // Persona/Type
    const personaType = extractProfileField(profile, [
      'profile.persona_type',
      'persona_type',
      'user.type'
    ]);
    console.log('Persona type extracted:', personaType);
    if (personaType) {
      const displayType = personaType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      strengths.push({
        icon: 'bi-person-badge',
        label: 'Profile Type',
        value: displayType
      });
    }
    
    console.log('Total strengths found:', strengths.length, strengths);
    return strengths;
  };

  // Helper function to extract profile fields with multiple fallback paths
  const extractProfileField = (profile, paths) => {
    if (!profile) return null;
    
    for (const path of paths) {
      const keys = path.split('.');
      let value = profile;
      
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          value = null;
          break;
        }
      }
      
      if (value !== null && value !== undefined && value !== '') {
        return value;
      }
    }
    
    return null;
  };

  // Get user's display name from profile
  const getUserDisplayName = (profile) => {
    if (!profile) {
      console.log('No profile data available');
      return 'there';
    }

    console.log('Profile structure:', JSON.stringify(profile, null, 2));

    // Try different possible structures for first and last name
    const firstName = profile?.user?.first_name || 
                      profile?.user?.firstName || 
                      profile?.first_name || 
                      profile?.firstName ||
                      profile?.profile?.first_name;
    
    const lastName = profile?.user?.last_name || 
                     profile?.user?.lastName || 
                     profile?.last_name || 
                     profile?.lastName ||
                     profile?.profile?.last_name;

    if (firstName && lastName) {
      console.log(`Found user name: ${firstName} ${lastName}`);
      return `${firstName} ${lastName}`;
    }

    // Try full name
    const fullName = profile?.user?.full_name || 
                     profile?.user?.fullName || 
                     profile?.full_name || 
                     profile?.fullName ||
                     profile?.profile?.full_name;
    
    if (fullName) {
      console.log(`Found full name: ${fullName}`);
      return fullName;
    }

    // Try company name
    const companyName = profile?.company?.name || 
                       profile?.company?.company_name || 
                       profile?.companyName;
    
    if (companyName) {
      console.log(`Using company name: ${companyName}`);
      return companyName;
    }

    // Try email username as last resort
    const email = profile?.user?.email || profile?.email;
    if (email) {
      const username = email.split('@')[0];
      console.log(`Using email username: ${username}`);
      return username;
    }

    console.log('No identifiable name found, using default');
    return 'there';
  };

  // Apply filters to matched tenders
  useEffect(() => {
    if (!matchedTenders || matchedTenders.length === 0) {
      setFilteredTenders([]);
      return;
    }

    let result = [...matchedTenders];

    // Filter by keywords
    if (filters.keywords) {
      const keywords = filters.keywords.toLowerCase().split(/\s+/).filter(k => k.length > 0);
      result = result.filter(tender => {
        const title = (tender.tender?.title || '').toLowerCase();
        const description = (tender.tender?.description || '').toLowerCase();
        const combinedText = `${title} ${description}`;
        return keywords.some(keyword => combinedText.includes(keyword));
      });
    }

    // Filter by province
    if (filters.province) {
      result = result.filter(tender => tender.tender?.province === filters.province);
    }

    // Filter by category
    if (filters.category) {
      result = result.filter(tender => {
        const category = tender.tender?.mainProcurementCategory || tender.tender?.category;
        return category === filters.category;
      });
    }

    // Filter by minimum score
    if (filters.minScore > 0) {
      result = result.filter(tender => (tender.matchScore || 0) >= filters.minScore);
    }

    // Sort results
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'score-desc':
          return (b.matchScore || 0) - (a.matchScore || 0);
        case 'score-asc':
          return (a.matchScore || 0) - (b.matchScore || 0);
        case 'closing-soon': {
          const dateA = a.tender?.tenderPeriod?.endDate;
          const dateB = b.tender?.tenderPeriod?.endDate;
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return new Date(dateA) - new Date(dateB);
        }
        case 'closing-late': {
          const dateA = a.tender?.tenderPeriod?.endDate;
          const dateB = b.tender?.tenderPeriod?.endDate;
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return new Date(dateB) - new Date(dateA);
        }
        default:
          return 0;
      }
    });

    setFilteredTenders(result);
  }, [matchedTenders, filters]);

  // Smart matching algorithm
  const matchTendersToProfile = (tenders, profile) => {
    if (!profile || !tenders || tenders.length === 0) return [];

    const scores = {};
    
    console.log('Matching tenders to profile:', profile);
    
    // Extract profile data for matching using robust extraction with correct paths
    const industry = extractProfileField(profile, [
      'startup.industry',
      'profile.industry_sectors',
      'company.industry', 
      'industry'
    ]) || '';
    
    const services = extractProfileField(profile, [
      'startup.key_products_services',
      'profile.skills',
      'company.services', 
      'services'
    ]) || '';
    
    const interests = extractProfileField(profile, [
      'profile.interests',
      'interests'
    ]) || '';
    
    const bio = extractProfileField(profile, [
      'profile.bio',
      'bio',
      'startup.description',
      'description'
    ]) || '';
    
    // Combine all text for keyword extraction
    const allProfileText = `${industry} ${services} ${interests} ${bio}`;
    
    const profileKeywords = allProfileText
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3) // Filter out short words
      .filter((word, index, self) => self.indexOf(word) === index); // Remove duplicates

    console.log('Extracted keywords:', profileKeywords);

    const profileProvince = extractProfileField(profile, [
      'startup.location',
      'profile.location',
      'company.province', 
      'province', 
      'location'
    ]);
    
    const profileCategories = extractProfileField(profile, [
      'profile.interests',
      'profile.industry_sectors',
      'company.categories', 
      'categories'
    ]) || [];
    
    console.log('Profile province:', profileProvince);
    console.log('Profile categories:', profileCategories);

    // Score each tender
    const scoredTenders = tenders.map(tender => {
      let score = 0;
      const reasons = [];

      // Title and description matching
      const title = (tender.tender?.title || '').toLowerCase();
      const description = (tender.tender?.description || '').toLowerCase();
      const combinedText = `${title} ${description}`;

      profileKeywords.forEach(keyword => {
        if (combinedText.includes(keyword)) {
          score += 10;
          reasons.push(`Matches keyword: ${keyword}`);
        }
      });

      // Province matching
      const tenderProvince = tender.tender?.province;
      if (tenderProvince && profileProvince && tenderProvince === profileProvince) {
        score += 20;
        reasons.push(`Located in ${tenderProvince}`);
      }

      // Category matching
      const tenderCategory = tender.tender?.mainProcurementCategory || tender.tender?.category;
      if (tenderCategory && Array.isArray(profileCategories) && profileCategories.includes(tenderCategory)) {
        score += 30;
        reasons.push(`Category match: ${tenderCategory}`);
      }

      // Closing date preference (favor tenders closing soon but not too soon)
      const endDate = tender.tender?.tenderPeriod?.endDate;
      if (endDate) {
        const daysUntilClose = Math.floor((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysUntilClose > 7 && daysUntilClose < 30) {
          score += 15;
          reasons.push(`Good timeline: ${daysUntilClose} days to close`);
        } else if (daysUntilClose > 0 && daysUntilClose <= 7) {
          score += 5;
          reasons.push(`Closes soon: ${daysUntilClose} days`);
        }
      }

      scores[tender.ocid] = { score, reasons };
      return { ...tender, matchScore: score, matchReasons: reasons };
    });

    // Filter tenders with score > 0 and sort by score
    const matched = scoredTenders
      .filter(tender => tender.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    setMatchingScore(scores);
    
    console.log(`Matched ${matched.length} tenders out of ${tenders.length} total`);
    return matched;
  };

  const handleRetry = () => {
    if (authToken) {
      // Trigger re-fetch by clearing and setting token again
      const token = authToken;
      setAuthToken(null);
      setTimeout(() => setAuthToken(token), 100);
    }
  };

  // Waiting for authentication
  if (isWaitingForAuth && !authToken) {
    return (
      <div className="smart-matched-container">
        <div className="auth-waiting">
          <div className="auth-waiting-content">
            <i className="bi bi-shield-lock" style={{ fontSize: '3rem', color: 'var(--sage-green)' }}></i>
            <h2>Waiting for Authentication</h2>
            <p>Please authenticate through the parent application to view your smart matched tenders.</p>
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="smart-matched-container">
      <header className="smart-matched-header">
        <div className="container">
          <h1 className="smart-matched-title">Smart Matched Tenders</h1>
          <p className="smart-matched-description">
            Hi {getUserDisplayName(profileData)}, we have auto-matched your business profile to tender opportunities.
          </p>
        </div>
      </header>

      <main className="smart-matched-main">
        <div className="container">
          {loading && <LoadingSpinner />}

          {error && !loading && (
            <ErrorMessage message={error} onRetry={handleRetry} />
          )}

          {!loading && !error && profileData && (
            <>
              <div className="profile-summary">
                <div className="profile-summary-header">
                  <i className="bi bi-person-check"></i>
                  <h3>Your Business Profile</h3>
                </div>
                <p className="profile-info">
                  We've analyzed your profile to find the best tender matches. 
                  {getBusinessStrengths(profileData).length > 0 
                    ? 'Here are your key strengths:' 
                    : 'Complete your profile to see your strengths and get better matches.'}
                </p>
                
                {getBusinessStrengths(profileData).length > 0 ? (
                  <div className="business-strengths">
                    {getBusinessStrengths(profileData).map((strength, index) => (
                      <div key={index} className="strength-item">
                        <i className={`bi ${strength.icon}`}></i>
                        <div className="strength-content">
                          <span className="strength-label">{strength.label}</span>
                          <span className="strength-value">{strength.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="profile-incomplete">
                    <i className="bi bi-exclamation-circle"></i>
                    <p>
                      Your profile appears to be incomplete. To get better tender matches, please add:
                      <br/>• Industry or business sector
                      <br/>• Services or products offered
                      <br/>• Business location
                      <br/>• Skills and expertise
                    </p>
                    <button 
                      className="complete-profile-btn"
                      onClick={() => window.parent.postMessage({ type: 'NAVIGATE_TO_PROFILE' }, '*')}
                    >
                      <i className="bi bi-pencil-square"></i>
                      Complete Your Profile
                    </button>
                  </div>
                )}
              </div>

              {matchedTenders.length > 0 && (
                <div className="matching-summary">
                  <div className="summary-icon">
                    <i className="bi bi-graph-up"></i>
                  </div>
                  <div className="summary-content">
                    <h4>Match Analysis Complete</h4>
                    <p>
                      Found <strong>{matchedTenders.length}</strong> tender{matchedTenders.length !== 1 ? 's' : ''} that align with your business profile. 
                      Each tender is scored based on relevance to your industry, location, expertise, and business capabilities.
                    </p>
                    
                    {/* AI Loading State */}
                    {aiLoading && (
                      <div className="ai-loading-notice">
                        <i className="bi bi-stars spinning"></i>
                        <span>AI is analyzing your top matches for deeper insights...</span>
                      </div>
                    )}
                    
                    {/* AI Portfolio Summary */}
                    {aiSummary && !aiLoading && (
                      <div className="ai-portfolio-summary">
                        <div className="ai-summary-header">
                          <i className="bi bi-robot"></i>
                          <span>AI Strategic Insights</span>
                        </div>
                        <p className="ai-summary-text">{aiSummary}</p>
                      </div>
                    )}

                    {/* Progressive Loading Indicator */}
                    {isLoadingMore && (
                      <div className="loading-more-notice">
                        <div className="loading-more-content">
                          <i className="bi bi-arrow-repeat spinning"></i>
                          <span>Loading more opportunities...</span>
                          <div className="progress-bar-container">
                            <div 
                              className="progress-bar-fill" 
                              style={{ width: `${loadingProgress.percentage}%` }}
                            ></div>
                          </div>
                          <span className="progress-text">
                            {loadingProgress.current} of {loadingProgress.total} tenders loaded
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !error && matchedTenders.length > 0 && (
            <div className="smart-filter-bar">
              <div className="filter-header">
                <h3>
                  <i className="bi bi-funnel"></i>
                  Refine Your Matches
                </h3>
                <button 
                  className="reset-filters-btn"
                  onClick={() => setFilters({
                    keywords: '',
                    province: '',
                    category: '',
                    minScore: 0,
                    sortBy: 'score-desc'
                  })}
                >
                  <i className="bi bi-arrow-counterclockwise"></i>
                  Reset Filters
                </button>
              </div>

              <div className="filter-grid">
                <div className="filter-group">
                  <label htmlFor="keywords">
                    <i className="bi bi-search"></i>
                    Additional Keywords
                  </label>
                  <input
                    type="text"
                    id="keywords"
                    placeholder="e.g., construction, software, consulting..."
                    value={filters.keywords}
                    onChange={(e) => setFilters({ ...filters, keywords: e.target.value })}
                  />
                </div>

                <div className="filter-group">
                  <label htmlFor="province">
                    <i className="bi bi-geo-alt"></i>
                    Province
                  </label>
                  <select
                    id="province"
                    value={filters.province}
                    onChange={(e) => setFilters({ ...filters, province: e.target.value })}
                  >
                    <option value="">All Provinces</option>
                    <option value="Eastern Cape">Eastern Cape</option>
                    <option value="Free State">Free State</option>
                    <option value="Gauteng">Gauteng</option>
                    <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                    <option value="Limpopo">Limpopo</option>
                    <option value="Mpumalanga">Mpumalanga</option>
                    <option value="Northern Cape">Northern Cape</option>
                    <option value="North West">North West</option>
                    <option value="Western Cape">Western Cape</option>
                    <option value="National">National</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="category">
                    <i className="bi bi-tag"></i>
                    Category
                  </label>
                  <select
                    id="category"
                    value={filters.category}
                    onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                  >
                    <option value="">All Categories</option>
                    <option value="goods">Goods</option>
                    <option value="services">Services</option>
                    <option value="works">Works</option>
                    <option value="consultingServices">Consulting Services</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="minScore">
                    <i className="bi bi-star"></i>
                    Minimum Match Score: {filters.minScore}
                  </label>
                  <input
                    type="range"
                    id="minScore"
                    min="0"
                    max="100"
                    step="5"
                    value={filters.minScore}
                    onChange={(e) => setFilters({ ...filters, minScore: parseInt(e.target.value) })}
                  />
                </div>

                <div className="filter-group">
                  <label htmlFor="sortBy">
                    <i className="bi bi-sort-down"></i>
                    Sort By
                  </label>
                  <select
                    id="sortBy"
                    value={filters.sortBy}
                    onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
                  >
                    <option value="score-desc">Highest Match Score</option>
                    <option value="score-asc">Lowest Match Score</option>
                    <option value="closing-soon">Closing Soon</option>
                    <option value="closing-late">Closing Later</option>
                  </select>
                </div>
              </div>

              <div className="filter-summary">
                <span className="match-count">
                  <strong>{filteredTenders.length}</strong> of <strong>{matchedTenders.length}</strong> matches shown
                </span>
              </div>
            </div>
          )}

          {!loading && !error && matchedTenders.length === 0 && profileData && (
            <div className="no-matches">
              <div className="no-matches-content">
                <i className="bi bi-search" style={{ fontSize: '3rem', color: 'var(--gray-medium)' }}></i>
                <h3>No Matches Yet</h3>
                <p>
                  We're currently analyzing tenders to find the best matches for your profile.
                  Check back soon or browse all available tenders.
                </p>
                <button 
                  className="browse-all-btn"
                  onClick={() => window.parent.postMessage({ type: 'NAVIGATE_TO_TENDERS' }, '*')}
                >
                  Browse All Tenders
                </button>
              </div>
            </div>
          )}

          {!loading && !error && matchedTenders.length > 0 && filteredTenders.length === 0 && (
            <div className="no-matches">
              <div className="no-matches-content">
                <i className="bi bi-funnel-fill" style={{ fontSize: '3rem', color: 'var(--gray-medium)' }}></i>
                <h3>No Matches with Current Filters</h3>
                <p>
                  Try adjusting your filters to see more results, or reset filters to view all matched tenders.
                </p>
                <button 
                  className="browse-all-btn"
                  onClick={() => setFilters({
                    keywords: '',
                    province: '',
                    category: '',
                    minScore: 0,
                    sortBy: 'score-desc'
                  })}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          )}

          {!loading && !error && filteredTenders.length > 0 && (
            <>
              <div className="tender-grid">
                {filteredTenders.map((tender, index) => (
                  <div key={tender.ocid || tender.id || index} className="matched-tender-wrapper">
                    <div className="match-score-badge">
                      <i className="bi bi-star-fill"></i>
                      <span>{tender.matchScore || 0}</span>
                    </div>
                    
                    {/* AI-Enhanced Match Reasons */}
                    {(() => {
                      const tenderId = tender.ocid || tender.id || `tender-${index}`;
                      const aiInfo = aiAnalysis.get(tenderId);
                      
                      // Show AI analysis if available, otherwise show basic reasons
                      if (aiInfo && aiInfo.reasons && aiInfo.reasons.length > 0) {
                        return (
                          <div className="match-reasons ai-enhanced">
                            <div className="match-reasons-header">
                              <i className="bi bi-stars"></i>
                              <span>AI-Powered Match Analysis:</span>
                              <span className={`ai-confidence confidence-${aiInfo.confidence}`}>
                                {aiInfo.confidence} confidence
                              </span>
                            </div>
                            <ul className="match-reasons-list">
                              {aiInfo.reasons.map((reason, idx) => (
                                <li key={idx}>
                                  <i className="bi bi-arrow-right-short"></i>
                                  {reason}
                                </li>
                              ))}
                            </ul>
                            {aiInfo.recommendation && (
                              <div className="ai-recommendation">
                                <i className="bi bi-lightbulb"></i>
                                <span>{aiInfo.recommendation}</span>
                              </div>
                            )}
                            {aiInfo.concerns && aiInfo.concerns.length > 0 && (
                              <div className="ai-concerns">
                                <i className="bi bi-exclamation-circle"></i>
                                <span>Consider: {aiInfo.concerns.join(', ')}</span>
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      // Fallback to basic match reasons
                      if (tender.matchReasons && tender.matchReasons.length > 0) {
                        return (
                          <div className="match-reasons">
                            <div className="match-reasons-header">
                              <i className="bi bi-check-circle-fill"></i>
                              <span>Why this matches you:</span>
                            </div>
                            <ul className="match-reasons-list">
                              {tender.matchReasons.slice(0, 3).map((reason, idx) => (
                                <li key={idx}>
                                  <i className="bi bi-arrow-right-short"></i>
                                  {reason}
                                </li>
                              ))}
                              {tender.matchReasons.length > 3 && (
                                <li className="more-reasons">
                                  +{tender.matchReasons.length - 3} more reason{tender.matchReasons.length - 3 !== 1 ? 's' : ''}
                                </li>
                              )}
                            </ul>
                          </div>
                        );
                      }
                      
                      return null;
                    })()}
                    
                    <TenderCard tender={tender} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SmartMatchedTenders;
