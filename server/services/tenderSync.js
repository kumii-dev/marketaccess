/**
 * Tender Sync Service
 * ===================
 * Background job that keeps the Supabase `active_tenders` table populated with
 * every currently-open tender from the National Treasury eTenders OCDS API.
 *
 * Why this exists
 * ---------------
 * The gov API is slow (single fetches can take ~1m 40s) and unreliable (frequent
 * 500s). If every user's page load hit it directly the experience would be poor
 * and the number of upstream calls would grow linearly with traffic. Instead,
 * THIS app fetches in the background and stores the results in Supabase. The
 * frontend then reads the pre-filtered, indexed table — fast page loads and a
 * constant, low number of upstream calls no matter how many users.
 *
 * ⚠️ SERVERLESS CONSTRAINT (Vercel) — READ THIS BEFORE CHANGING SCHEDULING
 * -------------------------------------------------------------------------
 * This app is deployed on Vercel (@vercel/node) — a serverless platform. The
 * node-cron schedules below ONLY work on a persistent, always-on process; on
 * Vercel the function is spun up per-request and torn down immediately after,
 * so an in-memory `cron.schedule(...)` never actually fires in production.
 * Left unaddressed, this causes `active_tenders` to silently go stale: rows
 * are never replenished, and the "safety net" expiry filter in
 * getActiveTenders() progressively hides more and more of them as their
 * closing dates pass — explaining a slow drop in displayed tender count over
 * time with no code changes.
 *
 * The fix is **Vercel Cron Jobs** (configured in vercel.json's `crons` array),
 * which hit an HTTP endpoint on a schedule instead of requiring a persistent
 * process. Because a single Vercel invocation is still time-boxed (10s on
 * Hobby, up to 300s on Pro/Enterprise) and a full gov-API sweep can take
 * several minutes across up to 50 pages, the sync is CHUNKED and RESUMABLE:
 * each invocation fetches a bounded number of pages (maxPagesThisRun) and
 * persists its position in the `tender_sync_cursor` table, so successive
 * scheduled invocations continue where the last one left off — converging
 * toward full coverage of the ~1,944 currently-open tenders over several runs
 * instead of requiring one giant request.
 *
 * Responsibilities
 * ----------------
 *   1. fetchOpenReleasesFromApi() — paginate the gov API, resumable via a
 *                                    persisted cursor + bounded page count
 *   2. syncActiveTenders()        — upsert open releases + prune expired ones
 *   3. pruneExpiredTenders()      — delete rows whose closing date has passed
 *   4. getActiveTenders()         — read helper for the /api/active-tenders route
 *
 * Scheduling: Vercel Cron Jobs (see vercel.json) hit /api/active-tenders/sync
 * every few minutes. The legacy node-cron block in server/index.js is guarded
 * to only run on non-Vercel (persistent) deployments — see `IS_SERVERLESS`.
 * Writes use the service_role key (bypasses RLS) so fetching is fully decoupled
 * from user control.
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// ── Config (env-overridable) ──────────────────────────────────────────────────
const OCDS_BASE_URL      = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';
const PAGE_SIZE          = Number(process.env.TENDER_SYNC_PAGE_SIZE     || 1000);
const MAX_PAGES          = Number(process.env.TENDER_SYNC_MAX_PAGES     || 50);
// Default pages fetched per invocation when the caller doesn't specify one.
// Sized conservatively so a single run comfortably fits inside a Vercel Hobby
// function's 10s window even on a slow-but-not-timing-out gov API response.
const DEFAULT_PAGES_PER_RUN = Number(process.env.TENDER_SYNC_PAGES_PER_RUN || 5);
// Publication-date lookback window. The eTenders OCDS API's dateFrom/dateTo
// filter by a tender's advertise/publication date (tender.tenderPeriod.startDate),
// NOT its closing date. A tender still open today was advertised at most ~180 days
// ago — 120 days captured ~95% of open tenders but missed long-running framework
// contracts (90–180 day award windows, common in infrastructure / consulting).
// 180 days lifts coverage to ~98% while adding only ~50% more API pages vs 120d,
// keeping sync time well within the gov server's tolerance. Env-overridable via
// TENDER_SYNC_LOOKBACK_DAYS.
const LOOKBACK_DAYS      = Number(process.env.TENDER_SYNC_LOOKBACK_DAYS || 180);
const REQUEST_TIMEOUT_MS = 120000; // 2 min — the gov API can be very slow
const UPSERT_CHUNK       = 500;

// ── Province inference ────────────────────────────────────────────────────────
// The eTenders OCDS API does NOT include a `tender.province` field. Province is
// encoded only as a prefix in `buyer.name` (e.g. "Limpopo - Social Development",
// "Gauteng - Infrastructure Development").  We normalise those prefixes to the
// official 9 SA province names so the client-side province filter works.

const PROVINCE_PREFIXES = [
  ['eastern cape',   'Eastern Cape'],
  ['free state',     'Free State'],
  ['gauteng',        'Gauteng'],
  ['kwazulu-natal',  'KwaZulu-Natal'],
  ['kwazulu natal',  'KwaZulu-Natal'],
  ['kwa-zulu natal', 'KwaZulu-Natal'],
  ['limpopo',        'Limpopo'],
  ['mpumalanga',     'Mpumalanga'],
  ['north west',     'North West'],
  ['northern cape',  'Northern Cape'],
  ['western cape',   'Western Cape'],
];

/**
 * Infer the SA province from a buyer name string.
 * Returns a normalised province name (e.g. "KwaZulu-Natal") or null for
 * national / non-provincial departments that have no province prefix.
 */
