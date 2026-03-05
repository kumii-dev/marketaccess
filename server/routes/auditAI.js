/**
 * AI-Powered Audit Intelligence Endpoints
 *
 * Uses OpenAI gpt-4o-mini server-side to generate:
 *   1. POST /api/ai/audit/threat-summary    — plain-English threat brief
 *   2. POST /api/ai/audit/anomaly-detect    — behavioural anomaly flags
 *   3. POST /api/ai/audit/compliance-report — ISO 27001 / GDPR / POPIA narrative
 *
 * 🔒 COMPLIANCE:
 *   ISO 27001:2022  A.12.4.1  Event Logging
 *   ISO 27001:2022  A.12.6.1  Management of Technical Vulnerabilities
 *   NIST SP 800-53  AU-6      Audit Record Review, Analysis, Reporting
 *   NIST SP 800-53  SI-4      System Monitoring
 *   NIST AI RMF     MEASURE   AI Performance & Risk Monitoring
 *   GDPR Art. 30    Records of Processing Activities
 *   POPIA S.51      Security Measures
 *
 * All three endpoints:
 *   - Read audit_logs from Supabase using the service-role key
 *   - Call OpenAI server-side (API key NEVER reaches the browser)
 *   - Write their own AI cost back to audit_logs via the existing receiver
 *   - Are rate-limited by the existing aiEndpointLimiter
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { aiEndpointLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

// ── Apply AI rate limiter to all routes in this file ──────────────
router.use(aiEndpointLimiter);

// ── Lazy Supabase admin client (same pattern as audit.js) ─────────
let _supabaseAdmin = null;
function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  _supabaseAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _supabaseAdmin;
}

// ── OpenAI call helper ────────────────────────────────────────────
async function callOpenAI({ systemPrompt, userPrompt, maxTokens = 600, temperature = 0.3 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured on server');

  const start = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const durationMs = Date.now() - start;

  return {
    content:   data.choices[0]?.message?.content || '',
    usage:     data.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
    durationMs,
    model:     data.model || 'gpt-4o-mini'
  };
}

// ── Write AI cost back to audit_logs (fire-and-forget) ───────────
async function logAIAuditCost({ operation, tokensUsed, cost, durationMs, requestId }) {
  const db = getSupabaseAdmin();
  if (!db) return;

  const entry = {
    event_time:    new Date().toISOString(),
    session_id:    requestId,
    category:      'AI_OPERATION',
    level:         'INFO',
    action:        'AI Audit Intelligence',
    resource:      `AI Model: gpt-4o-mini`,
    result:        'SUCCESS',
    frameworks:    ['NIST_AI_RMF', 'ISO27001'],
    metadata: {
      operation,
      model:          'gpt-4o-mini',
      tokensUsed,
      cost,
      costCurrency:   'USD',
      durationMs,
      nistAIFunction: 'MEASURE',
      iso27001Control:'A.12.4.1',
      applicationName:'MarketAccess'
    },
    sensitive_data: false
  };

  await db.from('audit_logs').insert(entry).catch(e =>
    console.warn('⚠️ [auditAI] Failed to log AI cost:', e.message)
  );
}

// ── Fetch recent audit_logs from Supabase ────────────────────────
async function fetchRecentLogs({ hoursBack = 24, limit = 200 } = {}) {
  const db = getSupabaseAdmin();
  if (!db) return [];

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('audit_logs')
    .select('event_time, level, category, action, resource, result, user_email, frameworks, metadata, sensitive_data')
    .gte('event_time', since)
    .order('event_time', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Supabase read error: ${error.message}`);
  return data || [];
}

// ── Serialise logs into a compact text block for GPT ─────────────
function logsToText(logs) {
  if (logs.length === 0) return 'No audit log entries found for this period.';

  return logs.map((l, i) => {
    const ts  = new Date(l.event_time).toISOString().replace('T', ' ').slice(0, 19);
    const fw  = (l.frameworks || []).join(', ') || '—';
    const meta = l.metadata ? Object.entries(l.metadata)
      .filter(([k]) => ['cost','tokensUsed','operation','errorCode','owaspCategory',
                        'iso27001Control','nistControl','gdprArticle'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') : '';
    return `${i + 1}. [${ts}] ${l.level} | ${l.category} | ${l.action} | ${l.resource} | ${l.result} | user=${l.user_email || 'anonymous'} | fw=[${fw}]${meta ? ' | ' + meta : ''}`;
  }).join('\n');
}


// ══════════════════════════════════════════════════════════════════
// POST /api/ai/audit/threat-summary
//
// Returns a plain-English executive threat brief covering the last
// N hours of audit logs.  Ideal for the Security tab alert panel.
// ══════════════════════════════════════════════════════════════════
router.post('/threat-summary', async (req, res) => {
  const requestId = `threat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const hoursBack = Math.min(parseInt(req.body?.hoursBack) || 24, 168); // max 7 days

    const logs = await fetchRecentLogs({ hoursBack, limit: 200 });

    // Aggregate basic counts for the prompt
    const counts = { total: logs.length, byLevel: {}, byCategory: {}, byResult: {} };
    for (const l of logs) {
      counts.byLevel[l.level]       = (counts.byLevel[l.level]       || 0) + 1;
      counts.byCategory[l.category] = (counts.byCategory[l.category] || 0) + 1;
      counts.byResult[l.result]     = (counts.byResult[l.result]     || 0) + 1;
    }

    const systemPrompt = `You are a senior Information Security Officer writing executive-level threat briefings for a South African government tender platform (MarketAccess on kumii.africa).

Your briefings must:
- Be concise (200–350 words)
- Use plain English — no jargon acronyms without explanation
- Lead with the most critical finding
- Mention specific users, IPs or resources when present in the data
- Reference compliance frameworks where relevant (ISO 27001, GDPR, POPIA, NIST, OWASP)
- End with a 2–3 bullet "Recommended Actions" list
- Use the tone of a formal but readable board-level security report

Do NOT invent events not in the data. If there are no threats, say the platform is operating normally.`;

    const userPrompt = `Generate a threat briefing for the last ${hoursBack} hours.

SUMMARY COUNTS:
Total events: ${counts.total}
By level: ${JSON.stringify(counts.byLevel)}
By category: ${JSON.stringify(counts.byCategory)}
By result: ${JSON.stringify(counts.byResult)}

DETAILED LOG ENTRIES (most recent first):
${logsToText(logs)}

Write the threat briefing now.`;

    const ai = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 600, temperature: 0.3 });

    // Cost calculation: gpt-4o-mini $0.15/1M input + $0.60/1M output
    const cost = (ai.usage.prompt_tokens * 0.00000015) + (ai.usage.completion_tokens * 0.00000060);

    // Log AI cost back to audit_logs (fire-and-forget)
    logAIAuditCost({ operation: 'threat-summary', tokensUsed: ai.usage.total_tokens, cost, durationMs: ai.durationMs, requestId });

    return res.json({
      success:    true,
      requestId,
      hoursBack,
      logsAnalysed: logs.length,
      summary:    ai.content,
      meta: {
        model:      ai.model,
        tokensUsed: ai.usage.total_tokens,
        costUSD:    cost.toFixed(6),
        durationMs: ai.durationMs,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('❌ [auditAI/threat-summary]', err.message);
    return res.status(500).json({ success: false, requestId, error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════
// POST /api/ai/audit/anomaly-detect
//
// Detects behavioural anomalies: brute-force patterns, unusual AI
// usage spikes, after-hours access, repeated rate-limit hits, etc.
// Returns a structured JSON array of anomaly objects.
// ══════════════════════════════════════════════════════════════════
router.post('/anomaly-detect', async (req, res) => {
  const requestId = `anomaly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const hoursBack = Math.min(parseInt(req.body?.hoursBack) || 24, 72);

    const logs = await fetchRecentLogs({ hoursBack, limit: 300 });

    // Pre-compute per-user and per-IP stats to help GPT
    const userStats = {};
    const ipStats   = {};

    for (const l of logs) {
      const u = l.user_email || 'anonymous';
      if (!userStats[u]) userStats[u] = { total: 0, failures: 0, rateLimits: 0, aiCalls: 0, categories: {} };
      userStats[u].total++;
      if (l.result === 'FAILURE' || l.result === 'BLOCKED' || l.result === 'ERROR') userStats[u].failures++;
      if (l.category === 'RATE_LIMIT') userStats[u].rateLimits++;
      if (l.category === 'AI_OPERATION') userStats[u].aiCalls++;
      userStats[u].categories[l.category] = (userStats[u].categories[l.category] || 0) + 1;

      const ip = l.metadata?.sourceIp || l.source_ip;
      if (ip && ip !== 'client-ip-from-backend') {
        if (!ipStats[ip]) ipStats[ip] = { total: 0, failures: 0, users: new Set() };
        ipStats[ip].total++;
        if (l.result === 'FAILURE' || l.result === 'BLOCKED') ipStats[ip].failures++;
        ipStats[ip].users.add(u);
      }
    }

    // Convert Sets to counts for JSON serialisation
    const ipStatsSafe = Object.fromEntries(
      Object.entries(ipStats).map(([ip, s]) => [ip, { ...s, distinctUsers: s.users.size, users: undefined }])
    );

    const systemPrompt = `You are a behavioural anomaly detection engine for a South African government tender platform (MarketAccess).

Analyse the audit log data and identify suspicious patterns such as:
- Brute-force login attempts (multiple failures from same user/IP in short window)
- Credential stuffing (many users failing from same IP)
- Unusual AI usage spikes (far above normal per-user baseline)
- Repeated rate-limit violations by same user
- After-hours access to sensitive resources (PII, tenders)
- Accounts accessing resources far outside their normal category pattern
- Any result=CRITICAL or result=ERROR clusters

Respond with ONLY a valid JSON array. Each element must have:
{
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "type": short anomaly type string,
  "description": one-sentence plain English description,
  "affectedEntity": user email, IP, or resource name,
  "eventCount": number of related events,
  "recommendation": one concrete action to take,
  "frameworks": array of relevant compliance framework strings
}

If no anomalies are found, return an empty array [].
Do NOT include any text outside the JSON array.`;

    const userPrompt = `Analyse for anomalies over the last ${hoursBack} hours.

PER-USER STATISTICS:
${JSON.stringify(userStats, null, 2)}

PER-IP STATISTICS:
${JSON.stringify(ipStatsSafe, null, 2)}

RAW LOG ENTRIES:
${logsToText(logs)}`;

    const ai = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 800, temperature: 0.1 });

    // Parse JSON array from GPT
    let anomalies = [];
    try {
      const cleaned = ai.content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      anomalies = JSON.parse(cleaned);
      if (!Array.isArray(anomalies)) anomalies = [];
    } catch {
      console.warn('⚠️ [auditAI/anomaly-detect] GPT did not return valid JSON, raw:', ai.content.slice(0, 200));
      anomalies = [];
    }

    const cost = (ai.usage.prompt_tokens * 0.00000015) + (ai.usage.completion_tokens * 0.00000060);
    logAIAuditCost({ operation: 'anomaly-detect', tokensUsed: ai.usage.total_tokens, cost, durationMs: ai.durationMs, requestId });

    return res.json({
      success:      true,
      requestId,
      hoursBack,
      logsAnalysed: logs.length,
      anomalyCount: anomalies.length,
      anomalies,
      meta: {
        model:       ai.model,
        tokensUsed:  ai.usage.total_tokens,
        costUSD:     cost.toFixed(6),
        durationMs:  ai.durationMs,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('❌ [auditAI/anomaly-detect]', err.message);
    return res.status(500).json({ success: false, requestId, error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════
// POST /api/ai/audit/compliance-report
//
// Generates a formal compliance narrative for a given framework
// (ISO27001, GDPR, POPIA, NIST_800_53, NIST_AI_RMF, OWASP_API)
// covering a specified date range.  Ready to paste into a report.
// ══════════════════════════════════════════════════════════════════
router.post('/compliance-report', async (req, res) => {
  const requestId = `compliance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const VALID_FRAMEWORKS = ['ISO27001', 'GDPR', 'POPIA', 'NIST_800_53', 'NIST_AI_RMF', 'OWASP_API', 'ALL'];
    const framework = (req.body?.framework || 'ALL').toUpperCase();
    const hoursBack = Math.min(parseInt(req.body?.hoursBack) || 168, 720); // default 7 days, max 30

    if (!VALID_FRAMEWORKS.includes(framework)) {
      return res.status(400).json({
        success: false,
        requestId,
        error: `Invalid framework. Must be one of: ${VALID_FRAMEWORKS.join(', ')}`
      });
    }

    // Fetch logs — filter by framework if specific one requested
    const logs = await fetchRecentLogs({ hoursBack, limit: 300 });
    const filtered = framework === 'ALL'
      ? logs
      : logs.filter(l => (l.frameworks || []).includes(framework));

    // Build control mapping summary
    const controlHits = {};
    for (const l of filtered) {
      const meta = l.metadata || {};
      const controls = [
        meta.iso27001Control,
        meta.nistControl,
        meta.owaspCategory,
        meta.gdprArticle,
        meta.popiaSection,
        meta.nistAIFunction
      ].filter(Boolean);

      for (const ctrl of controls) {
        if (!controlHits[ctrl]) controlHits[ctrl] = { count: 0, failures: 0, categories: new Set() };
        controlHits[ctrl].count++;
        if (['FAILURE','BLOCKED','ERROR'].includes(l.result)) controlHits[ctrl].failures++;
        controlHits[ctrl].categories.add(l.category);
      }
    }

    const controlSummary = Object.fromEntries(
      Object.entries(controlHits).map(([ctrl, s]) => [
        ctrl, { count: s.count, failures: s.failures, categories: [...s.categories] }
      ])
    );

    // Period string
    const now = new Date();
    const from = new Date(now - hoursBack * 60 * 60 * 1000);
    const period = `${from.toDateString()} to ${now.toDateString()}`;

    const frameworkDescriptions = {
      ISO27001:    'ISO/IEC 27001:2022 Information Security Management System',
      GDPR:        'EU General Data Protection Regulation (GDPR)',
      POPIA:       'South African Protection of Personal Information Act (POPIA)',
      NIST_800_53: 'NIST SP 800-53 Rev 5 Security and Privacy Controls',
      NIST_AI_RMF: 'NIST AI Risk Management Framework 1.0',
      OWASP_API:   'OWASP API Security Top 10 2023',
      ALL:         'ISO 27001, GDPR, POPIA, NIST SP 800-53, NIST AI RMF, and OWASP API Security'
    };

    const systemPrompt = `You are a compliance officer writing a formal audit report section for a South African government tender platform called MarketAccess, operated under the kumii.africa platform.

Write in formal but accessible British English. Structure the report as:

1. EXECUTIVE SUMMARY (2–3 sentences)
2. SCOPE AND PERIOD
3. CONTROL COVERAGE (list each control referenced, with event counts and pass/fail status)
4. KEY FINDINGS (bullet list — highlight any failures or gaps)
5. GDPR / POPIA DATA PROCESSING RECORD (if applicable — list PII events with legal basis)
6. COMPLIANCE POSTURE ASSESSMENT (brief paragraph: overall rating — Compliant / Partially Compliant / Non-Compliant with justification)
7. RECOMMENDATIONS (numbered list, max 5)

Use only data provided. Do not invent controls or events not evidenced in the logs.
Use section headers in ALL CAPS followed by a colon.`;

    const userPrompt = `Generate a ${frameworkDescriptions[framework]} compliance report.

PLATFORM: MarketAccess — Government Tender Access Platform (South Africa)
REPORTING PERIOD: ${period}
FRAMEWORK: ${frameworkDescriptions[framework]}
TOTAL EVENTS IN SCOPE: ${filtered.length} (of ${logs.length} total in period)

CONTROL REFERENCE HITS:
${JSON.stringify(controlSummary, null, 2)}

DETAILED LOG ENTRIES:
${logsToText(filtered)}

Write the compliance report now.`;

    const ai = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 1200, temperature: 0.2 });

    const cost = (ai.usage.prompt_tokens * 0.00000015) + (ai.usage.completion_tokens * 0.00000060);
    logAIAuditCost({ operation: 'compliance-report', tokensUsed: ai.usage.total_tokens, cost, durationMs: ai.durationMs, requestId });

    return res.json({
      success:        true,
      requestId,
      framework,
      period,
      hoursBack,
      logsAnalysed:   filtered.length,
      report:         ai.content,
      controlCoverage: controlSummary,
      meta: {
        model:       ai.model,
        tokensUsed:  ai.usage.total_tokens,
        costUSD:     cost.toFixed(6),
        durationMs:  ai.durationMs,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('❌ [auditAI/compliance-report]', err.message);
    return res.status(500).json({ success: false, requestId, error: err.message });
  }
});


export default router;
