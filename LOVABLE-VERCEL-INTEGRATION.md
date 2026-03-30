# Lovable ↔ Vercel Integration Guide

How to connect any Vercel backend project to the **kumii.africa** Lovable dashboard.  
Derived from the working `marketaccess` integration.

---

## Architecture Overview

```
Lovable Dashboard (kumii.africa)
        │
        │  reads via Supabase anon key  (SELECT only)
        ▼
  Supabase (njcancswtqnxihxavshl)
        ▲
        │  writes via service_role key  (INSERT / UPDATE)
        │
Vercel Backend (yourproject.vercel.app)
        ▲
        │  HTTP POST (JSON)
        │
React Frontend (yourproject.vercel.app)
```

**Rule:** Lovable never writes. Vercel never exposes the service_role key to the browser.

---

## Part 1 — Vercel Project Setup

### 1.1 `vercel.json`

Required for every project that serves both a static React frontend and an Express backend from the same deployment.

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server/index.js",
      "use": "@vercel/node"
    },
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "server/index.js"
    },
    {
      "source": "/admin/audit-logs/(.*)",
      "destination": "server/index.js"
    },
    {
      "source": "/admin/audit-logs",
      "destination": "server/index.js"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "ALLOW-FROM https://kumii.africa"
        },
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors 'self' https://kumii.africa https://*.lovable.app https://*.lovableproject.com"
        }
      ]
    }
  ],
  "env": {
    "PORT": "3001"
  }
}
```

**Key points:**
- The `X-Frame-Options` and `Content-Security-Policy` headers allow Lovable to embed your Vercel app in an iframe.
- Add a rewrite for every route group your backend serves (e.g. `/api/(.*)`, `/admin/(.*)`).
- `"distDir": "dist"` must match your Vite/build output folder.

---

### 1.2 Required Vercel Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://njcancswtqnxihxavshl.supabase.co` | Shared across all projects |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role_key_here` | **Never expose to browser** |
| `OPENAI_API_KEY` | `sk-...` | Server-side only — no `VITE_` prefix |
| `VITE_SUPABASE_URL` | `https://njcancswtqnxihxavshl.supabase.co` | Frontend reads this at build time |
| `VITE_SUPABASE_ANON_KEY` | `anon_key_here` | Safe to expose — SELECT only after RLS |
| `VITE_API_BASE_URL` | *(leave empty in production)* | Empty = same-origin relative paths |

> ⚠️ **Never add `VITE_OPENAI_API_KEY`** — the `VITE_` prefix bakes the value into the browser bundle.

---

### 1.3 Audit Log Receiver Endpoint

Every Vercel project that should write to the shared `audit_logs` table needs this route pattern.

```js
// server/routes/audit.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// POST /admin/audit-logs  — receives batches from the frontend auditLogger
router.post('/', async (req, res) => {
  const { batch } = req.body;
  if (!Array.isArray(batch) || batch.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a non-empty "batch" array' });
  }

  const rows = batch.map(entry => ({
    event_time:    entry.timestamp || new Date().toISOString(),
    session_id:    entry.sessionId || `session-${Date.now()}`,
    user_email:    entry.userEmail || null,
    category:      entry.category  || 'USER_ACTIVITY',
    level:         entry.level     || 'INFO',
    action:        entry.action    || 'Unknown Action',
    resource:      entry.resource  || 'Unknown Resource',
    result:        entry.result    || 'SUCCESS',
    frameworks:    entry.frameworks || [],
    metadata:      entry.metadata  || {},
    sensitive_data: entry.sensitiveData || false
  }));

  const { error } = await supabaseAdmin.from('audit_logs').insert(rows);
  if (error) {
    console.error('audit_logs INSERT failed:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ inserted: rows.length });
});

// GET /admin/audit-logs/health
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    serviceRoleConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    timestamp: new Date().toISOString()
  });
});

// GET /admin/audit-logs/stats  — used by Lovable dashboard
router.get('/stats', async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('level, category, result')
    .gte('event_time', since);

  if (error) return res.status(500).json({ error: error.message });

  const stats = { total: data.length, byLevel: {}, byCategory: {}, byResult: {} };
  data.forEach(row => {
    stats.byLevel[row.level]       = (stats.byLevel[row.level]       || 0) + 1;
    stats.byCategory[row.category] = (stats.byCategory[row.category] || 0) + 1;
    stats.byResult[row.result]     = (stats.byResult[row.result]     || 0) + 1;
  });

  res.json({ success: true, stats: { last24h: stats } });
});

export default router;
```

