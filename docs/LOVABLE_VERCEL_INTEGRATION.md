# Lovable ↔ Vercel Integration Guide

How to connect any Vercel backend project to the **kumii.africa** Lovable dashboard.  
Based on the production integration built for **MarketAccess** (`marketaccess.vercel.app`).

---

## Architecture Overview

```
Lovable Dashboard (kumii.africa)
        │
        │  reads directly via anon key
        ▼
   Supabase (njcancswtqnxihxavshl)
        ▲
        │  writes via service_role key
        │
Vercel Backend (your-project.vercel.app)
        ▲
        │  HTTP POST/GET
        │
React Frontend (marketaccess.vercel.app)
```

**Key principle:** Lovable never talks to your Vercel backend — it reads Supabase directly using the anon key. Your Vercel backend writes to Supabase using the service_role key.

---

## Part 1 — Vercel Backend Requirements

### 1.1 Required Environment Variables

Set these in **Vercel → Project Settings → Environment Variables**:

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://njcancswtqnxihxavshl.supabase.co` | Same project for all integrations |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role secret` | From Supabase → Settings → API |
| `OPENAI_API_KEY` | `sk-...` | Only if the project uses AI |
| `PORT` | `3001` | Local dev only — Vercel ignores this |

> ⚠️ **Never** set `SUPABASE_SERVICE_ROLE_KEY` as a `VITE_` prefixed variable — that exposes it in the browser bundle.

### 1.2 Required `vercel.json`

Every Vercel project that needs to talk to the Lovable dashboard must expose its routes and allow framing from `kumii.africa`:

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
      "config": { "distDir": "dist" }
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

> If your project is **API-only** (no React frontend), remove the `@vercel/static-build` entry from `builds`.

### 1.3 Required Express Server Setup (`server/index.js`)

```js
import express from 'express';
import cors from 'cors';
import auditRoutes from './routes/audit.js';

const app = express();

// Allow the Lovable dashboard and your own frontend
app.use(cors({
  origin: [
    'https://kumii.africa',
    'https://*.lovable.app',
    'https://*.lovableproject.com',
    'https://your-project.vercel.app'  // ← replace with your frontend URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json({ limit: '1mb' }));

// Mount the audit log receiver — required for Lovable dashboard Logs tab
app.use('/admin/audit-logs', auditRoutes);

// Your own routes
app.use('/api/your-feature', yourFeatureRoutes);

app.listen(process.env.PORT || 3001);
```

### 1.4 Audit Log Receiver (`server/routes/audit.js`)

Copy the full `audit.js` from this repo. The critical parts are:

```js
import { createClient } from '@supabase/supabase-js';

// MUST use service_role — anon key cannot INSERT (RLS blocks it)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// POST /admin/audit-logs
router.post('/', async (req, res) => {
  const { batch } = req.body;  // ← must be a "batch" array, not a single object
  const { error } = await supabaseAdmin.from('audit_logs').insert(sanitisedBatch);
  // ...
});
```

> The receiver expects `{ "batch": [...] }` — a single object will return `400 Bad Request`.

---

## Part 2 — Supabase Requirements

### 2.1 RLS Policies (run once — already applied to this project)

These policies govern who can read/write `audit_logs`:

```sql
-- Backend (service_role) can INSERT
CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- Authenticated users can SELECT their own logs  
CREATE POLICY audit_logs_user_read ON public.audit_logs
  FOR SELECT TO authenticated USING (user_email = auth.email());

-- Lovable dashboard (anon key) can SELECT all logs
-- Without this the Logs tab shows 0 rows
CREATE POLICY audit_logs_anon_read ON public.audit_logs
  FOR SELECT TO anon USING (true);

-- Grant SELECT on supporting dashboard views
GRANT SELECT ON public.audit_logs TO anon;
GRANT SELECT ON public.ai_cost_summary TO anon;
GRANT SELECT ON public.security_events_summary TO anon;
GRANT SELECT ON public.compliance_events TO anon;
```

> If the `audit_logs_anon_read` policy already exists you will get error `42710`. Skip that line and run only the `GRANT` statements.

### 2.2 Required Table: `audit_logs`

The full schema is in `supabase/migrations/create_audit_logs_schema.sql`.  
Key NOT NULL columns your INSERT must always provide:

| Column | Type | Notes |
|---|---|---|
| `session_id` | `TEXT NOT NULL` | Use a generated request ID |
| `category` | `TEXT NOT NULL` | e.g. `AI_OPERATION`, `USER_ACTIVITY` |
| `level` | `TEXT NOT NULL` | `INFO`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `action` | `TEXT NOT NULL` | Human-readable event name |
| `resource` | `TEXT NOT NULL` | What was accessed/modified |
| `result` | `TEXT NOT NULL` | `SUCCESS` or `FAILURE` |

---

## Part 3 — Frontend (`auditLogger.js`) Setup

Every new Vercel project's React frontend needs `auditLogger.js` configured correctly.

### 3.1 Critical Settings

```js
// ✅ CORRECT — points to YOUR project's Vercel backend
this.endpoint = 'https://your-project.vercel.app/admin/audit-logs';

// ❌ WRONG — never point to kumii.africa (that's Lovable, not a receiver)
// this.endpoint = 'https://kumii.africa/admin/audit-logs';

// ❌ WRONG — never write directly to Supabase from the browser
// The anon key cannot INSERT (RLS blocks it)
// await supabase.from('audit_logs').insert(...)
```

### 3.2 Flush Behaviour

```js
// Flush every 5 seconds if queue has ANY items
// Don't wait for queue to fill to 10 — most sessions have 3-5 events
setInterval(() => {
  if (this.queue.length > 0) this.flushBatch();
}, 5000);

// Also flush immediately for critical/high severity
if (['CRITICAL', 'HIGH'].includes(level)) {
  this.flushBatch();
}
```

