import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const _require   = createRequire(import.meta.url);

// 📦 Static fallback snapshot — served when eTenders gov API is unavailable
const FALLBACK_SNAPSHOT = _require(path.join(__dirname, '../src/etender/01112025.json'));
import { 
  generalApiLimiter, 
  authLimiter, // TODO: Apply to /api/auth/* endpoints when implemented
  rateLimitCostEstimate 
} from './middleware/rateLimiters.js';
import aiRoutes from './routes/ai.js';
import auditRoutes from './routes/audit.js';
import auditAIRoutes from './routes/auditAI.js';
import tenderDocsRouter from './routes/tenderDocs.js';
import emailRoutes, { dispatchDigest } from './routes/email.js';
import { syncActiveTenders, getActiveTenders, getSyncStatus, inferProvince } from './services/tenderSync.js';

// ── Province enrichment ───────────────────────────────────────────────────────
// The eTenders OCDS API omits a `tender.province` field.  This helper derives
// it from `buyer.name` and injects it so client-side province filters work.
function enrichWithProvince(release) {
  if (!release) return release;
  if (release.tender?.province) return release; // already set
  const prov = inferProvince(release.buyer?.name);
  if (!prov) return release;
  return { ...release, tender: { ...release.tender, province: prov } };
}

const app = express();
const PORT = process.env.PORT || 3001;

// 🔒 SECURITY: Configure CORS (TODO: Whitelist specific origins in production)
app.use(cors({
  origin: '*', // ⚠️ WARNING: Allow all origins (change in production)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-API-Key', 'X-Application', 'X-Batch-Size'],
  credentials: false
}));

app.use(express.json({ limit: '1mb' })); // Audit batches can be ~100 entries

// 🔒 SECURITY: Apply general rate limiting to all API routes
app.use('/api/', generalApiLimiter);

// 🔒 SECURITY: Mount AI routes with specific rate limiters
app.use('/api/ai', aiRoutes);

// 🤖 AI AUDIT INTELLIGENCE: Threat summary, anomaly detection, compliance reports
app.use('/api/ai/audit', auditAIRoutes);

// 📄 TENDER DOCS: Server-side document fetch + text extraction
app.use('/api/tenders', tenderDocsRouter);

// � EMAIL: Subscription management + digest dispatch
app.use('/api/email', emailRoutes);

// �📊 AUDIT: Mount audit log receiver — ISO 27001, NIST SP 800-53, OWASP
app.use('/admin/audit-logs', auditRoutes);

// Print cost estimates on startup
console.log('\n🔒 Rate Limiting Enabled:');
console.log('   General API: 100 requests / 15 min');
console.log('   AI Endpoints: 120 calls / hour per user');
console.log('   Keyword Extraction: 50 calls / hour per user');
console.log('   Tender Analysis: 30 calls / hour per user');
console.log('   Authentication: 5 attempts / 15 min');
console.log('\n📊 Audit Logging Enabled:');
console.log('   Receiver: POST /admin/audit-logs');
console.log('   Health:   GET  /admin/audit-logs/health');
console.log('   Stats:    GET  /admin/audit-logs/stats');
console.log('\n🤖 AI Audit Intelligence Enabled:');
console.log('   Threat Summary:     POST /api/ai/audit/threat-summary');
console.log('   Anomaly Detection:  POST /api/ai/audit/anomaly-detect');
console.log('   Compliance Report:  POST /api/ai/audit/compliance-report');
rateLimitCostEstimate.printEstimate();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── Active tenders (Supabase-backed, cron-populated) ──────────────────────────
// FAST read path. The frontend hits this instead of the slow gov API. Data is
// refreshed hourly by a background cron (see bottom of file), so ordinary user
// page loads never trigger an upstream eTenders call — this keeps the number of
// gov-API calls constant as the platform scales. Response is browser-cacheable.
app.get('/api/active-tenders', async (req, res) => {
  const { search = '' } = req.query;
  try {
    const { results, total, syncedAt } = await getActiveTenders({ search });
    // Data only changes hourly → let browsers cache for 10 min, then revalidate.
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
    res.json({ results, total, source: 'supabase-active', syncedAt });
  } catch (err) {
    console.error('[active-tenders] read failed:', err.message);
    // 503 (not 500) so the client fallback chain treats it as "try live API".
    res.status(503).json({ error: 'active tenders unavailable', message: err.message });
  }
});

// Lightweight freshness/status probe (public, no upstream calls).
app.get('/api/active-tenders/status', (req, res) => {
  res.json(getSyncStatus());
});

