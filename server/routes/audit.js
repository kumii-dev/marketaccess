/**
 * Audit Log Receiver — /admin/audit-logs
 *
 * 🔒 COMPLIANCE:
 * - ISO 27001:2022  A.12.4.1  Event Logging
 * - NIST SP 800-53  AU-2, AU-3, AU-6, AU-9, AU-12
 * - OWASP Logging Cheat Sheet
 * - GDPR Article 30  Records of Processing Activities
 * - POPIA Section 51  Security Measures
 *
 * Accepts batched log payloads from the React frontend,
 * writes them to Supabase using the service-role key
 * (bypasses RLS so the backend owns every insert),
 * and returns structured acknowledgement.
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// ── Supabase admin client (service-role, server-side only) ───────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: { persistSession: false, autoRefreshToken: false }
  }
);

// ── Allowed categories / levels / results (mirrors SQL constraints)
const VALID_CATEGORIES = new Set([
  'AUTHENTICATION','AUTHORIZATION','ACCESS_CONTROL',
  'AI_OPERATION','AI_COST','AI_SECURITY',
  'DATA_ACCESS','DATA_MODIFICATION','DATA_EXPORT','PII_ACCESS',
  'SYSTEM_ERROR','PERFORMANCE','AVAILABILITY',
  'RATE_LIMIT','POLICY_VIOLATION','COMPLIANCE_CHECK',
  'TENDER_ACCESS','MATCHING_OPERATION','USER_ACTIVITY'
]);
const VALID_LEVELS   = new Set(['CRITICAL','HIGH','MEDIUM','LOW','INFO']);
const VALID_RESULTS  = new Set(['SUCCESS','FAILURE','PARTIAL','BLOCKED','ERROR']);

// ── Max batch size accepted per request (OWASP API4 protection) ──
const MAX_BATCH_SIZE = 100;

/**
 * Sanitise a single log entry coming from the frontend:
 * - Validates required fields
 * - Normalises column names (camelCase → snake_case)
 * - Strips unknown / dangerous fields
 * Returns null if the entry is invalid.
 */
function sanitiseEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const category = (raw.category || '').toUpperCase();
  const level    = (raw.level    || '').toUpperCase();
  const result   = (raw.result   || '').toUpperCase();

  if (!VALID_CATEGORIES.has(category)) return null;
  if (!VALID_LEVELS.has(level))        return null;
  if (!VALID_RESULTS.has(result))      return null;
  if (!raw.action   || typeof raw.action   !== 'string') return null;
  if (!raw.resource || typeof raw.resource !== 'string') return null;

  // session_id: accept camelCase or snake_case from client
  const sessionId = (raw.sessionId || raw.session_id || '').toString().trim();
  if (!sessionId) return null;

  return {
    // timestamps
    event_time:   raw.event_time  || raw.eventTime  || new Date().toISOString(),
    // event_date is GENERATED — do NOT insert it

    // session / correlation
    session_id:     sessionId,
    correlation_id: raw.correlationId || raw.correlation_id || null,

    // user (nullable)
    user_id:    raw.userId    || raw.user_id    || null,
    user_email: raw.userEmail || raw.user_email || null,
    user_role:  raw.userRole  || raw.user_role  || null,

    // classification
    category,
    level,
    action:   raw.action.substring(0, 255),
    resource: raw.resource.substring(0, 255),
    result,

    // system context
    source_ip:  raw.sourceIp  || raw.source_ip  || null,
    user_agent: raw.userAgent || raw.user_agent || null,
    platform:   raw.platform  || null,
    location:   raw.location  || null,

    // compliance
    frameworks:    Array.isArray(raw.frameworks) ? raw.frameworks : [],
    metadata:      (raw.metadata && typeof raw.metadata === 'object') ? raw.metadata : {},
    sensitive_data: !!raw.sensitiveData || !!raw.sensitive_data
  };
}

