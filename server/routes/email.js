/**
 * Email Subscription Routes
 * ==========================
 * Manages user preferences for scheduled smart-matched tender digest emails.
 *
 * Endpoints:
 *   GET    /api/email/subscription       — get current user's subscription
 *   POST   /api/email/subscription       — create or update subscription (upsert)
 *   DELETE /api/email/subscription       — disable subscription (soft delete)
 *   POST   /api/email/send-test          — send a one-off test digest immediately
 *
 * Email service: Resend (https://resend.com) — configure RESEND_API_KEY in .env
 * Scheduler: node-cron in server/index.js — reads this table to dispatch digests
 *
 * Auth: Supabase JWT in Authorization header validates each request server-side
 */

import express from 'express';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { generalApiLimiter } from '../middleware/rateLimiters.js';
import { getActiveTenders } from '../services/tenderSync.js';

const router = express.Router();
router.use(generalApiLimiter);

// ── Clients ───────────────────────────────────────────────────────────────────
//
// All users — both those who log in directly AND those who arrive via the
// kumii.africa platform iframe — authenticate against the single Supabase
// project njcancswtqnxihxavshl.  The qypazgkngxhazgkuevwq project is used
// only for the api-read-profiles Edge Function and is unrelated to auth.

let _supabaseAdmin = null;
function getAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  _supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  );
  return _supabaseAdmin;
}

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured on server');
  return new Resend(key);
}

// ── JWT → user helper ─────────────────────────────────────────────────────────

/**
 * Resolve a Supabase user from the Bearer JWT.
 * Works for both direct-session tokens and iframe postMessage tokens —
 * both are issued by njcancswtqnxihxavshl so a single getAdmin() call suffices.
 */
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await getAdmin().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── Email HTML builder ────────────────────────────────────────────────────────

/**
 * Build a clean HTML digest email from an array of matched tenders.
 * @param {{ title, organOfState, closingDate, matchScore, category, ocid }[]} tenders
 * @param {string} recipientEmail
 * @param {number} minScore
 * @param {string} frequency
 */