Mount it in `server/index.js`:
```js
import auditRouter from './routes/audit.js';
app.use('/admin/audit-logs', auditRouter);
```

---

### 1.4 Critical: `await` Every Supabase Write Before `res.json()`

Vercel serverless functions **terminate immediately** when `res.json()` is called. Any unawaited promise is killed.

```js
// ❌ WRONG — Supabase write is killed before it completes
supabaseAdmin.from('audit_logs').insert(row);
return res.json({ ok: true });

// ✅ CORRECT — write completes before the function exits
await supabaseAdmin.from('audit_logs').insert(row);
return res.json({ ok: true });
```

This applies to every fire-and-forget logging pattern. Always `await`.

---

## Part 2 — Supabase Setup

### 2.1 RLS Policies Required for Every New Project

Run this in the **Supabase SQL Editor** (`njcancswtqnxihxavshl`):

```sql
-- Allow the Vercel backend (service_role) to INSERT
-- (This is usually already set — service_role bypasses RLS by default)

-- Allow the Lovable dashboard (anon key) to SELECT
CREATE POLICY audit_logs_anon_read ON public.audit_logs
  FOR SELECT TO anon USING (true);

-- Grant SELECT on supporting views used by the dashboard
GRANT SELECT ON public.audit_logs TO anon;
GRANT SELECT ON public.ai_cost_summary TO anon;
GRANT SELECT ON public.security_events_summary TO anon;
GRANT SELECT ON public.compliance_events TO anon;
```

> If you get `ERROR: 42710: policy already exists` — the policy is already there, skip `CREATE POLICY` and run only the `GRANT` lines.

### 2.2 Verify with `curl`

```bash
# 1. Check health — confirms service_role is configured
curl https://yourproject.vercel.app/admin/audit-logs/health

# 2. Test write path
curl -X POST https://yourproject.vercel.app/admin/audit-logs \
  -H "Content-Type: application/json" \
  -d '{"batch":[{"category":"USER_ACTIVITY","level":"INFO","action":"Test","resource":"Verify","result":"SUCCESS"}]}'

# 3. Verify the row landed (using anon key)
ANON_KEY="your_anon_key_here"
curl "https://njcancswtqnxihxavshl.supabase.co/rest/v1/audit_logs?select=id,event_time,action&order=event_time.desc&limit=3" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

---

## Part 3 — Frontend `auditLogger.js`

Copy this file into every new React project at `src/utils/auditLogger.js`.

### 3.1 The Three Bugs to Never Repeat

| Bug | Symptom | Fix |
|---|---|---|
| Wrong endpoint URL | Logs never arrive — silently POSTed to the wrong host | Set `this.endpoint` to `https://yourproject.vercel.app/admin/audit-logs` |
| Batch only on full queue | Short sessions (< 10 events) never flushed | Flush every 5 s if `queue.length > 0` |
| `storeInSupabase()` with anon key | RLS blocks INSERT silently | Remove — only Vercel writes with service_role |

### 3.2 Minimal Correct `auditLogger.js`

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yourproject.vercel.app';

class AuditLogger {
  constructor() {
    this.endpoint = `${API_BASE_URL}/admin/audit-logs`;
    this.queue = [];
    this.batchSize = 10;
    this.flushIntervalMs = 5000; // flush every 5s if queue has anything
    this.startBatchProcessor();
  }

  log(category, level, action, resource, result = 'SUCCESS', metadata = {}, frameworks = []) {
    const entry = {
      timestamp:  new Date().toISOString(),
      sessionId:  this.getSessionId(),
      userEmail:  this.getUserEmail(),
      category, level, action, resource, result, metadata, frameworks
    };

    // Immediate flush for critical/high severity
    if (level === 'CRITICAL' || level === 'HIGH') {
      this.sendBatch([entry]);
      return;
    }

    this.queue.push(entry);
    if (this.queue.length >= this.batchSize) this.flush();
  }

  flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.sendBatch(batch);
  }

  async sendBatch(batch) {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch }),
        keepalive: true   // survives page unload
      });
    } catch (e) {
      console.warn('AuditLogger: failed to send batch', e.message);
    }
  }

  startBatchProcessor() {
    setInterval(() => this.flush(), this.flushIntervalMs);
    window.addEventListener('beforeunload', () => this.flush());
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  getSessionId() { /* return sessionStorage session id */ }
  getUserEmail() { /* return from auth context */ }
}

export const auditLogger = new AuditLogger();
export const logSystemError = (error, context, level = 'MEDIUM', metadata = {}) =>
  auditLogger.log('SYSTEM_ERROR', level, 'System Error', context, 'FAILURE', { error: error.message, ...metadata });