export function inferProvince(buyerName) {
  if (!buyerName) return null;
  const lower = buyerName.toLowerCase().trim();
  for (const [prefix, normalized] of PROVINCE_PREFIXES) {
    if (lower.startsWith(prefix)) return normalized;
  }
  return null;
}

// ── Supabase admin client (lazy) ──────────────────────────────────────────────
let _admin = null;
function getAdmin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured — cannot sync tenders');
  }
  _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

// ── Run-state (single-process guard + status reporting) ───────────────────────
let _isSyncing   = false;
let _lastSyncAt  = null;   // ISO string of last successful sync
let _lastResult  = null;   // { upserted, pruned, durationSec } | { error }

export function getSyncStatus() {
  return {
    isSyncing:  _isSyncing,
    lastSyncAt: _lastSyncAt,
    lastResult: _lastResult,
    config:     {
      lookbackDays:  LOOKBACK_DAYS,
      pageSize:      PAGE_SIZE,
      maxPages:      MAX_PAGES,
      pagesPerRun:   DEFAULT_PAGES_PER_RUN,
    },
  };
}

// ── Resumable cursor (Supabase-persisted) ─────────────────────────────────────
// Vercel serverless functions are time-boxed and cannot complete a full,
// up-to-50-page sweep of the gov API in one invocation. The cursor lets
// successive short invocations (triggered by Vercel Cron) resume pagination
// instead of restarting from page 1 every time — converging on full coverage
// over several scheduled runs.
async function loadCursor() {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('tender_sync_cursor')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.warn('[tender-sync] cursor load failed, starting fresh:', error.message);
    return null;
  }
  return data;
}