export function buildDigestHtml(tenders, recipientEmail, minScore, frequency) {
  const today = new Date().toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const tenderRows = tenders.map(t => {
    const score = t.matchScore ?? t.match_score ?? 0;
    const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#f59e0b' : '#64748b';
    const closing = t.closingDate || t.closing_date
      ? new Date(t.closingDate || t.closing_date).toLocaleDateString('en-ZA', {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : 'See tender';

    return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top;">
          <div style="font-weight:700;font-size:14px;color:#1a1d23;margin-bottom:4px;">
            ${escHtml(t.title || t.tender?.title || 'Untitled Tender')}
          </div>
          <div style="font-size:12px;color:#64748b;">
            ${escHtml(t.organOfState || t.buyer?.name || t.organ_of_state || '')}
          </div>
        </td>
        <td style="padding:14px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;font-size:12px;color:#64748b;">
          ${escHtml(closing)}
        </td>
        <td style="padding:14px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;text-align:center;">
          <span style="display:inline-block;background:${scoreColor};color:#fff;border-radius:12px;
                       padding:3px 10px;font-size:12px;font-weight:700;">
            ${score}%
          </span>
        </td>
      </tr>`;
  }).join('');

  const freqLabel = frequency === 'daily' ? 'Daily' : 'Weekly';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kumii Market Access — ${freqLabel} Tender Digest</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#16a34a;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;">
              🏛️ Kumii Market Access
            </div>
            <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">
              ${freqLabel} Smart-Match Digest · ${today}
            </div>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="background:#fff;padding:24px 32px 16px;">
            <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
              We found <strong>${tenders.length} tender${tenders.length !== 1 ? 's' : ''}</strong>
              matching your profile with a score of <strong>${minScore}% or above</strong>.
            </p>
          </td>
        </tr>

        <!-- Table -->
        <tr>
          <td style="background:#fff;padding:0 32px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Tender</th>
                  <th style="padding:10px 8px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;">Closing</th>
                  <th style="padding:10px 8px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Score</th>
                </tr>
              </thead>
              <tbody>
                ${tenderRows}
              </tbody>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background:#fff;padding:24px 32px 32px;text-align:center;">
            <a href="https://kumii.africa/access-to-market"
               style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:14px;
                      padding:12px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
              View All Smart Matches →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f1f5f9;border-radius:0 0 12px 12px;padding:18px 32px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
              You're receiving this because you subscribed to ${freqLabel.toLowerCase()} tender alerts on
              Kumii Market Access.<br>
              Sent to ${escHtml(recipientEmail)}.<br>
              <a href="https://kumii.africa/access-to-market" style="color:#16a34a;text-decoration:none;">
                Update preferences
              </a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Keyword-based server-side matching ───────────────────────────────────────

/**
 * Score a single OCDS release against a list of AI keywords.
 * Mirrors the client-side matchTendersToProfile keyword pass.
 * Returns 0–100.
 */
function scoreAgainstKeywords(release, keywords) {
  if (!keywords || keywords.length === 0) return 0;

  const tenderText = [
    release.tender?.title        || '',
    release.tender?.description  || '',
    release.buyer?.name          || '',
    release.tender?.mainProcurementCategory || '',
    release.tender?.items?.map(i => i.description || '').join(' ') || '',
  ].join(' ').toLowerCase();

  const matched = keywords.filter(kw =>
    kw && tenderText.includes(kw.toLowerCase())
  ).length;

  return Math.round((matched / keywords.length) * 100);
}

// ── Core send helper (also used by cron job) ──────────────────────────────────

/**
 * Fetch smart-matched tenders for a user and dispatch a digest email.
 * Uses active_tenders (live source of truth) + the user's saved AI keywords
 * from ai_keyword_cache for per-user relevance scoring — mirrors the
 * client-side SmartMatchedTenders matching pattern.
 *
 * @param {{ userId, email, minScore, frequency }} subscription
 * @returns {Promise<{ sent: boolean, count: number, error?: string }>}
 */
export async function dispatchDigest({ userId, email, minScore = 40, frequency = 'weekly' }) {
  try {
    const admin = getAdmin();

    // 1. Fetch this user's AI keywords (written by SmartMatchedTenders enhanceWithAI)
    const { data: kwCache } = await admin
      .from('ai_keyword_cache')
      .select('keywords')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const keywords = Array.isArray(kwCache?.keywords) ? kwCache.keywords : [];

    // 2. Pull live tenders from active_tenders (background-synced hourly)
    const { results: allTenders } = await getActiveTenders({ limit: 3000 });

    if (!allTenders || allTenders.length === 0) {
      console.warn(`[email] No active tenders available for digest to ${email}`);
      return { sent: false, count: 0, error: 'No active tenders available' };
    }

    // 3. Score each tender against the user's keywords (or use a generous fallback)
    let matched;
    if (keywords.length > 0) {
      matched = allTenders
        .map(t => ({ ...t, matchScore: scoreAgainstKeywords(t, keywords) }))
        .filter(t => t.matchScore >= minScore)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 30);
    } else {
      // No keywords yet — send the most recently opened tenders as a generic digest
      matched = allTenders
        .map(t => ({ ...t, matchScore: 0 }))
        .slice(0, 15);
    }

    if (matched.length === 0) {
      console.log(`[email] No tenders ≥${minScore}% match for ${email} — skipping`);
      return { sent: false, count: 0, error: `No tenders above ${minScore}% threshold` };
    }

    // 4. Normalise shape for buildDigestHtml
    const normalised = matched.map(t => ({
      title:        t.tender?.title        || t.title        || 'Untitled Tender',
      organOfState: t.buyer?.name          || t.organOfState || '',
      closingDate:  t.tender?.tenderPeriod?.endDate || t.closingDate || null,
      matchScore:   t.matchScore,
      category:     t.tender?.mainProcurementCategory || t.category || '',
      ocid:         t.ocid || '',
    }));

    const html = buildDigestHtml(normalised, email, minScore, frequency);
    const freqLabel = frequency === 'daily' ? 'Daily' : 'Weekly';
    const resend = getResend();

    const { error: sendErr } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Market Access <alerts@kumii.africa>',
      to:   email,
      subject: `🏛️ ${freqLabel} Tender Digest — ${normalised.length} match${normalised.length !== 1 ? 'es' : ''} above ${minScore}%`,
      html,
    });

    if (sendErr) throw new Error(sendErr.message || JSON.stringify(sendErr));

    // Update last_sent_at (best-effort)
    await admin
      .from('email_subscriptions')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('user_id', userId);

    console.log(`✅ [email] Digest sent to ${email} — ${normalised.length} tenders (${keywords.length} keywords)`);
    return { sent: true, count: normalised.length };

  } catch (err) {
    console.error(`❌ [email] dispatchDigest failed for ${email}:`, err.message);
    return { sent: false, count: 0, error: err.message };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/email/subscription
 * Returns the authenticated user's subscription (or null).
 */
router.get('/subscription', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await getAdmin()
    .from('email_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ subscription: data || null });
});

/**
 * POST /api/email/subscription
 * Create or update (upsert) the authenticated user's subscription.
 * Body: { email, frequency, minScore, enabled }
 */
router.post('/subscription', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const {
    email    = user.email,
    frequency = 'weekly',
    minScore  = 40,
    enabled   = true,
  } = req.body || {};

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!['daily', 'weekly'].includes(frequency))
    return res.status(400).json({ error: 'frequency must be "daily" or "weekly"' });
  if (typeof minScore !== 'number' || minScore < 0 || minScore > 100)
    return res.status(400).json({ error: 'minScore must be 0–100' });

  const { data, error } = await getAdmin()
    .from('email_subscriptions')
    .upsert(
      {
        user_id:   user.id,
        email,
        frequency,
        min_score: minScore,
        enabled,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ subscription: data });
});

/**
 * DELETE /api/email/subscription
 * Disables (soft-deletes) the subscription — sets enabled=false.
 */
router.delete('/subscription', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { error } = await getAdmin()
    .from('email_subscriptions')
    .update({ enabled: false })
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

/**
 * POST /api/email/send-test
 * Immediately dispatch a digest to the authenticated user.
 * Useful for testing and for "Send now" UI button.
 */
router.post('/send-test', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { email = user.email, minScore = 40, frequency = 'weekly' } = req.body || {};

  const result = await dispatchDigest({
    userId: user.id,
    email,
    minScore,
    frequency,
  });

  if (!result.sent) {
    return res.status(422).json({ error: result.error || 'Digest not sent' });
  }
  return res.json({ success: true, count: result.count });
});

export default router;
