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
 * THIS app fetches ONCE per hour in the background and stores the results in
 * Supabase. The frontend then reads the pre-filtered, indexed table — fast page
 * loads and a constant, low number of upstream calls no matter how many users.
 *
 * Responsibilities
 * ----------------
 *   1. fetchOpenReleasesFromApi() — paginate the gov API over a lookback window
 *   2. syncActiveTenders()        — upsert open releases + prune expired ones
 *   3. pruneExpiredTenders()      — delete rows whose closing date has passed
 *   4. getActiveTenders()         — read helper for the /api/active-tenders route
 *
 * Scheduling lives in server/index.js (node-cron, hourly + a startup warm-up).
 * Writes use the service_role key (bypasses RLS) so fetching is fully decoupled
 * from user control.
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// ── Config (env-overridable) ──────────────────────────────────────────────────
const OCDS_BASE_URL      = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';
const PAGE_SIZE          = Number(process.env.TENDER_SYNC_PAGE_SIZE     || 1000);
const MAX_PAGES          = Number(process.env.TENDER_SYNC_MAX_PAGES     || 50);
const LOOKBACK_DAYS      = Number(process.env.TENDER_SYNC_LOOKBACK_DAYS || 60);
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
    config:     { lookbackDays: LOOKBACK_DAYS, pageSize: PAGE_SIZE, maxPages: MAX_PAGES },
  };
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

// ── Fetch + dedupe every open release over the lookback window ─────────────────
export async function fetchOpenReleasesFromApi() {
  const dateFrom = lookbackFrom();
  const dateTo   = ymd(new Date());
  const byOcid   = new Map();
  let pagesFetched = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let releases;
    try {
      releases = await fetchPage(page, dateFrom, dateTo);
    } catch (err) {
      const code = err.response?.status || err.code || err.message;
      console.warn(`[tender-sync] page ${page} failed (${code}) — stopping pagination`);
      break; // gov API flaked — keep whatever we already gathered
    }

    pagesFetched++;
    if (!releases.length) break; // no more data

    for (const r of releases) {
      if (!r?.ocid) continue;
      // OCDS "compiled" records can repeat an ocid — keep the most recent one.
      const existing = byOcid.get(r.ocid);
      if (!existing || new Date(r.date || 0) >= new Date(existing.date || 0)) {
        byOcid.set(r.ocid, r);
      }
    }

    if (releases.length < PAGE_SIZE) break; // reached the last page
  }

  const all  = [...byOcid.values()];
  const open = all.filter(r => isOpenTender(r));
  console.log(
    `[tender-sync] ${dateFrom}→${dateTo}: ${pagesFetched} page(s), ` +
    `${all.length} unique releases, ${open.length} open`
  );
  return open;
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
export async function syncActiveTenders({ trigger = 'manual' } = {}) {
  if (_isSyncing) {
    console.log('[tender-sync] skip — a sync is already running');
    return { skipped: true };
  }
  _isSyncing = true;
  const startedAt = Date.now();
  console.log(`[tender-sync] ▶ starting (trigger: ${trigger})`);

  try {
    const open = await fetchOpenReleasesFromApi();

    let upserted = 0;
    if (open.length) {
      upserted = await upsertRows(open.map(toRow));
      console.log(`[tender-sync] upserted ${upserted} open tender(s)`);
    } else {
      console.warn('[tender-sync] no open tenders fetched — skipping upsert (API may be down)');
    }

    // Always prune to honour the data-lifecycle requirement, even if the fetch
    // returned nothing (e.g. the gov API was down this hour).
    const pruned = await pruneExpiredTenders();

    const durationSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    _lastSyncAt = new Date().toISOString();
    _lastResult = { upserted, pruned, durationSec };
    console.log(`[tender-sync] ✅ done in ${durationSec}s (upserted ${upserted}, pruned ${pruned})`);
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

  const { data, error } = await admin
    .from('active_tenders')
    .select('release, province, closing_date, synced_at')
    .order('closing_date', { ascending: true }) // closing soonest first; nulls last
    .limit(limit);

  if (error) throw error;

  const now = Date.now();

  // Safety net: exclude anything that expired between hourly prunes.
  const rows = (data || []).filter(
    row => !row.closing_date || new Date(row.closing_date).getTime() >= now
  );

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
  const syncedAt = (data || []).reduce(
    (max, row) => (row.synced_at > max ? row.synced_at : max),
    _lastSyncAt || null
  );

  return { results: releases, total: releases.length, syncedAt };
}