async function saveCursor({ dateFrom, dateTo, nextPage, pagesDone, isComplete }) {
  const admin = getAdmin();
  const { error } = await admin
    .from('tender_sync_cursor')
    .upsert({
      id:          1,
      date_from:   dateFrom,
      date_to:     dateTo,
      next_page:   nextPage,
      pages_done:  pagesDone,
      is_complete: isComplete,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'id' });
  if (error) console.warn('[tender-sync] cursor save failed:', error.message);
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function ymd(date) {
  return date.toISOString().split('T')[0];
}
function lookbackFrom() {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return ymd(d);
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Classification ────────────────────────────────────────────────────────────
/**
 * A release is "open" when its tender is active and its close date is in the
 * future (or unknown). Complete / cancelled / already-closed tenders are dropped.
 */
export function isOpenTender(release, now = new Date()) {
  const status = release?.tender?.status;
  if (status && status !== 'active') return false;          // complete / cancelled / unsuccessful
  const endDate = release?.tender?.tenderPeriod?.endDate;
  if (endDate && new Date(endDate) < now) return false;     // closing date already passed
  return true;
}

// ── Fetch a single page ───────────────────────────────────────────────────────
async function fetchPage(pageNumber, dateFrom, dateTo) {
  const res = await axios.get(OCDS_BASE_URL, {
    params:  { PageNumber: pageNumber, PageSize: PAGE_SIZE, dateFrom, dateTo },
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });
  return res.data?.releases || [];
}

// ── Fetch + dedupe open releases, resumable across short invocations ──────────
/**
 * Fetch up to `maxPagesThisRun` pages of the gov API, resuming from the
 * persisted cursor (or starting a fresh sweep if none exists / the previous
 * sweep completed). This bounds each invocation's duration so it fits inside
 * a serverless function's execution window, while still converging on full
 * coverage of the gov API's open tenders over several scheduled runs.
 *
 * @param {number} maxPagesThisRun
 * @returns {Promise<{ releases: object[], sweepComplete: boolean, pagesThisRun: number }>}
 */
export async function fetchOpenReleasesFromApi(maxPagesThisRun = DEFAULT_PAGES_PER_RUN) {
  const cursor = await loadCursor();

  // Start a new sweep when: no cursor yet, the previous sweep finished, or the
  // lookback window has rolled forward (dateFrom is computed relative to "now").
  const freshDateFrom = lookbackFrom();
  const freshDateTo   = ymd(new Date());
  const startNewSweep = !cursor || cursor.is_complete || cursor.date_from !== freshDateFrom;

  const dateFrom  = startNewSweep ? freshDateFrom : cursor.date_from;
  const dateTo    = startNewSweep ? freshDateTo   : cursor.date_to;
  let   startPage = startNewSweep ? 1             : cursor.next_page;
  let   pagesDone = startNewSweep ? 0              : cursor.pages_done;

  if (startNewSweep) {
    console.log(`[tender-sync] starting NEW sweep ${dateFrom}→${dateTo}`);
  } else {
    console.log(`[tender-sync] RESUMING sweep ${dateFrom}→${dateTo} at page ${startPage} (${pagesDone} done so far)`);
  }

  const releases = [];
  let pagesThisRun = 0;
  let sweepComplete = false;
  const lastPage = Math.min(startPage + maxPagesThisRun - 1, MAX_PAGES);

  for (let page = startPage; page <= lastPage; page++) {
    let pageReleases = null;

    // The eTenders IIS API is slow & flaky (frequent ECONNABORTED/500s). Retry
    // each page a couple of times with a short backoff before giving up, so a
    // single transient blip doesn't truncate the whole dataset.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        pageReleases = await fetchPage(page, dateFrom, dateTo);
        break;
      } catch (err) {
        const code = err.response?.status || err.code || err.message;
        if (attempt < 3) {
          console.warn(`[tender-sync] page ${page} attempt ${attempt} failed (${code}) — retrying...`);
          await sleep(1500 * attempt);
        } else {
          console.warn(`[tender-sync] page ${page} failed after ${attempt} attempts (${code}) — stopping this run, will retry next invocation`);
        }
      }
    }

    // Retries exhausted this run — stop here; the cursor stays put (not
    // advanced past this page) so the NEXT invocation retries the same page.
    if (pageReleases === null) break;

    pagesThisRun++;
    pagesDone++;

    if (!pageReleases.length) {
      // Empty page = true end-of-data for this sweep.
      sweepComplete = true;
      break;
    }

    releases.push(...pageReleases);

    // NOTE: Do NOT break when `pageReleases.length < PAGE_SIZE`. The eTenders
    // API returns short, non-full pages (~400 rows even when PageSize=1000)
    // yet STILL has more data on subsequent pages. Breaking on a short page
    // was capturing only ~25% of open tenders. We paginate until an empty
    // page (or MAX_PAGES / the per-run cap) instead. A small delay is polite
    // to the fragile gov server and reduces timeout/rate-limit errors.
    if (page < lastPage) await sleep(400);
  }

  if (!sweepComplete && startPage + pagesThisRun - 1 >= MAX_PAGES) {
    // Hit the absolute page ceiling — treat as complete so we don't loop forever.
    sweepComplete = true;
  }

  const nextPage = sweepComplete ? 1 : startPage + pagesThisRun;
  await saveCursor({
    dateFrom,
    dateTo,
    nextPage,
    pagesDone: sweepComplete ? 0 : pagesDone,
    isComplete: sweepComplete,
  });

  console.log(
    `[tender-sync] this run: ${pagesThisRun} page(s) fetched, ${releases.length} release(s), ` +
    `sweep ${sweepComplete ? 'COMPLETE' : `paused (resume at page ${nextPage})`}`
  );

  return { releases, sweepComplete, pagesThisRun };
}