// ══════════════════════════════════════════════════════════════════
// POST /admin/audit-logs
// Accept a batch of audit log entries from the React app.
// ══════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

  try {
    const { batch, batchMetadata } = req.body;

    // ── Input validation ───────────────────────────────────────────
    if (!Array.isArray(batch) || batch.length === 0) {
      return res.status(400).json({
        success: false,
        requestId,
        error: 'Request body must contain a non-empty "batch" array'
      });
    }

    if (batch.length > MAX_BATCH_SIZE) {
      return res.status(413).json({
        success: false,
        requestId,
        error: `Batch exceeds maximum size of ${MAX_BATCH_SIZE}`
      });
    }

    // ── Sanitise & validate each entry ────────────────────────────
    const accepted = [];
    const rejected = [];

    for (let i = 0; i < batch.length; i++) {
      const clean = sanitiseEntry(batch[i]);
      if (clean) {
        accepted.push(clean);
      } else {
        rejected.push({ index: i, reason: 'Failed validation' });
      }
    }

    // ── Write accepted entries to Supabase ────────────────────────
    let inserted = 0;
    let dbError  = null;

    if (accepted.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { error } = await supabaseAdmin
        .from('audit_logs')
        .insert(accepted);

      if (error) {
        dbError = error.message;
        console.error('❌ [audit] Supabase insert error:', error.message);
      } else {
        inserted = accepted.length;
        console.log(`✅ [audit] Inserted ${inserted} log(s) | batch: ${batchMetadata?.batchId || requestId}`);
      }
    } else if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Service role key not configured — log locally and continue
      console.warn('⚠️  [audit] SUPABASE_SERVICE_ROLE_KEY not set — entries logged to stdout only');
      accepted.forEach(e => {
        console.log('[AUDIT]', JSON.stringify({
          level: e.level,
          category: e.category,
          action: e.action,
          result: e.result,
          event_time: e.event_time
        }));
      });
      inserted = accepted.length;
    }

    // ── Log critical events to console for alerting ───────────────
    const criticalEvents = accepted.filter(e => e.level === 'CRITICAL' || e.level === 'HIGH');
    if (criticalEvents.length > 0) {
      console.warn(`🚨 [audit] ${criticalEvents.length} CRITICAL/HIGH event(s) received:`);
      criticalEvents.forEach(e => {
        console.warn(`   [${e.level}] ${e.category} | ${e.action} | ${e.result} | user: ${e.user_email || 'anonymous'}`);
      });
    }

    // ── Response ───────────────────────────────────────────────────
    return res.status(dbError ? 207 : 200).json({
      success: !dbError,
      requestId,
      received:  batch.length,
      accepted:  accepted.length,
      inserted,
      rejected:  rejected.length,
      ...(rejected.length > 0 && { rejectedDetails: rejected }),
      ...(dbError && { dbError }),
      serverTime: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ [audit] Unhandled error:', err.message);
    return res.status(500).json({
      success: false,
      requestId,
      error: 'Internal server error'
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /admin/audit-logs/health
// Simple health check — confirms the endpoint is live.
// ══════════════════════════════════════════════════════════════════
router.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    endpoint: '/admin/audit-logs',
    serviceRoleConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    timestamp: new Date().toISOString()
  });
});

// ══════════════════════════════════════════════════════════════════
// GET /admin/audit-logs/stats
// Quick aggregate stats for the dashboard — ISO 27001 AU-6
// Requires SUPABASE_SERVICE_ROLE_KEY to be set.
// ══════════════════════════════════════════════════════════════════
router.get('/stats', async (_req, res) => {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Stats unavailable — service role key not configured' });
    }

    // Last 24 hours summary
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from('audit_logs')
      .select('level, category, result')
      .gte('event_time', since);

    if (error) throw error;

    // Aggregate in-process (small result set)
    const stats = {
      last24h: { total: rows.length, byLevel: {}, byCategory: {}, byResult: {} }
    };

    for (const row of rows) {
      stats.last24h.byLevel[row.level]       = (stats.last24h.byLevel[row.level]       || 0) + 1;
      stats.last24h.byCategory[row.category] = (stats.last24h.byCategory[row.category] || 0) + 1;
      stats.last24h.byResult[row.result]     = (stats.last24h.byResult[row.result]     || 0) + 1;
    }

    return res.json({ success: true, stats, generatedAt: new Date().toISOString() });

  } catch (err) {
    console.error('❌ [audit/stats]', err.message);
    return res.status(500).json({ error: 'Failed to generate stats' });
  }
});

export default router;
