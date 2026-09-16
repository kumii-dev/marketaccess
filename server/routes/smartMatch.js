/**
 * Smart Match Routes
 * ===================
 * Invoke-on-use (NOT cron) tender-matching + notification engine.
 *
 * Endpoints:
 *   POST /api/smart-match/refresh  — re-score active_tenders against the
 *                                    caller's saved AI keywords, upsert into
 *                                    smart_matched_tenders, and fire an
 *                                    instant email for any newly-qualifying
 *                                    match (mirrors a "reminder email").
 *   GET  /api/smart-match/list     — return the caller's stored matches.
 *
 * Why no cron job:
 *   This is a plain JavaScript function invoked directly by the client
 *   (e.g. on mount of the "My Tenders" / "Smart Matched Tenders" page —
 *   see src/components/MyTendersPage.jsx / SmartMatchedTenders.jsx). There
 *   is no scheduler involved; the user's own page load (or an explicit
 *   "Check for new matches" action) is the trigger, same as clicking
 *   "Send Now" already does for the digest email.
 *
 * Why this survives eTenders API outages:
 *   Matching reads from `active_tenders` (server/services/tenderSync.js),
 *   which is refreshed by the existing background cron completely
 *   independently of this request — so scoring keeps working even when
 *   the live gov API is down.
 *
 * Auth: Bearer Supabase JWT, validated server-side via the service-role
 * admin client (same pattern already proven in routes/email.js). This
 * deliberately avoids relying on the browser SDK's RLS-based auth.uid(),
 * which is the source of the 401s previously seen on the My Tenders page.
 */

import express from 'express';
import { generalApiLimiter } from '../middleware/rateLimiters.js';
import { getActiveTenders } from '../services/tenderSync.js';
import { buildDigestHtml } from './email.js';
import { Resend } from 'resend';
import { getAdmin, getUserFromRequest } from '../utils/requestAuth.js';

const router = express.Router();
router.use(generalApiLimiter);

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // email is best-effort; matching still works without it
  return new Resend(key);
}

// ── Scoring (mirrors dispatchDigest's server-side pass in routes/email.js) ───
function scoreAgainstKeywords(release, keywords) {
  if (!keywords || keywords.length === 0) return { score: 0, matched: [] };

  const tenderText = [
    release.tender?.title        || '',
    release.tender?.description  || '',
    release.buyer?.name          || '',
    release.tender?.mainProcurementCategory || '',
    release.tender?.items?.map(i => i.description || '').join(' ') || '',
  ].join(' ').toLowerCase();

  const matched = keywords.filter(kw => kw && tenderText.includes(kw.toLowerCase()));
  return {
    score: Math.round((matched.length / keywords.length) * 100),
    matched,
  };
}

/**
 * Core invoke-on-use matching function. NOT a cron job — called directly
 * from the /refresh route handler below, in response to a real request.
 *
 * @param {string} userId
 * @returns {Promise<{ totalMatched: number, newlyNotified: number, emailSent: boolean }>}
 */
