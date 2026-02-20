import { useState, useEffect } from 'react';
import { fetchTenders } from '../lib/api';
import TenderCard from './TenderCard';
import LoadingSpinner from './LoadingSpinner';
import ErrorMessage from './ErrorMessage';
import './SmartMatchedTenders.css';

const SmartMatchedTenders = () => {
  const [authToken, setAuthToken] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [allTenders, setAllTenders] = useState([]);
  const [matchedTenders, setMatchedTenders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(true);
  const [matchingScore, setMatchingScore] = useState({});

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

        // Fetch public government tenders (last 30 days)
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const tendersData = await fetchTenders({
          page: 1,
          limit: 500,
          dateFrom: thirtyDaysAgo.toISOString().split('T')[0],
          dateTo: today.toISOString().split('T')[0]
        });

        let tenders = [];
        if (tendersData.results) {
          tenders = tendersData.results;
        } else if (tendersData.data) {
          tenders = tendersData.data;
        } else if (Array.isArray(tendersData)) {
          tenders = tendersData;
        }

        setAllTenders(tenders);

        // Smart match tenders based on profile
        const matched = matchTendersToProfile(tenders, profile);
        setMatchedTenders(matched);

      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message || 'Failed to load matched tenders');
      } finally {
        setLoading(false);
      }
    };

    fetchProfileAndTenders();
  }, [authToken]);

  // Smart matching algorithm
  const matchTendersToProfile = (tenders, profile) => {
    if (!profile || !tenders || tenders.length === 0) return [];

    const scores = {};
    
    // Extract profile data for matching
    const profileKeywords = [
      ...(profile.company?.industry || '').toLowerCase().split(/\s+/),
      ...(profile.company?.services || '').toLowerCase().split(/\s+/),
      ...(profile.company?.products || '').toLowerCase().split(/\s+/),
      ...(profile.user?.skills || '').toLowerCase().split(/\s+/),
      ...(profile.user?.expertise || '').toLowerCase().split(/\s+/)
    ].filter(word => word.length > 3); // Filter out short words

    const profileProvince = profile.company?.province || profile.user?.province;
    const profileCategories = profile.company?.categories || [];

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
      if (tenderCategory && profileCategories.includes(tenderCategory)) {
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
            Tenders intelligently matched to your profile, business capabilities, and preferences.
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
            <div className="profile-summary">
              <div className="profile-summary-header">
                <i className="bi bi-person-check"></i>
                <h3>Profile Loaded Successfully</h3>
              </div>
              <p className="profile-info">
                Your profile has been analyzed. Matching algorithm is processing your business information
                to find relevant opportunities.
              </p>
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

          {!loading && !error && matchedTenders.length > 0 && (
            <>
              <div className="matches-header">
                <h2>
                  <i className="bi bi-star-fill"></i>
                  {matchedTenders.length} Tender{matchedTenders.length !== 1 ? 's' : ''} Matched
                </h2>
                <p>Based on your profile, capabilities, and business information</p>
              </div>

              <div className="tender-grid">
                {matchedTenders.map((tender, index) => (
                  <TenderCard key={tender.ocid || tender.id || index} tender={tender} />
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