```

---

## Part 4 — Lovable Dashboard Configuration

### 4.1 Connecting a New Project to the Dashboard

In the Lovable dashboard source code, the Supabase client is already initialised with the anon key. To add data from a new project:

1. The new project must write to the **same Supabase project** (`njcancswtqnxihxavshl`) using `service_role`.
2. Add a `source` or `application_name` field to `metadata` so the dashboard can filter by project:
   ```js
   metadata: { applicationName: 'YourProjectName', source: 'server/routes/ai.js' }
   ```
3. No dashboard code changes needed — existing queries on `audit_logs` will automatically include the new project's rows.

### 4.2 CORS — Allow Lovable to Call Your Vercel Backend

In `server/index.js`:

```js
import cors from 'cors';

app.use(cors({
  origin: [
    'https://kumii.africa',
    'https://*.lovable.app',
    'https://*.lovableproject.com',
    'http://localhost:5173'   // local dev
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### 4.3 Iframe Embedding

For the Lovable dashboard to embed your Vercel app in an iframe, `vercel.json` must include:

```json
"headers": [
  {
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "ALLOW-FROM https://kumii.africa" },
      { "key": "Content-Security-Policy", "value": "frame-ancestors 'self' https://kumii.africa https://*.lovable.app https://*.lovableproject.com" }
    ]
  }
]
```

---

## Part 5 — AI Endpoints (If the Project Uses OpenAI)

### 5.1 The Golden Rule

```
Browser  →  POST /api/ai/*  (Vercel)  →  OpenAI  →  audit_logs  (service_role)
```

**Never** put `VITE_OPENAI_API_KEY` in the frontend. The browser bundle is public.

### 5.2 Anti-Corruption Prompt Guardrails (South Africa)

Every AI system prompt in a South African procurement context **must** include:

```
STRICT COMPLIANCE RULES:
- NEVER recommend contacting procurement officials, evaluators, or
  tender committee members — this is corruption under PRECCA
  (Prevention and Combating of Corrupt Activities Act).
- NEVER suggest networking within the procurement process.
- Recommendations must only cover: proposal quality, capability
  building, CSD registration, BBBEE compliance, and published
  tender requirements.
```

This prevents the model from generating advice that could constitute a PRECCA s3/s4 offence.

---

## Part 6 — Checklist for a New Integration

```
VERCEL PROJECT
□ vercel.json has correct rewrites + CSP/X-Frame-Options headers
□ SUPABASE_URL env var set (no VITE_ prefix)
□ SUPABASE_SERVICE_ROLE_KEY env var set (no VITE_ prefix)
□ OPENAI_API_KEY env var set (no VITE_ prefix) — if using AI
□ VITE_SUPABASE_ANON_KEY env var set (VITE_ prefix OK — read-only)
□ VITE_OPENAI_API_KEY NOT present — removed from env vars
□ All Supabase writes use await before res.json()
□ /admin/audit-logs route mounted in server/index.js
□ /admin/audit-logs/health returns { serviceRoleConfigured: true }

SUPABASE
□ audit_logs_anon_read policy exists (or created)
□ GRANT SELECT ON audit_logs TO anon executed
□ GRANT SELECT on supporting views executed
□ Verified: anon key can read rows via curl

FRONTEND
□ auditLogger.js endpoint points to correct Vercel URL
□ Batch flushes every 5s (not only when queue >= 10)
□ No direct Supabase writes from browser (no storeInSupabase)
□ No VITE_OPENAI_API_KEY in .env

LOVABLE DASHBOARD
□ New project's rows appear filtered by applicationName in metadata
□ CSP headers allow kumii.africa to iframe the new project
```

---

## Reference: Working Integration (marketaccess)

| Item | Value |
|---|---|
| Vercel URL | `https://marketaccess.vercel.app` |
| Supabase project | `njcancswtqnxihxavshl.supabase.co` |
| Lovable dashboard | `https://kumii.africa/admin/audit-logs` |
| GitHub repo | `kumii-dev/marketaccess` |
| Audit log write path | `POST /admin/audit-logs` → `service_role` INSERT |
| Audit log read path | Supabase anon key SELECT (RLS policy: `audit_logs_anon_read`) |
| AI call path | `POST /api/ai/*` → OpenAI → `service_role` INSERT to `audit_logs` |
| Key commits | `b8463fe` (await fix), `4d9cc97` (PRECCA guardrails), `a802f69` (server-side OpenAI) |