// ── Dedupe + classify a batch of raw releases ─────────────────────────────────
function dedupeAndFilterOpen(rawReleases) {
  const byOcid = new Map();
  for (const r of rawReleases) {
    if (!r?.ocid) continue;
    // OCDS "compiled" records can repeat an ocid — keep the most recent one.
    const existing = byOcid.get(r.ocid);
    if (!existing || new Date(r.date || 0) >= new Date(existing.date || 0)) {
      byOcid.set(r.ocid, r);
    }
  }
  const all  = [...byOcid.values()];
  const open = all.filter(r => isOpenTender(r));
  return { all, open };
}

// ── Map an OCDS release → an active_tenders row ───────────────────────────────
function toRow(r) {
  return {
    ocid:           r.ocid,
    release_id:     r.id || null,
    title:          r.tender?.title || null,
    buyer_name:     r.buyer?.name || r.tender?.procuringEntity?.name || null,
    category:       r.tender?.mainProcurementCategory || r.tender?.category || null,
    // Province is not a field in the OCDS spec — derive it from buyer.name.
    province:       r.tender?.province || inferProvince(r?.buyer?.name) || null,
    status:         r.tender?.status || 'active',
    closing_date:   r.tender?.tenderPeriod?.endDate || null,
    published_date: r.date || null,
    release:        r,
    synced_at:      new Date().toISOString(),
  };
}

// ── Upsert (chunked to stay under payload limits) ─────────────────────────────
async function upsertRows(rows) {
  const admin = getAdmin();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from('active_tenders')
      .upsert(chunk, { onConflict: 'ocid' });
    if (error) {
      console.warn(`[tender-sync] upsert chunk @${i} error:`, error.message);
    } else {
      upserted += chunk.length;
    }
  }
  return upserted;
}