### 3.3 Environment Variable

```bash
# .env (frontend)
VITE_API_BASE_URL=https://your-project.vercel.app

# Never add this — OpenAI key must live only on the server
# VITE_OPENAI_API_KEY=...   ← security risk, remove it
```

---

## Part 4 — AI Endpoints (if project uses OpenAI)

### 4.1 The Golden Rule

**All OpenAI calls must happen on Vercel, never in the browser.**

```
Browser → POST /api/ai/your-endpoint (Vercel)
                    ↓
               OpenAI API (key stays on server)
                    ↓
          audit_logs INSERT (service_role key)
                    ↓
         ← response returned to browser
```

### 4.2 Critical: `await` the audit log write

On Vercel serverless, the function process exits the moment `res.json()` is called.  
Any unawaited promise **will be killed** before it completes.

```js
// ❌ WRONG — fire-and-forget is killed by Vercel before INSERT runs
logAIToAudit({ ... });
return res.json({ result });

// ✅ CORRECT — await the write, THEN respond
await logAIToAudit({ ... });
return res.json({ result });
```

### 4.3 Anti-Corruption Prompt Guardrails (South Africa)

Every AI system prompt must include:

```
STRICT COMPLIANCE RULES:
- NEVER recommend contacting procurement officials, evaluators,
  or tender committee members.
- NEVER suggest networking within the procurement process —
  this constitutes corruption under PRECCA (Prevention and
  Combating of Corrupt Activities Act).
- Recommendations must only cover: proposal quality improvement,
  capability building, CSD registration, BBBEE compliance,
  and public tender document requirements.
```

---

## Part 5 — Connecting a New Project to the Lovable Dashboard

### Checklist

```
Vercel Backend
□ SUPABASE_URL env var set
□ SUPABASE_SERVICE_ROLE_KEY env var set  
□ vercel.json has /admin/audit-logs rewrite
□ vercel.json has Content-Security-Policy header for kumii.africa
□ server/routes/audit.js POST receiver mounted
□ CORS allows kumii.africa and *.lovable.app

Supabase
□ audit_logs table exists (run migration SQL)
□ audit_logs_anon_read policy exists (SELECT TO anon)
□ GRANT SELECT on audit_logs TO anon
□ GRANT SELECT on ai_cost_summary, security_events_summary, compliance_events TO anon

Frontend
□ auditLogger.js endpoint = https://your-project.vercel.app/admin/audit-logs
□ Flush fires every 5s if queue > 0
□ storeInSupabase() calls removed (anon cannot INSERT)
□ VITE_OPENAI_API_KEY removed from .env

AI Endpoints (if applicable)
□ All OpenAI calls are in server/routes/ai.js (not in browser)
□ All logAIToAudit() calls are awaited before res.json()
□ System prompts include anti-corruption guardrails
```

### Quick Verify Commands

```bash
# 1. Check backend is reachable and service_role is configured
curl https://your-project.vercel.app/admin/audit-logs/health

# Expected: {"status":"OK","serviceRoleConfigured":true}

# 2. Test writing a log entry
curl -X POST https://your-project.vercel.app/admin/audit-logs \
  -H "Content-Type: application/json" \
  -d '{"batch":[{"session_id":"test-001","category":"USER_ACTIVITY","level":"INFO","action":"Integration Test","resource":"Test","result":"SUCCESS","frameworks":["ISO27001"],"metadata":{},"sensitive_data":false}]}'

# Expected: {"inserted":1}

# 3. Test reading via anon key (what Lovable does)
ANON_KEY=your_anon_key
curl "https://njcancswtqnxihxavshl.supabase.co/rest/v1/audit_logs?select=id,event_time,action&limit=3&order=event_time.desc" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"

# Expected: JSON array of rows — NOT an empty array and NOT {"code":"42501",...}

# 4. Check stats
curl https://your-project.vercel.app/admin/audit-logs/stats
# Expected: {"success":true,"stats":{"last24h":{"total":N,...}}}
```

---

## Part 6 — Lovable Dashboard Data Sources

The Lovable dashboard (`kumii.africa/admin/audit-logs`) reads these Supabase objects directly using the anon key:

| Dashboard Tab | Supabase Source | Query |
|---|---|---|
| Logs | `audit_logs` table | `SELECT * ORDER BY event_time DESC` |
| AI Costs | `ai_cost_summary` view | `SELECT * FROM ai_cost_summary` |
| Security | `security_events_summary` view | Filters on `level IN ('HIGH','CRITICAL')` |
| Compliance | `compliance_events` view | Filters on `frameworks` array |

All four require `GRANT SELECT ... TO anon`.

---

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| Logs tab empty | `auditLogger.endpoint` wrong URL | Set to `https://your-project.vercel.app/admin/audit-logs` |
| Logs tab empty | Anon SELECT policy missing | Run `CREATE POLICY audit_logs_anon_read` + `GRANT SELECT` SQL |
| `{"inserted":0}` | Batch flushes but Supabase rejects INSERT | Check NOT NULL columns: `session_id`, `action`, `resource`, `result` |
| `400 Bad Request` from receiver | Sending `{...}` not `{"batch":[...]}` | Wrap payload in `batch` array |
| AI calls not logged | `logAIToAudit()` not awaited | Add `await` before every call, before `res.json()` |
| `42710` policy error | Policy already exists | Skip CREATE POLICY, run only GRANT statements |
| `42501` from Supabase | Anon key blocked by RLS | Run the GRANT SELECT SQL commands |
| CSP frame blocked | `vercel.json` headers missing | Add `Content-Security-Policy: frame-ancestors ... kumii.africa` |

---

*Last updated: March 2026 — based on MarketAccess production integration*