// Sync trigger — accepts EITHER:
//   1. Vercel Cron Jobs — Vercel automatically sends
//      `Authorization: Bearer ${CRON_SECRET}` on requests it dispatches from
//      the `crons` array in vercel.json. This is how the sync ACTUALLY runs in
//      production — Vercel serverless functions cannot host a persistent
//      node-cron process (see tenderSync.js header comment for details).
//   2. Manual operator trigger — the `x-sync-key` header matching SYNC_SECRET,
//      for forcing a refresh by hand (e.g. right after deploy).
//
// Accepts GET (Vercel Cron only supports GET) and POST (manual/operator use).
// `?maxPages=N` bounds how many gov-API pages this invocation fetches so it
// finishes inside the serverless function's execution window; the sync is
// resumable across invocations via the persisted cursor (tender_sync_cursor).
function isAuthorizedSyncRequest(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.get('authorization') === `Bearer ${cronSecret}`) return true;

  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret && req.get('x-sync-key') === syncSecret) return true;

  return false;
}

async function handleSyncRequest(req, res) {
  if (!isAuthorizedSyncRequest(req)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const maxPages = Number(req.query.maxPages) || undefined; // undefined → service default
  const result = await syncActiveTenders({
    trigger: req.method === 'GET' ? 'vercel-cron' : 'manual-endpoint',
    ...(maxPages ? { maxPagesThisRun: maxPages } : {}),
  });
  res.json({ ok: !result?.error, ...result });
}

app.get('/api/active-tenders/sync', handleSyncRequest);
app.post('/api/active-tenders/sync', handleSyncRequest);

// Proxy endpoint for OCDS Releases API
// Tries progressively shorter date windows when the gov server times out.
// Returns plain JSON — SSE was removed because the API is too unreliable
// for streaming (frequent 500s make the stream hang before any data arrives).
app.get('/api/tenders', async (req, res) => {
  const { search = '', dateFrom = '', dateTo = '' } = req.query;

  try {
    const baseUrl = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';

    const toDate = (dateStr) => {
      if (!dateStr) return null;
      // Strip any time component — API accepts plain YYYY-MM-DD (confirmed via Postman)
      return dateStr.split('T')[0];
    };

    const today = new Date();
    const resolvedDateTo = toDate(dateTo) || today.toISOString().split('T')[0];
    const requestedFrom  = toDate(dateFrom) || null;

    // Start with the narrowest window (today only = fastest response),
    // then widen progressively if the gov IIS server times out or 500s.
    // Postman confirmed a 2-day window took ~1m 42s; 1-day should be ~30-60s.
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    };

    const candidates = requestedFrom
      // Caller supplied explicit dates — honour them, then fall back narrower
      ? [
          { from: requestedFrom,  label: null },
          { from: daysAgo(1),     label: 'today + yesterday (2 days)' },
          { from: daysAgo(3),     label: 'last 3 days' },
          { from: daysAgo(7),     label: 'last 7 days' },
        ]
      // No dates supplied — start from today (1 day) for fastest first paint
      : [
          { from: resolvedDateTo, label: null },              // today only (~1 day)
          { from: daysAgo(1),     label: 'last 2 days' },
          { from: daysAgo(3),     label: 'last 3 days' },
          { from: daysAgo(7),     label: 'last 7 days' },
        ];

    let apiResponse = null;
    let usedDateFrom = null;

    for (const { from: candidateFrom, label } of candidates) {
      if (label) {
        console.warn(`⚠️ Gov server slower than usual — retrying with ${label}...`);
      }

      try {
        apiResponse = await axios.get(baseUrl, {
          params: {
            PageNumber: 1,
            PageSize:   50,
            dateFrom:   candidateFrom,
            dateTo:     resolvedDateTo,
          },
          timeout: 120000, // 2 min — Postman confirmed API can take ~1m 42s
          headers: { Accept: 'application/json' },
        });

        if (apiResponse.status === 200) {
          usedDateFrom = candidateFrom;
          console.log(`✅ API 200 — dateFrom=${candidateFrom}, releases=${apiResponse.data?.releases?.length ?? 0}`);
          break;
        }
      } catch (err) {
        const status = err.response?.status;
        console.warn(`⚠️ API ${status || err.code} for dateFrom=${candidateFrom}`);
        if (!err.response || status === 500 || status === 502 || status === 503) continue;
        throw err; // non-retryable (400, 401, etc.)
      }
    }

    if (!apiResponse || apiResponse.status !== 200) {
      // ── Static fallback: serve the 01112025.json snapshot ─────────────────
      console.warn('⚠️ All eTenders API attempts failed — serving static fallback snapshot (01112025.json)');
      const fallbackReleases = (FALLBACK_SNAPSHOT.Releases || []).map(enrichWithProvince);
      const fallbackFiltered = search
        ? fallbackReleases.filter(r => {
            const q = search.toLowerCase();
            return (
              r.tender?.title?.toLowerCase().includes(q) ||
              r.tender?.description?.toLowerCase().includes(q) ||
              r.buyer?.name?.toLowerCase().includes(q) ||
              r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
            );
          })
        : fallbackReleases;
      return res.json({
        results:     fallbackFiltered,
        total:       fallbackFiltered.length,
        dateFrom:    FALLBACK_SNAPSHOT.PublishedDate || null,
        dateTo:      FALLBACK_SNAPSHOT.PublishedDate || null,
        isFallback:  true,
        fallbackMsg: 'eTenders is currently unavailable. Showing cached tenders.',
      });
    }

    const releases = (apiResponse.data?.releases || []).map(enrichWithProvince);

    const filtered = search
      ? releases.filter(r => {
          const q = search.toLowerCase();
          return (
            r.tender?.title?.toLowerCase().includes(q) ||
            r.tender?.description?.toLowerCase().includes(q) ||
            r.buyer?.name?.toLowerCase().includes(q) ||
            r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
          );
        })
      : releases;

    res.json({
      results:  filtered,
      total:    filtered.length,
      dateFrom: usedDateFrom,
      dateTo:   resolvedDateTo,
    });

  } catch (error) {
    console.error('Error fetching tenders:', error.message);
    res.status(error.response?.status || 500).json({
      error:   'Failed to fetch tenders',
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// ── Email digest cron jobs ────────────────────────────────────────────────────
// SAST = UTC+2.  "7 5 * * *" = 07:00 SAST (05:00 UTC) every day.
// Weekly digest fires on Mondays only (day-of-week = 1).

import { createClient as _createAdminClient } from '@supabase/supabase-js';

async function runDigestCron(frequency) {
  const admin = _createAdminClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  );

  const { data: subs, error } = await admin
    .from('email_subscriptions')
    .select('user_id, email, min_score, frequency')
    .eq('enabled', true)
    .eq('frequency', frequency);

  if (error) { console.error(`[cron] Failed to fetch ${frequency} subscribers:`, error.message); return; }
  if (!subs?.length) { console.log(`[cron] No ${frequency} subscribers`); return; }

  console.log(`[cron] Dispatching ${frequency} digest to ${subs.length} subscriber(s)…`);
  for (const sub of subs) {
    await dispatchDigest({
      userId:    sub.user_id,
      email:     sub.email,
      minScore:  sub.min_score,
      frequency: sub.frequency,
    });
  }
}

// Daily: every day at 07:00 SAST (05:00 UTC)
cron.schedule('0 5 * * *', () => runDigestCron('daily'),  { timezone: 'UTC' });

// Weekly: every Monday at 07:00 SAST (05:00 UTC)
cron.schedule('0 5 * * 1', () => runDigestCron('weekly'), { timezone: 'UTC' });

console.log('📧 Email digest scheduler started (daily 07:00 SAST | weekly Mon 07:00 SAST)');

// ── Active-tenders background sync ────────────────────────────────────────────
// Fetch open tenders from the gov API and store them in Supabase, pruning
// expired tenders once a full sweep completes.
//
// ⚠️ On Vercel (serverless) this in-process node-cron NEVER fires — the
// function is torn down between requests, so nothing keeps this timer alive.
// The real trigger in production is Vercel Cron Jobs (see vercel.json `crons`),
// which hit GET /api/active-tenders/sync on a schedule instead. This block is
// guarded to only run on persistent, always-on hosts (e.g. local dev, a VPS,
// Render/Railway) where `process.env.VERCEL` is not set — on Vercel it would
// just be dead code that never executes.
if (!process.env.VERCEL) {
  cron.schedule('0 * * * *', () => {
    syncActiveTenders({ trigger: 'cron-hourly' });
  }, { timezone: 'UTC' });

  console.log('🗂️  Active-tenders sync scheduled (hourly, on the hour) — persistent-host node-cron');

  // Warm the store shortly after boot so there's data without waiting for the top
  // of the next hour. Delayed + non-blocking so it never holds up server start.
  setTimeout(() => {
    syncActiveTenders({ trigger: 'startup' });
  }, 8000);
} else {
  console.log('🗂️  Active-tenders sync: running on Vercel — node-cron skipped, using Vercel Cron Jobs instead (see vercel.json)');
}