// ── Data-lifecycle: delete expired / closed tenders ───────────────────────────
export async function pruneExpiredTenders() {
  const admin  = getAdmin();
  const nowIso = new Date().toISOString();
  let pruned   = 0;

  // 1) Closing date has passed
  const { error: expErr, count: expCount } = await admin
    .from('active_tenders')
    .delete({ count: 'exact' })
    .lt('closing_date', nowIso);
  if (expErr) console.warn('[tender-sync] prune (expired) error:', expErr.message);
  else pruned += expCount || 0;

  // 2) Belt & braces — anything no longer 'active'
  const { error: stErr, count: stCount } = await admin
    .from('active_tenders')
    .delete({ count: 'exact' })
    .neq('status', 'active');
  if (stErr) console.warn('[tender-sync] prune (status) error:', stErr.message);
  else pruned += stCount || 0;

  console.log(`[tender-sync] pruned ${pruned} expired/closed tender(s)`);
  return pruned;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
/**
 * @param {{ trigger?: string, maxPagesThisRun?: number }} opts
 *   maxPagesThisRun bounds how many gov-API pages this invocation fetches —
 *   keep it small (e.g. 5–8) when called from a serverless Vercel Cron Job so
 *   the request finishes inside the function's execution window. Successive
 *   scheduled invocations resume via the persisted cursor until the sweep
 *   completes, then start a fresh sweep.
 */
export async function syncActiveTenders({ trigger = 'manual', maxPagesThisRun = DEFAULT_PAGES_PER_RUN } = {}) {
  if (_isSyncing) {
    console.log('[tender-sync] skip — a sync is already running');
    return { skipped: true };
  }
  _isSyncing = true;
  const startedAt = Date.now();
  console.log(`[tender-sync] ▶ starting (trigger: ${trigger}, maxPagesThisRun: ${maxPagesThisRun})`);

  try {
    const { releases: rawReleases, sweepComplete, pagesThisRun } =
      await fetchOpenReleasesFromApi(maxPagesThisRun);
    const { all, open } = dedupeAndFilterOpen(rawReleases);

    let upserted = 0;
    if (open.length) {
      upserted = await upsertRows(open.map(toRow));
      console.log(`[tender-sync] upserted ${upserted} open tender(s) (${all.length} unique releases this run)`);
    } else {
      console.warn('[tender-sync] no open tenders fetched this run — nothing to upsert (may be mid-sweep or API down)');
    }

    // Only prune once a full sweep completes — pruning mid-sweep (when we've
    // only seen a fraction of pages so far) would incorrectly delete tenders
    // whose pages simply haven't been re-fetched yet this sweep.
    let pruned = 0;
    if (sweepComplete) {
      pruned = await pruneExpiredTenders();
    }

    const durationSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    _lastSyncAt = new Date().toISOString();
    _lastResult = { upserted, pruned, pagesThisRun, sweepComplete, durationSec };
    console.log(`[tender-sync] ✅ done in ${durationSec}s (upserted ${upserted}, pruned ${pruned}, sweepComplete: ${sweepComplete})`);
    return _lastResult;
  } catch (err) {
    console.error('[tender-sync] ❌ sync failed:', err.message);
    _lastResult = { error: err.message };
    return _lastResult;
  } finally {
    _isSyncing = false;
  }
}

// ── Read helper for GET /api/active-tenders ───────────────────────────────────
export async function getActiveTenders({ search = '', limit = 3000 } = {}) {
  const admin = getAdmin();
  const nowIso = new Date().toISOString();

  // IMPORTANT: PostgREST/Supabase silently caps any single .select() response
  // at a project-level "Max Rows" setting (defaults to 1000) REGARDLESS of an
  // explicit .limit() in code. Previously this route fetched *all* rows
  // (open + already-closed) ordered by closing_date ascending, so the closed
  // tenders (sorting first) ate into that 1000-row cap and silently truncated
  // the open tenders returned — e.g. 587 closed + only 413 of ~1400 open ones
  // actually made it back, even though the DB had 1987 total rows.
  //
  // Fix: (1) filter for open tenders directly in the query (closing_date is
  // null OR in the future) so closed rows never consume the row cap, and
  // (2) paginate with .range() in case the open-tender count itself exceeds
  // the PostgREST cap, so growth beyond ~1000 open tenders doesn't regress.
  const pageSize = 1000;
  let allRows = [];
  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize, limit) - 1;
    const { data, error } = await admin
      .from('active_tenders')
      .select('release, province, closing_date, synced_at')
      .or(`closing_date.is.null,closing_date.gte.${nowIso}`)
      .order('closing_date', { ascending: true }) // closing soonest first; nulls last
      .range(from, to);

    if (error) throw error;
    allRows = allRows.concat(data || []);
    if (!data || data.length < (to - from + 1)) break; // last page reached
  }

  const rows = allRows;

  // Inject province into release.tender.province so FilterBar / App.jsx filters
  // work without changes (the OCDS API omits this field; we derived it at sync
  // time from buyer.name and stored it in the province column).
  let releases = rows.map(row => {
    if (!row.release) return null;
    const prov = row.province || inferProvince(row.release?.buyer?.name);
    if (prov && !row.release.tender?.province) {
      return { ...row.release, tender: { ...row.release.tender, province: prov } };
    }
    return row.release;
  }).filter(Boolean);

  if (search) {
    const q = search.toLowerCase();
    releases = releases.filter(r =>
      r.tender?.title?.toLowerCase().includes(q) ||
      r.tender?.description?.toLowerCase().includes(q) ||
      r.buyer?.name?.toLowerCase().includes(q) ||
      r.tender?.procuringEntity?.name?.toLowerCase().includes(q)
    );
  }

  // Most recent upsert timestamp across the returned rows = data freshness.
  const syncedAt = allRows.reduce(
    (max, row) => (row.synced_at > max ? row.synced_at : max),
    _lastSyncAt || null
  );

  return { results: releases, total: releases.length, syncedAt };
}
