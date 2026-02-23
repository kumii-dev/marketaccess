import { useState, useEffect, useRef } from 'react';
import { fetchTenders } from '../lib/api';
import { 
  extractKeywordsFromBio, 
  analyzeTopTendersInBatch, 
  generatePortfolioSummary 
} from '../utils/openaiService';
import { getCachedTenders, cacheTenders, getCacheInfo } from '../utils/tenderCache';
import { 
  getTendersFromIDB, 
  saveTendersToIDB, 
  getAIAnalysisFromIDB, 
  saveAIAnalysisToIDB 
} from '../utils/tenderCacheDB';
import { 
  getTendersFromSupabase, 
  saveTendersToSupabase, 
  getAIKeywordsFromSupabase, 
  saveAIKeywordsToSupabase,
  syncCacheFromSupabase 
} from '../utils/supabaseCache';
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
  const [extractedKeywords, setExtractedKeywords] = useState([]);
  
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

        // � PHASE -1: Sync cache from Supabase on login (cross-device sync)
        console.log('🔄 Syncing cache from Supabase (cross-device)...');
        await syncCacheFromSupabase().catch(err => {
          console.warn('⚠️ Supabase sync failed (will use local cache):', err.message);
        });

        // �🚀 PHASE 0: Check IndexedDB first (fastest - 10-50ms)
        console.log('⚡ Checking IndexedDB cache...');
        const idbTenders = await getTendersFromIDB(dateFrom, dateTo);
        
        if (idbTenders && idbTenders.length > 0) {
          console.log('✅ Using IndexedDB cache - instant load!');
          setAllTenders(idbTenders);
          const matched = matchTendersToProfile(idbTenders, profile);
          setMatchedTenders(matched);
          latestMatchedRef.current = matched;
          setLoading(false);
          
          // Check for cached AI analysis (try IndexedDB first, then Supabase)
          const userId = profile?.profile?.user_id || profile?.user_id;
          if (userId) {
            let cachedAI = await getAIAnalysisFromIDB(userId);
            
            // If not in IndexedDB, try Supabase
            if (!cachedAI || !cachedAI.keywords) {
              console.log('🔍 Checking Supabase for AI keywords...');
              cachedAI = await getAIKeywordsFromSupabase(userId, profile);
            }
            
            if (cachedAI && cachedAI.keywords) {
              console.log('🤖 Using cached AI keywords:', cachedAI.keywords);
              setExtractedKeywords(cachedAI.keywords);
            }
          }
          
          // Enhance with AI if no cached analysis
          if (matched.length > 0 && (!extractedKeywords || extractedKeywords.length === 0)) {
            enhanceWithAI(matched, profile);
          }
          
          // Fetch fresh data in background (stale-while-revalidate)
          console.log('🔄 Fetching fresh data in background...');
          fetchFreshDataInBackground(dateFrom, dateTo, profile);
          return;
        }

        // 🔍 PHASE 0.5: Check Supabase cache (cross-device sync)
        console.log('🔍 Checking Supabase cache (cross-device)...');
        const supabaseTenders = await getTendersFromSupabase(dateFrom, dateTo);
        
        if (supabaseTenders && supabaseTenders.length > 0) {
          console.log('✅ Using Supabase cache - loaded from server!');
          setAllTenders(supabaseTenders);
          const matched = matchTendersToProfile(supabaseTenders, profile);
          setMatchedTenders(matched);
          latestMatchedRef.current = matched;
          setLoading(false);
          
          // Save to session cache for 5min
          cacheTenders(supabaseTenders, dateFrom, dateTo);
          
          // Check for AI keywords from Supabase
          const userId = profile?.profile?.user_id || profile?.user_id;
          if (userId) {
            const cachedAI = await getAIKeywordsFromSupabase(userId, profile);
            if (cachedAI && cachedAI.keywords) {
              console.log('🤖 Using Supabase cached AI keywords');
              setExtractedKeywords(cachedAI.keywords);
            }
          }
          
          // Enhance with AI if no cached analysis
          if (matched.length > 0 && (!extractedKeywords || extractedKeywords.length === 0)) {
            enhanceWithAI(matched, profile);
          }
          
          // Fetch fresh data in background
          console.log('🔄 Fetching fresh data in background...');
          fetchFreshDataInBackground(dateFrom, dateTo, profile);
          return;
        }

        // Check session cache (5min TTL)
        console.log('⚡ Checking session cache...');
        const cachedTenders = getCachedTenders(dateFrom, dateTo);
        const cacheInfo = getCacheInfo();
        
        if (cachedTenders && cachedTenders.length > 0) {
          console.log('⚡ Using session cache:', cacheInfo);
          setAllTenders(cachedTenders);
          const cachedMatched = matchTendersToProfile(cachedTenders, profile);
          setMatchedTenders(cachedMatched);
          setLoading(false);
          
          // Save to IndexedDB for next reload
          await saveTendersToIDB(cachedTenders, dateFrom, dateTo);
          
          // Still enhance with AI in background
          if (cachedMatched.length > 0) {
            enhanceWithAI(cachedMatched, profile);
          }
          return; // Skip fetching
        }

        // PHASE 1: Quick initial load (10 tenders)
        console.log('🚀 Phase 1: Loading initial 10 tenders...');
        const initialData = await fetchTenders({
          page: 1,
          limit: 10,
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
          latestMatchedRef.current = initialMatched; // Store for AI enhancement
          setLoadingProgress({ current: 10, total: 100, percentage: 10 });
          
          console.log(`✅ Initial ${initialTenders.length} tenders loaded and matched`);
          
          // Start AI enhancement immediately with first 10 tenders
          if (initialMatched.length > 0) {
            console.log('🤖 Starting early AI enhancement with initial tenders...');
            enhanceWithAI(initialMatched, profile);
          }
        }

        // Initial loading complete - user can see results now
        setLoading(false);

        // PHASE 2: Progressive background loading (90 more tenders in batches of 10)
        console.log('🔄 Phase 2: Loading additional tenders in background...');
        setIsLoadingMore(true);
        
        const batches = [
          { page: 2, limit: 10 },  // 11-20
          { page: 3, limit: 10 },  // 21-30
          { page: 4, limit: 10 },  // 31-40
          { page: 5, limit: 10 },  // 41-50
          { page: 6, limit: 10 },  // 51-60
          { page: 7, limit: 10 },  // 61-70
          { page: 8, limit: 10 },  // 71-80
          { page: 9, limit: 10 },  // 81-90
          { page: 10, limit: 10 }  // 91-100
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
              // Append new tenders and get the updated matched tenders
              let updatedMatched = [];
              setAllTenders(prev => {
                // Deduplicate: filter out tenders that already exist (by ocid or id)
                const existingIds = new Set(
                  prev.map(t => t.ocid || t.id).filter(Boolean)
                );
                const newTenders = batchTenders.filter(t => {
                  const tenderId = t.ocid || t.id;
                  return tenderId && !existingIds.has(tenderId);
                });
                
                const combined = [...prev, ...newTenders];
                console.log(`📦 Batch ${i + 1}: ${batchTenders.length} fetched, ${newTenders.length} new (${existingIds.size} duplicates filtered)`);
                
                // Re-match with all tenders so far
                const newMatched = matchTendersToProfile(combined, profile);
                setMatchedTenders(newMatched);
                
                // Update ref with latest matches
                latestMatchedRef.current = newMatched;
                updatedMatched = newMatched;
                
                // Cache the combined result after last batch
                if (i === batches.length - 1) {
                  cacheTenders(combined, dateFrom, dateTo);
                  
                  // Save to IndexedDB for persistent cache
                  saveTendersToIDB(combined, dateFrom, dateTo).then(() => {
                    console.log('💾 Saved all tenders to IndexedDB for next reload');
                  });
                  
                  // Save to Supabase for cross-device sync
                  saveTendersToSupabase(combined, dateFrom, dateTo).then(() => {
                    console.log('☁️ Saved all tenders to Supabase for cross-device sync');
                  }).catch(err => {
                    console.warn('⚠️ Failed to save to Supabase (local cache still available):', err.message);
                  });
                }
                
                return combined;
              });

              const currentCount = 10 + (i + 1) * 10;
              const percentage = Math.round((currentCount / 100) * 100);
              setLoadingProgress({ current: currentCount, total: 100, percentage });
              
              console.log(`📦 Batch ${i + 1}/9 loaded: +${batchTenders.length} tenders (Total: ${currentCount})`);
              
              // Run AI enhancement on batches 1, 3, 5, 7, and 9 (every other batch + last)
              const batchNumber = i + 1;
              const shouldRunAI = batchNumber === 1 || batchNumber === 3 || batchNumber === 5 || batchNumber === 7 || batchNumber === 9;
              
              if (shouldRunAI && updatedMatched.length > 0) {
                console.log(`🤖 Running AI enhancement for batch ${batchNumber}/9 with ${updatedMatched.length} matched tenders`);
                enhanceWithAI(updatedMatched, profile);
              } else if (updatedMatched.length > 0) {
                console.log(`⏭️ Skipping AI enhancement for batch ${batchNumber}/9 (will run on batches 1,3,5,7,9)`);
              }
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
        console.log('🎯 AI enhancement ran after each batch - all done!');

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
  
  // Background fetch function for stale-while-revalidate pattern
  const fetchFreshDataInBackground = async (dateFrom, dateTo, profile) => {
    try {
      console.log('🔄 Background refresh: Fetching latest tenders...');
      
      // Fetch first 100 tenders (10 pages)
      const freshData = await fetchTenders({
        page: 1,
        limit: 100,
        dateFrom,
        dateTo
      });

      let freshTenders = [];
      if (freshData.results) {
        freshTenders = freshData.results;
      } else if (freshData.data) {
        freshTenders = freshData.data;
      } else if (Array.isArray(freshData)) {
        freshTenders = freshData;
      }

      if (freshTenders.length > 0) {
        // Update caches
        await saveTendersToIDB(freshTenders, dateFrom, dateTo);
        cacheTenders(freshTenders, dateFrom, dateTo);
        
        // Check if data changed significantly
        const currentCount = allTenders.length;
        const newCount = freshTenders.length;
        
        if (Math.abs(newCount - currentCount) > 5) {
          console.log(`✅ Background refresh complete: ${newCount} tenders (was ${currentCount})`);
          // Could show a toast notification here: "New tenders available"
        } else {
          console.log(`✅ Background refresh complete: No significant changes`);
        }
      }
    } catch (err) {
      console.warn('⚠️ Background refresh failed (using cached data):', err.message);
      // Fail silently - user already has cached data
    }
  };
  
  const enhanceWithAI = async (tenders, profile) => {
    try {
      setAiLoading(true);
      console.log('🤖 Starting AI enhancement with keyword-based analysis...');

      // Step 1: Collect ALL available data from 4 levels for richer insights
      console.log('📊 Collecting comprehensive profile data from all sources...');
      
      // Level 1: User bio/description
      const userBio = profile?.profile?.bio || profile?.bio || '';
      
      // Level 2: Startup description
      const startupDesc = profile?.startup?.description || profile?.description || '';
      
      // Level 3: Structured profile fields
      const industry = profile?.startup?.industry || profile?.profile?.industry_sectors || '';
      const skills = profile?.profile?.skills || [];
      const interests = profile?.profile?.interests || [];
      const location = profile?.startup?.location || profile?.profile?.location || '';
      const companyName = profile?.startup?.name || profile?.company?.name || '';
      const stage = profile?.startup?.stage || '';
      
      // Level 4: Additional context
      const keyProducts = profile?.startup?.key_products_services || '';
      const targetMarket = profile?.startup?.target_market || '';
      
      // Combine ALL available data for maximum AI insight
      const combinedData = {
        bio: userBio.trim(),
        startupDescription: startupDesc.trim(),
        industry: industry,
        skills: Array.isArray(skills) ? skills : [],
        interests: Array.isArray(interests) ? interests : [],
        location: location,
        companyName: companyName,
        stage: stage,
        keyProducts: keyProducts,
        targetMarket: targetMarket
      };
      
      // Build rich text combining all sources
      const richText = [
        combinedData.bio,
        combinedData.startupDescription,
        combinedData.industry,
        combinedData.skills.join(' '),
        combinedData.interests.join(' '),
        combinedData.keyProducts,
        combinedData.targetMarket,
        `Located in ${combinedData.location}`,
        combinedData.stage ? `Business stage: ${combinedData.stage}` : ''
      ].filter(text => text && text.trim().length > 0).join('. ');
      
      if (!richText || richText.trim().length === 0) {
        console.warn('⚠️ No profile data available from any source, skipping AI analysis');
        setAiLoading(false);
        return;
      }

      console.log('✅ Rich profile data collected:', {
        hasBio: !!combinedData.bio,
        hasStartupDesc: !!combinedData.startupDescription,
        hasIndustry: !!combinedData.industry,
        skillsCount: combinedData.skills.length,
        interestsCount: combinedData.interests.length,
        hasLocation: !!combinedData.location,
        totalTextLength: richText.length
      });
      
      console.log('📝 Extracting keywords from comprehensive profile data...');
      console.log('Using combined data:', richText.substring(0, 150) + '...');
      
      const keywords = await extractKeywordsFromBio(richText, profile, combinedData);
      
      if (!keywords || keywords.length === 0) {
        console.warn('⚠️ No keywords extracted, skipping AI enhancement');
        setAiLoading(false);
        return;
      }

      setExtractedKeywords(keywords);
      console.log('✅ Keywords extracted:', keywords);
      
      // Save keywords to IndexedDB cache
      const userId = profile?.profile?.user_id || profile?.user_id;
      if (userId) {
        saveAIAnalysisToIDB(userId, keywords, {}).then(() => {
          console.log('💾 Saved AI keywords to IndexedDB');
        });
        
        // Also save to Supabase for cross-device sync
        saveAIKeywordsToSupabase(userId, keywords, {}, profile).then(() => {
          console.log('☁️ Saved AI keywords to Supabase for cross-device sync');
        }).catch(err => {
          console.warn('⚠️ Failed to save AI keywords to Supabase:', err.message);
        });
      }

      // Step 2: Analyze top tenders using keywords (process in batches)
      const analysisResults = new Map();
      
      // Split tenders into batches of 10
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < tenders.length; i += batchSize) {
        batches.push(tenders.slice(i, i + batchSize));
      }

      console.log(`📊 Processing ${batches.length} batches (${tenders.length} total tenders)`);

      // Process each batch (analyzing top 2 per batch)
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`\n📦 Batch ${i + 1}/${batches.length} (${batch.length} tenders)`);
        
        const batchAnalysis = await analyzeTopTendersInBatch(batch, keywords, profile);
        
        // Merge results
        batchAnalysis.forEach((value, key) => {
          analysisResults.set(key, value);
        });

        // Delay between batches to respect rate limits (reduced from 1000ms to 300ms for faster processing)
        if (i < batches.length - 1) {
          console.log('⏳ Waiting before next batch...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setAiAnalysis(analysisResults);
      console.log(`✅ AI analysis complete: ${analysisResults.size} tenders analyzed`);

      // Step 3: Generate portfolio summary
      console.log('📊 Generating portfolio summary...');
      const summary = await generatePortfolioSummary(tenders, profile);
      setAiSummary(summary);

      console.log('🎉 AI enhancement complete:', {
        keywordsExtracted: keywords.length,
        tendersAnalyzed: analysisResults.size,
        hasSummary: !!summary
      });
    } catch (err) {
      console.error('❌ AI enhancement error:', err);
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

    // ✅ STEP 1: Deduplicate input tenders by ocid or id
    const uniqueTenders = [];
    const seenIds = new Set();
    
    for (const tender of tenders) {
      const tenderId = tender.ocid || tender.id;
      if (tenderId && !seenIds.has(tenderId)) {
        seenIds.add(tenderId);
        uniqueTenders.push(tender);
      } else if (!tenderId) {
        // Keep tenders without ID (rare, but handle gracefully)
        uniqueTenders.push(tender);
      }
    }
    
    if (uniqueTenders.length < tenders.length) {
      console.log(`🔍 Deduplication: ${tenders.length} tenders → ${uniqueTenders.length} unique (${tenders.length - uniqueTenders.length} duplicates removed)`);
    }

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
    
    // List of common prepositions to exclude from matching
    const prepositions = new Set([
      'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at',
      'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by',
      'despite', 'down', 'during', 'except', 'for', 'from', 'in', 'inside', 'into',
      'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past',
      'since', 'through', 'towards', 'campus', 'team', 'throughout', 'till', 'to', 'toward', 'under', 'underneath',
      'until', 'up', 'upon', 'with', 'within', 'without'
    ]);
    
    const profileKeywords = allProfileText
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3) // Filter out short words
      .filter(word => !prepositions.has(word)) // Exclude prepositions
      .filter((word, index, self) => self.indexOf(word) === index); // Remove duplicates

    console.log('Extracted keywords (prepositions filtered):', profileKeywords);

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
    
    // Extended category fallbacks: Map business keywords/terms to tender categories
    const categoryFallbacks = {
      // Legacy backward compatibility
      'goods': ['Manufacturing', 'Supplies: General', 'Supplies: Computer Equipment', 'Supplies: Electrical Equipment', 'Supplies: Medical', 'Supplies: Perishable Provisions', 'Supplies: Stationery/Printing', 'Supplies: Clothing/Textiles/Footwear', 'Other manufacturing'],
      'services': ['Professional, scientific and technical activities', 'Services: General', 'Services: Professional', 'Services: Building', 'Services: Civil', 'Services: Electrical', 'Services: Functional (Including Cleaning and Security Services)', 'Administrative and support activities', 'Information and communication', 'Other service activities'],
      'works': ['Construction', 'Construction of buildings', 'Civil engineering', 'Specialised construction activities', 'Services: Building', 'Services: Civil'],
      'consultingServices': ['Activities of head offices; management consultancy activities', 'Professional, scientific and technical activities', 'Services: Professional', 'Other professional, scientific and technical activities'],
      
      // Technology & IT
      'technology': ['Computer programming, consultancy and related activities', 'Information and communication', 'Telecommunications', 'Information service activities', 'Manufacture of computer, electronic and optical products'],
      'software': ['Computer programming, consultancy and related activities', 'Information and communication', 'Information service activities'],
      'it': ['Computer programming, consultancy and related activities', 'Information and communication', 'Telecommunications', 'Supplies: Computer Equipment'],
      'computer': ['Computer programming, consultancy and related activities', 'Manufacture of computer, electronic and optical products', 'Supplies: Computer Equipment'],
      'programming': ['Computer programming, consultancy and related activities', 'Information service activities'],
      'telecommunications': ['Telecommunications', 'Information and communication'],
      
      // Construction & Engineering
      'construction': ['Construction', 'Construction of buildings', 'Civil engineering', 'Specialised construction activities', 'Services: Building', 'Services: Civil'],
      'building': ['Construction of buildings', 'Services: Building', 'Specialised construction activities'],
      'civil': ['Civil engineering', 'Services: Civil'],
      'engineering': ['Architectural and engineering activities; technical testing and analysis', 'Civil engineering', 'Services: Civil', 'Services: Building'],
      'architecture': ['Architectural and engineering activities; technical testing and analysis', 'Professional, scientific and technical activities'],
      'electrical': ['Manufacture of electrical equipment', 'Services: Electrical', 'Supplies: Electrical Equipment'],
      
      // Manufacturing & Production
      'manufacturing': ['Manufacturing', 'Other manufacturing'],
      'production': ['Manufacturing', 'Other manufacturing'],
      'metal': ['Manufacture of basic metals', 'Manufacture of fabricated metal products, except machinery and equipment'],
      'steel': ['Manufacture of basic metals', 'Manufacture of fabricated metal products, except machinery and equipment'],
      'machinery': ['Manufacture of machinery and equipment n.e.c.', 'Repair and installation of machinery and equipment'],
      'automotive': ['Manufacture of motor vehicles, trailers and semi-trailers', 'Wholesale and retail trade and repair of motor vehicles and motorcycles'],
      'vehicles': ['Manufacture of motor vehicles, trailers and semi-trailers', 'Wholesale and retail trade and repair of motor vehicles and motorcycles'],
      'furniture': ['Manufacture of furniture'],
      'textiles': ['Manufacture of textiles', 'Supplies: Clothing/Textiles/Footwear'],
      'clothing': ['Supplies: Clothing/Textiles/Footwear', 'Manufacture of textiles'],
      'chemical': ['Manufacture of chemicals and chemical products'],
      'pharmaceutical': ['Manufacture of chemicals and chemical products', 'Supplies: Medical'],
      'plastics': ['Manufacture of rubber and plastics products'],
      'rubber': ['Manufacture of rubber and plastics products'],
      'paper': ['Manufacture of paper and paper products', 'Printing and reproduction of recorded media'],
      
      // Healthcare & Medical
      'health': ['Human health activities', 'Human health and social work activities', 'Supplies: Medical'],
      'healthcare': ['Human health activities', 'Human health and social work activities', 'Supplies: Medical'],
      'medical': ['Supplies: Medical', 'Human health activities', 'Manufacture of chemicals and chemical products'],
      'hospital': ['Human health activities', 'Supplies: Medical'],
      
      // Professional Services
      'consulting': ['Activities of head offices; management consultancy activities', 'Services: Professional', 'Professional, scientific and technical activities'],
      'legal': ['Legal and accounting activities', 'Professional, scientific and technical activities'],
      'accounting': ['Legal and accounting activities', 'Professional, scientific and technical activities'],
      'financial': ['Financial and insurance activities', 'Financial service activities, except insurance and pension funding'],
      'insurance': ['Insurance, reinsurance and pension funding, except compulsory social security', 'Financial and insurance activities'],
      'management': ['Activities of head offices; management consultancy activities', 'Office administrative, office support and other business support activities'],
      'research': ['Scientific research and development', 'Professional, scientific and technical activities', 'Other professional, scientific and technical activities'],
      
      // Education & Training
      'education': ['Education'],
      'training': ['Education', 'Other professional, scientific and technical activities'],
      
      // Transport & Logistics
      'transport': ['Transportation and storage', 'Land transport and transport via pipelines', 'Air transport', 'Water transport'],
      'logistics': ['Transportation and storage', 'Warehousing and support activities for transportation'],
      'shipping': ['Water transport', 'Warehousing and support activities for transportation'],
      'freight': ['Transportation and storage', 'Warehousing and support activities for transportation'],
      'warehousing': ['Warehousing and support activities for transportation', 'Transportation and storage'],
      
      // Energy & Utilities
      'energy': ['Electricity, gas, steam and air conditioning', 'Manufacture of coke and refined petroleum products'],
      'electricity': ['Electricity, gas, steam and air conditioning'],
      'power': ['Electricity, gas, steam and air conditioning'],
      'water': ['Water collection, treatment and supply', 'Water supply; sewerage, waste management and remediation activities'],
      'waste': ['Waste collection, treatment and disposal activities; materials recovery', 'Water supply; sewerage, waste management and remediation activities'],
      'sewerage': ['Sewerage', 'Water supply; sewerage, waste management and remediation activities'],
      'environmental': ['Remediation activities and other waste management services', 'Water supply; sewerage, waste management and remediation activities'],
      
      // Mining & Resources
      'mining': ['Mining and quarrying', 'Mining of coal and lignite', 'Mining support service activities'],
      'coal': ['Mining of coal and lignite', 'Mining and quarrying'],
      'quarrying': ['Mining and quarrying'],
      
      // Media & Entertainment
      'media': ['Motion picture, video and television programme production, sound recording and music publishing activities', 'Programming and broadcasting activities', 'Publishing activities'],
      'entertainment': ['Arts, entertainment and recreation', 'Creative, arts and entertainment activities', 'Sports activities and amusement and recreation activities'],
      'broadcasting': ['Programming and broadcasting activities', 'Information and communication'],
      'publishing': ['Publishing activities', 'Printing and reproduction of recorded media'],
      'printing': ['Printing and reproduction of recorded media', 'Supplies: Stationery/Printing'],
      
      // Accommodation & Food
      'accommodation': ['Accommodation'],
      'hotel': ['Accommodation'],
      'tourism': ['Accommodation', 'Travel agency, tour operator, reservation service and related activities'],
      'travel': ['Travel agency, tour operator, reservation service and related activities', 'Air transport'],
      'food': ['Food and beverage service activities', 'Supplies: Perishable Provisions'],
      'catering': ['Food and beverage service activities', 'Supplies: Perishable Provisions'],
      
      // Facilities & Support Services
      'security': ['Security and investigation activities', 'Services: Functional (Including Cleaning and Security Services)'],
      'cleaning': ['Services to buildings and landscape activities', 'Services: Functional (Including Cleaning and Security Services)'],
      'maintenance': ['Services to buildings and landscape activities', 'Repair and installation of machinery and equipment'],
      'facilities': ['Services to buildings and landscape activities', 'Services: Functional (Including Cleaning and Security Services)'],
      'landscaping': ['Services to buildings and landscape activities'],
      
      // Real Estate & Rental
      'property': ['Real estate activities'],
      'realestate': ['Real estate activities'],
      'rental': ['Rental and leasing activities'],
      'leasing': ['Rental and leasing activities'],
      
      // Marketing & Advertising
      'marketing': ['Advertising and market research', 'Other professional, scientific and technical activities'],
      'advertising': ['Advertising and market research'],
      
      // Agriculture
      'agriculture': ['Agricultural Products and Services'],
      'farming': ['Agricultural Products and Services'],
      'agri': ['Agricultural Products and Services'],
      
      // Administrative & HR
      'administrative': ['Administrative and support activities', 'Office administrative, office support and other business support activities'],
      'hr': ['Employment activities', 'Administrative and support activities'],
      'recruitment': ['Employment activities', 'Administrative and support activities'],
      'employment': ['Employment activities'],
      
      // Supplies
      'stationery': ['Supplies: Stationery/Printing'],
      'office': ['Supplies: Stationery/Printing', 'Office administrative, office support and other business support activities'],
      'medical supplies': ['Supplies: Medical'],
      'equipment': ['Supplies: General', 'Supplies: Computer Equipment', 'Supplies: Electrical Equipment'],
      
      // Social & Care
      'social': ['Human health and social work activities', 'Residential care activities'],
      'care': ['Residential care activities', 'Human health and social work activities'],
      'domestic': ['Activities of households as employers of domestic personnel'],
      
      // Cultural
      'cultural': ['Libraries, archives, museums and other cultural activities', 'Arts, entertainment and recreation'],
      'museum': ['Libraries, archives, museums and other cultural activities'],
      'library': ['Libraries, archives, museums and other cultural activities'],
      'arts': ['Creative, arts and entertainment activities', 'Arts, entertainment and recreation'],
      'sports': ['Sports activities and amusement and recreation activities'],
      
      // Communication
      'postal': ['Postal and courier activities'],
      'courier': ['Postal and courier activities']
    };
    
    // Expand profile categories with fallbacks
    const expandedProfileCategories = new Set([...profileCategories]);
    
    // 1. Direct category expansion (backward compatibility)
    profileCategories.forEach(cat => {
      const catLower = (cat || '').toLowerCase();
      if (categoryFallbacks[catLower]) {
        categoryFallbacks[catLower].forEach(c => expandedProfileCategories.add(c));
      }
    });
    
    // 2. Keyword-based category expansion (NEW: map profile keywords to categories)
    profileKeywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      if (categoryFallbacks[keywordLower]) {
        categoryFallbacks[keywordLower].forEach(c => expandedProfileCategories.add(c));
      }
    });
    
    // 3. Partial keyword matching for compound terms (e.g., "software development" → "software")
    profileKeywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      Object.keys(categoryFallbacks).forEach(fallbackKey => {
        if (keywordLower.includes(fallbackKey) || fallbackKey.includes(keywordLower)) {
          categoryFallbacks[fallbackKey].forEach(c => expandedProfileCategories.add(c));
        }
      });
    });
    
    // Convert Set back to Array for matching
    const expandedCategoriesArray = Array.from(expandedProfileCategories);
    
    console.log('Profile province:', profileProvince);
    console.log('Profile categories (original):', profileCategories);
    console.log('Profile keywords:', profileKeywords.slice(0, 20)); // Show first 20
    console.log('Profile categories (expanded from keywords):', expandedCategoriesArray.length, 'categories');
    console.log('Sample expanded categories:', expandedCategoriesArray.slice(0, 10));

    // Score each tender (using deduplicated list)
    const scoredTenders = uniqueTenders.map(tender => {
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

      // Category matching (with backward compatibility for old categories)
      const tenderCategory = tender.tender?.mainProcurementCategory || tender.tender?.category;
      if (tenderCategory && expandedCategoriesArray.length > 0 && expandedCategoriesArray.includes(tenderCategory)) {
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
    
    console.log(`✅ Matched ${matched.length} unique tenders out of ${uniqueTenders.length} total`);
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
                
                {/* AI-Extracted Keywords Display */}
                {extractedKeywords.length > 0 && (
                  <div className="extracted-keywords-section">
                    <div className="keywords-header">
                      <i className="bi bi-stars"></i>
                      <span>AI-Extracted Keywords from Your Profile:</span>
                    </div>
                    <div className="keywords-list">
                      {extractedKeywords.map((keyword, index) => (
                        <span key={index} className="keyword-badge">
                          <i className="bi bi-tag-fill"></i>
                          {keyword}
                        </span>
                      ))}
                    </div>
                    <p className="keywords-description">
                      These keywords are used to match you with relevant tenders
                    </p>
                  </div>
                )}
                
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
                    <option value="Accommodation">Accommodation</option>
                    <option value="Activities auxiliary to financial service and insurance activities.">Activities auxiliary to financial service and insurance activities.</option>
                    <option value="Activities of head offices; management consultancy activities">Activities of head offices; management consultancy activities</option>
                    <option value="Activities of households as employers of domestic personnel">Activities of households as employers of domestic personnel</option>
                    <option value="Administrative and support activities">Administrative and support activities</option>
                    <option value="Advertising and market research">Advertising and market research</option>
                    <option value="Agricultural Products and Services">Agricultural Products and Services</option>
                    <option value="Air transport">Air transport</option>
                    <option value="Architectural and engineering activities; technical testing and analysis">Architectural and engineering activities; technical testing and analysis</option>
                    <option value="Arts, entertainment and recreation">Arts, entertainment and recreation</option>
                    <option value="Civil engineering">Civil engineering</option>
                    <option value="Computer programming, consultancy and related activities">Computer programming, consultancy and related activities</option>
                    <option value="Construction">Construction</option>
                    <option value="Construction of buildings">Construction of buildings</option>
                    <option value="Creative, arts and entertainment activities">Creative, arts and entertainment activities</option>
                    <option value="Disposals: General">Disposals: General</option>
                    <option value="Education">Education</option>
                    <option value="Electricity, gas, steam and air conditioning">Electricity, gas, steam and air conditioning</option>
                    <option value="Employment activities">Employment activities</option>
                    <option value="Financial and insurance activities">Financial and insurance activities</option>
                    <option value="Financial service activities, except insurance and pension funding">Financial service activities, except insurance and pension funding</option>
                    <option value="Food and beverage service activities">Food and beverage service activities</option>
                    <option value="Human health activities">Human health activities</option>
                    <option value="Human health and social work activities">Human health and social work activities</option>
                    <option value="Information and communication">Information and communication</option>
                    <option value="Information service activities">Information service activities</option>
                    <option value="Insurance, reinsurance and pension funding, except compulsory social security">Insurance, reinsurance and pension funding, except compulsory social security</option>
                    <option value="Land transport and transport via pipelines">Land transport and transport via pipelines</option>
                    <option value="Legal and accounting activities">Legal and accounting activities</option>
                    <option value="Libraries, archives, museums and other cultural activities">Libraries, archives, museums and other cultural activities</option>
                    <option value="Manufacture of basic metals">Manufacture of basic metals</option>
                    <option value="Manufacture of chemicals and chemical products">Manufacture of chemicals and chemical products</option>
                    <option value="Manufacture of coke and refined petroleum products">Manufacture of coke and refined petroleum products</option>
                    <option value="Manufacture of computer, electronic and optical products">Manufacture of computer, electronic and optical products</option>
                    <option value="Manufacture of electrical equipment">Manufacture of electrical equipment</option>
                    <option value="Manufacture of fabricated metal products, except machinery and equipment">Manufacture of fabricated metal products, except machinery and equipment</option>
                    <option value="Manufacture of furniture">Manufacture of furniture</option>
                    <option value="Manufacture of machinery and equipment n.e.c.">Manufacture of machinery and equipment n.e.c.</option>
                    <option value="Manufacture of motor vehicles, trailers and semi-trailers">Manufacture of motor vehicles, trailers and semi-trailers</option>
                    <option value="Manufacture of other non-metallic mineral products">Manufacture of other non-metallic mineral products</option>
                    <option value="Manufacture of paper and paper products">Manufacture of paper and paper products</option>
                    <option value="Manufacture of rubber and plastics products">Manufacture of rubber and plastics products</option>
                    <option value="Manufacture of textiles">Manufacture of textiles</option>
                    <option value="Manufacturing">Manufacturing</option>
                    <option value="Mining and quarrying">Mining and quarrying</option>
                    <option value="Mining of coal and lignite">Mining of coal and lignite</option>
                    <option value="Mining support service activities">Mining support service activities</option>
                    <option value="Motion picture, video and television programme production, sound recording and music publishing activities">Motion picture, video and television programme production, sound recording and music publishing activities</option>
                    <option value="Office administrative, office support and other business support activities">Office administrative, office support and other business support activities</option>
                    <option value="Other manufacturing">Other manufacturing</option>
                    <option value="Other personal service activities">Other personal service activities</option>
                    <option value="Other professional, scientific and technical activities">Other professional, scientific and technical activities</option>
                    <option value="Other service activities">Other service activities</option>
                    <option value="Postal and courier activities">Postal and courier activities</option>
                    <option value="Printing and reproduction of recorded media">Printing and reproduction of recorded media</option>
                    <option value="Professional, scientific and technical activities">Professional, scientific and technical activities</option>
                    <option value="Programming and broadcasting activities">Programming and broadcasting activities</option>
                    <option value="Publishing activities">Publishing activities</option>
                    <option value="Real estate activities">Real estate activities</option>
                    <option value="Remediation activities and other waste management services">Remediation activities and other waste management services</option>
                    <option value="Rental and leasing activities">Rental and leasing activities</option>
                    <option value="Repair and installation of machinery and equipment">Repair and installation of machinery and equipment</option>
                    <option value="Residential care activities">Residential care activities</option>
                    <option value="Scientific research and development">Scientific research and development</option>
                    <option value="Security and investigation activities">Security and investigation activities</option>
                    <option value="Services to buildings and landscape activities">Services to buildings and landscape activities</option>
                    <option value="Services: Building">Services: Building</option>
                    <option value="Services: Civil">Services: Civil</option>
                    <option value="Services: Electrical">Services: Electrical</option>
                    <option value="Services: Functional (Including Cleaning and Security Services)">Services: Functional (Including Cleaning and Security Services)</option>
                    <option value="Services: General">Services: General</option>
                    <option value="Services: Professional">Services: Professional</option>
                    <option value="Sewerage">Sewerage</option>
                    <option value="Specialised construction activities">Specialised construction activities</option>
                    <option value="Sports activities and amusement and recreation activities">Sports activities and amusement and recreation activities</option>
                    <option value="Supplies: Clothing/Textiles/Footwear">Supplies: Clothing/Textiles/Footwear</option>
                    <option value="Supplies: Computer Equipment">Supplies: Computer Equipment</option>
                    <option value="Supplies: Electrical Equipment">Supplies: Electrical Equipment</option>
                    <option value="Supplies: General">Supplies: General</option>
                    <option value="Supplies: Medical">Supplies: Medical</option>
                    <option value="Supplies: Perishable Provisions">Supplies: Perishable Provisions</option>
                    <option value="Supplies: Stationery/Printing">Supplies: Stationery/Printing</option>
                    <option value="Telecommunications">Telecommunications</option>
                    <option value="Transportation and storage">Transportation and storage</option>
                    <option value="Travel agency, tour operator, reservation service and related activities">Travel agency, tour operator, reservation service and related activities</option>
                    <option value="Warehousing and support activities for transportation">Warehousing and support activities for transportation</option>
                    <option value="Waste collection, treatment and disposal activities; materials recovery">Waste collection, treatment and disposal activities; materials recovery</option>
                    <option value="Water collection, treatment and supply">Water collection, treatment and supply</option>
                    <option value="Water supply; sewerage, waste management and remediation activities">Water supply; sewerage, waste management and remediation activities</option>
                    <option value="Water transport">Water transport</option>
                    <option value="Wholesale and retail trade and repair of motor vehicles and motorcycles">Wholesale and retail trade and repair of motor vehicles and motorcycles</option>
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
                {filteredTenders.map((tender, index) => {
                  // Generate stable unique key (prefer ocid/id, fallback to combo)
                  const tenderKey = tender.ocid || tender.id || `tender-${tender.tender?.title}-${index}`;
                  
                  return (
                    <div key={tenderKey} className="matched-tender-wrapper">
                      <div className="match-score-badge">
                        <i className="bi bi-star-fill"></i>
                        <span>{tender.matchScore || 0}</span>
                      </div>
                      
                      {/* AI-Enhanced Match Reasons */}
                      {(() => {
                        const tenderId = tender.ocid || tender.id || tenderKey;
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
                            
                            {/* Show matched keywords if available */}
                            {aiInfo.keywordMatches && aiInfo.keywordMatches.length > 0 && (
                              <div className="keyword-matches">
                                <span className="keyword-matches-label">
                                  <i className="bi bi-check2-circle"></i>
                                  Matched Keywords:
                                </span>
                                <div className="matched-keywords-list">
                                  {aiInfo.keywordMatches.map((keyword, idx) => (
                                    <span key={idx} className="matched-keyword">
                                      {keyword}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            
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
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SmartMatchedTenders;