export async function refreshSmartMatchesForUser(userId) {
  const admin = getAdmin();

  // 1. Pull this user's saved AI keywords (written by SmartMatchedTenders' enhanceWithAI)
  const { data: kwCache } = await admin
    .from('ai_keyword_cache')
    .select('keywords')
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const keywords = Array.isArray(kwCache?.keywords) ? kwCache.keywords : [];
  if (keywords.length === 0) {
    return { totalMatched: 0, newlyNotified: 0, emailSent: false, reason: 'No AI keywords yet' };
  }

  // 2. Read from the resilient active_tenders store (not the live eTenders API)
  const { results: allTenders } = await getActiveTenders({ limit: 3000 });
  if (!allTenders || allTenders.length === 0) {
    return { totalMatched: 0, newlyNotified: 0, emailSent: false, reason: 'active_tenders empty' };
  }

  // 3. Score every tender, keep anything with at least one keyword hit
  const scored = allTenders
    .map(t => {
      const { score, matched } = scoreAgainstKeywords(t, keywords);
      return { t, score, matched };
    })
    .filter(({ score }) => score > 0);

  if (scored.length === 0) {
    return { totalMatched: 0, newlyNotified: 0, emailSent: false, reason: 'No matches this run' };
  }

  // 4. Upsert into smart_matched_tenders (service_role bypasses RLS)
  const rows = scored.map(({ t, score, matched }) => ({
    user_id:          userId,
    tender_ocid:      t.ocid || t.tender?.id || '',
    match_score:      score,
    matched_keywords: matched,
    tender_title:     t.tender?.title || 'Untitled Tender',
    organ_of_state:   t.buyer?.name || '',
    category:         t.tender?.mainProcurementCategory || t.tender?.category || '',
    closing_date:     t.tender?.tenderPeriod?.endDate || null,
  })).filter(r => r.tender_ocid);

  const { error: upsertErr } = await admin
    .from('smart_matched_tenders')
    .upsert(rows, { onConflict: 'user_id,tender_ocid' });

  if (upsertErr) {
    console.error('[smart-match] upsert failed:', upsertErr.message);
    return { totalMatched: scored.length, newlyNotified: 0, emailSent: false, error: upsertErr.message };
  }

  // 5. Look up the user's subscription to know the notify threshold + whether
  //    email alerts are enabled at all — reuses the existing email_subscriptions
  //    table so users manage ONE set of preferences on the My Tenders page.
  const { data: sub } = await admin
    .from('email_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!sub || !sub.enabled) {
    return { totalMatched: scored.length, newlyNotified: 0, emailSent: false, reason: 'Not subscribed' };
  }

  // 6. Find rows that are NEW (never notified) and clear the subscribed threshold
  const { data: pending } = await admin
    .from('smart_matched_tenders')
    .select('*')
    .eq('user_id', userId)
    .eq('notified', false)
    .gte('match_score', sub.min_score)
    .order('match_score', { ascending: false })
    .limit(30);

  if (!pending || pending.length === 0) {
    return { totalMatched: scored.length, newlyNotified: 0, emailSent: false, reason: 'No new matches above threshold' };
  }

  // 7. Fire an instant alert email — same HTML builder as the scheduled digest,
  //    but triggered here by the JS refresh call instead of a cron job.
  let emailSent = false;
  const resend = getResend();
  if (resend) {
    try {
      const normalised = pending.map(r => ({
        title:        r.tender_title,
        organOfState: r.organ_of_state,
        closingDate:  r.closing_date,
        matchScore:   r.match_score,
        category:     r.category,
        ocid:         r.tender_ocid,
      }));

      const html = buildDigestHtml(normalised, sub.email, sub.min_score, 'instant');
      const { error: sendErr } = await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL || 'Market Access <alerts@kumii.africa>',
        to:      sub.email,
        subject: `🎯 ${normalised.length} new tender match${normalised.length !== 1 ? 'es' : ''} for you — Kumii Market Access`,
        html,
      });
      if (sendErr) throw new Error(sendErr.message || JSON.stringify(sendErr));
      emailSent = true;

      await admin
        .from('email_subscriptions')
        .update({ last_sent_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch (err) {
      console.warn('[smart-match] instant alert email failed:', err.message);
    }
  }

  // 8. Mark these rows as notified regardless of email success — the match
  //    itself is now visible in-app, and we don't want to retry an email that
  //    failed for a transient reason on every subsequent page load.
  await admin
    .from('smart_matched_tenders')
    .update({ notified: true, notified_at: new Date().toISOString() })
    .in('id', pending.map(r => r.id));

  return { totalMatched: scored.length, newlyNotified: pending.length, emailSent };
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/smart-match/refresh
 * Invoke-on-use trigger — called by the client whenever the user opens
 * "My Tenders" / "Smart Matched Tenders". No request body required.
 */
router.post('/refresh', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await refreshSmartMatchesForUser(user.id);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[smart-match] refresh failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/smart-match/list
 * Returns the authenticated caller's stored smart matches, most relevant first.
 */
router.get('/list', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await getAdmin()
    .from('smart_matched_tenders')
    .select('*')
    .eq('user_id', user.id)
    .order('match_score', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ results: data || [] });
});

export default router;
