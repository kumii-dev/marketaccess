/**
 * eTender Daily Cache
 * ===================
 * Saves a rolling 2-day window of live eTender snapshots to both
 * localStorage (this device) and Supabase (shared across devices).
 *
 * Fallback chain used by api.js when the live API is unavailable:
 *   1. Supabase etender_daily_cache  (most recent ≤ 2 days old)
 *   2. localStorage etender_snap_*   (most recent ≤ 2 days old)
 *   3. Bundled static 01112025.json  (last resort — handled in api.js)
 *
 * Storage budget:
 *   ~50 tenders/day × ~3 KB/tender × 2 days ≈ 300 KB Supabase JSONB
 *   localStorage key: "etender_snap_YYYY-MM-DD"
 *
 * Save rules:
 *   - Only saves on SUCCESSFUL live API fetches
 *   - Only one row per calendar day (upsert by snapshot_date)
 *   - Authenticated users only write to Supabase (anon can read)
 *   - localStorage is always written (no auth required)
 *   - Both stores prune entries older than MAX_AGE_DAYS on every save
 */

import { supabase } from '../lib/supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_AGE_DAYS  = 2;
const LS_PREFIX     = 'etender_snap_';   // e.g. "etender_snap_2026-05-06"
const SUPABASE_TABLE = 'etender_daily_cache';

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns today as YYYY-MM-DD (local time) */
function todayKey() {
  return new Date().toISOString().split('T')[0];
}

/** Returns the ISO date string for N days ago */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/** Oldest acceptable date (inclusive) */
function cutoffDate() {
  return daysAgo(MAX_AGE_DAYS - 1); // keep today AND yesterday
}

// ── localStorage ──────────────────────────────────────────────────────────────

/**
 * Write today's snapshot to localStorage and prune entries older than MAX_AGE_DAYS.
 * @param {Array} tenders
 */
function saveToLocalStorage(tenders) {
  try {
    const key = LS_PREFIX + todayKey();
    localStorage.setItem(key, JSON.stringify(tenders));
    pruneLocalStorage();
    console.log(`💾 [daily-cache] localStorage: saved ${tenders.length} tenders for ${todayKey()}`);
  } catch (err) {
    // QuotaExceededError or private-browsing — non-fatal
    console.warn('[daily-cache] localStorage save failed:', err.message);
  }
}

/** Remove localStorage entries older than MAX_AGE_DAYS */
function pruneLocalStorage() {
  try {
    const cutoff = cutoffDate();
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX)) {
        const date = key.slice(LS_PREFIX.length); // YYYY-MM-DD
        if (date < cutoff) toDelete.push(key);
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    if (toDelete.length) {
      console.log(`🗑️ [daily-cache] localStorage: pruned ${toDelete.length} old snapshot(s)`);
    }
  } catch (err) {
    console.warn('[daily-cache] localStorage prune failed:', err.message);
  }
}

/**
 * Find the most recent valid snapshot in localStorage.
 * @returns {{ tenders: Array, date: string, source: 'localStorage' } | null}
 */
function getFromLocalStorage() {
  try {
    const cutoff = cutoffDate();
    let bestDate = null;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX)) {
        const date = key.slice(LS_PREFIX.length);
        if (date >= cutoff && (!bestDate || date > bestDate)) {
          bestDate = date;
        }
      }
    }

    if (!bestDate) return null;

    const raw = localStorage.getItem(LS_PREFIX + bestDate);
    if (!raw) return null;

    const tenders = JSON.parse(raw);
    console.log(`⚡ [daily-cache] localStorage: loaded ${tenders.length} tenders from ${bestDate}`);
    return { tenders, date: bestDate, source: 'localStorage' };
  } catch (err) {
    console.warn('[daily-cache] localStorage read failed:', err.message);
    return null;
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────

/**
 * Upsert today's snapshot to Supabase and prune entries older than MAX_AGE_DAYS.
 * Only runs when a user is authenticated (RLS requires it for writes).
 * @param {Array} tenders
 */
async function saveToSupabase(tenders) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[daily-cache] Supabase: skipping save (no authenticated user)');
      return;
    }

    const today = todayKey();

    // Upsert — safe to call multiple times; last successful fetch wins
    const { error: upsertErr } = await supabase
      .from(SUPABASE_TABLE)
      .upsert(
        {
          snapshot_date: today,
          tenders,
          tender_count: tenders.length,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'snapshot_date' }
      );

    if (upsertErr) throw upsertErr;
    console.log(`✅ [daily-cache] Supabase: saved ${tenders.length} tenders for ${today}`);

    // Prune rows older than MAX_AGE_DAYS (rolling window enforcement)
    const cutoff = cutoffDate();
    const { error: pruneErr } = await supabase
      .from(SUPABASE_TABLE)
      .delete()
      .lt('snapshot_date', cutoff);

    if (pruneErr) {
      console.warn('[daily-cache] Supabase prune error:', pruneErr.message);
    } else {
      console.log(`🗑️ [daily-cache] Supabase: pruned entries older than ${cutoff}`);
    }
  } catch (err) {
    // Non-fatal — gracefully handle network errors, RLS denials, etc.
    console.warn('[daily-cache] Supabase save failed:', err.message);
  }
}

/**
 * Fetch the most recent snapshot from Supabase (within MAX_AGE_DAYS).
 * Uses anon key — no auth required for reads (RLS SELECT policy is open).
 * @returns {{ tenders: Array, date: string, source: 'supabase' } | null}
 */
async function getFromSupabase() {
  try {
    const cutoff = cutoffDate();

    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('snapshot_date, tenders, tender_count')
      .gte('snapshot_date', cutoff)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(); // returns null instead of error when no rows

    if (error) throw error;
    if (!data) return null;

    console.log(
      `⚡ [daily-cache] Supabase: loaded ${data.tender_count} tenders from ${data.snapshot_date}`
    );
    return { tenders: data.tenders, date: data.snapshot_date, source: 'supabase' };
  } catch (err) {
    console.warn('[daily-cache] Supabase read failed:', err.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a successful live fetch to both stores (fire-and-forget).
 * Call after every successful eTenders API response.
 *
 * @param {Array} tenders - OCDS release objects from the live API
 */
export async function saveDailySnapshot(tenders) {
  if (!Array.isArray(tenders) || tenders.length === 0) return;

  saveToLocalStorage(tenders);   // synchronous — fast, always runs
  await saveToSupabase(tenders); // async — requires auth, best-effort
}

/**
 * Return the best available cached snapshot when the live API is unavailable.
 * Checks Supabase first (cross-device), then localStorage (this device).
 *
 * @returns {Promise<{ tenders: Array, date: string, source: string } | null>}
 */
export async function getLatestDailySnapshot() {
  // Supabase first — shared across all devices / users
  const fromSupabase = await getFromSupabase();
  if (fromSupabase) return fromSupabase;

  // localStorage second — this browser/device only
  return getFromLocalStorage();
}
