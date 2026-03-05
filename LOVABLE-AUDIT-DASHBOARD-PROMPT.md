# Lovable Prompt — Enterprise Audit Log Dashboard
**URL:** `https://kumii.africa/admin/audit-logs`  
**Last Updated:** March 2026  
**Project:** MarketAccess by KUMii — Government Tender Platform (South Africa)

---

## 📋 CONTEXT

Build a **production-ready enterprise ICT governance dashboard** at `/admin/audit-logs` that:

1. Reads live audit log data from **Supabase** (table: `public.audit_logs`)
2. Visualises **ISO 27001, NIST SP 800-53, NIST AI RMF, OWASP API 2023, GDPR, and POPIA** compliance events
3. Displays AI cost analytics, security event timelines, rate-limit abuse patterns, and compliance heatmaps
4. Allows admin/auditor users to filter, search, export and drill-down into any log entry
5. Shows real-time security alerts from the `check_critical_security_events()` Postgres function

---

## 🗄️ DATABASE SCHEMA (Supabase — `public.audit_logs`)

```sql
id             UUID        PRIMARY KEY
event_time     TIMESTAMPTZ NOT NULL          -- when the event occurred
created_at     TIMESTAMPTZ NOT NULL          -- when it was ingested
event_date     DATE        GENERATED (UTC)   -- auto-derived, use for grouping
session_id     TEXT        NOT NULL
correlation_id TEXT        NULL
user_id        UUID        NULL (→ auth.users)
user_email     TEXT        NULL
user_role      TEXT        NULL
category       TEXT        NOT NULL          -- see CATEGORIES below
level          TEXT        NOT NULL          -- CRITICAL|HIGH|MEDIUM|LOW|INFO
action         TEXT        NOT NULL
resource       TEXT        NOT NULL
result         TEXT        NOT NULL          -- SUCCESS|FAILURE|PARTIAL|BLOCKED|ERROR
source_ip      TEXT        NULL
user_agent     TEXT        NULL
platform       TEXT        NULL
location       TEXT        NULL
frameworks     TEXT[]      NOT NULL DEFAULT []
metadata       JSONB       NOT NULL DEFAULT {}
sensitive_data BOOLEAN     NOT NULL DEFAULT false
```

### 19 Categories
AUTHENTICATION · AUTHORIZATION · ACCESS_CONTROL · AI_OPERATION · AI_COST · AI_SECURITY · DATA_ACCESS · DATA_MODIFICATION · DATA_EXPORT · PII_ACCESS · SYSTEM_ERROR · PERFORMANCE · AVAILABILITY · RATE_LIMIT · POLICY_VIOLATION · COMPLIANCE_CHECK · TENDER_ACCESS · MATCHING_OPERATION · USER_ACTIVITY

### Supabase Views & Functions
| Object | Purpose |
|---|---|
| `public.ai_cost_summary` | Materialized view — daily AI cost per user |
| `public.security_events_summary` | View — daily CRITICAL/HIGH event aggregates |
| `public.compliance_events` | View — framework-tagged events with control mappings |
| `check_critical_security_events()` | Function — returns active security alerts |

### metadata JSONB Keys (most common)
```jsonc
{
  "tokensUsed": 823,
  "cost": 0.000493,
  "model": "gpt-4o-mini",
  "operation": "tender-analysis",
  "durationMs": 1240,
  "matchScore": 78,
  "confidence": "high",
  "nistAIFunction": "MEASURE",
  "iso27001Control": "A.12.1.3",
  "nistControl": "AU-2",
  "owaspCategory": "API4:2023",
  "gdprArticle": "Article 30",
  "popiaSection": "Section 51",
  "tenderId": "ocds-...",
  "applicationName": "MarketAccess"
}
```

---

## 🔌 API ENDPOINTS

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/audit-logs` | Receive batched log entries from React frontend |
| `GET` | `/admin/audit-logs/health` | Liveness check |
| `GET` | `/admin/audit-logs/stats` | Last-24h aggregate stats |

### Stats Response Shape
```jsonc
{
  "success": true,
  "stats": {
    "last24h": {
      "total": 142,
      "byLevel":    { "INFO": 88, "MEDIUM": 32, "HIGH": 18, "CRITICAL": 4 },
      "byCategory": { "AI_OPERATION": 55, "TENDER_ACCESS": 38 },
      "byResult":   { "SUCCESS": 119, "FAILURE": 14, "BLOCKED": 9 }
    }
  },
  "generatedAt": "2026-03-05T10:00:00Z"
}
```

---

## 🎨 DESIGN SYSTEM

### Colours
```css
--primary:  #1a1f36;  /* dark navy */
--accent:   #6366f1;  /* indigo */
--success:  #22c55e;
--warning:  #f59e0b;
--danger:   #ef4444;
--critical: #dc2626;
--info:     #3b82f6;
--muted:    #64748b;
--surface:  #0f172a;
--card:     #1e2a3b;
--border:   #2d3748;
```

### Level Colours
| Level | Colour | Icon |
|---|---|---|
| CRITICAL | #dc2626 | shield-x |
| HIGH     | #ef4444 | alert-triangle |
| MEDIUM   | #f59e0b | alert-circle |
| LOW      | #3b82f6 | info |
| INFO     | #64748b | check-circle |

### Framework Badge Colours
| Framework | Colour |
|---|---|
| ISO27001    | #6366f1 indigo |
| NIST_800_53 | #0ea5e9 sky |
| NIST_AI_RMF | #8b5cf6 violet |
| OWASP_API   | #f97316 orange |
| GDPR        | #10b981 emerald |
| POPIA       | #06b6d4 cyan |

---

## 📐 PAGE LAYOUT

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER: KUMii logo | "Audit & Compliance Dashboard" | User menu │
├────────────────────────────────────────────────────────────────┤
│ ALERT BAR — red banner when check_critical_security_events()   │
│             returns rows (auto-polls every 60s)                 │
├──────┬──────┬──────┬──────┬──────┬──────┬─────────────────────┤
│Total │Crit  │High  │AI $  │Rate  │GDPR  │ Unique Users Active  │
│ 24h  │ 24h  │ 24h  │Today │Block │Events│                      │
├──────┴──────┴──────┴──────┴──────┴──────┴─────────────────────┤
│ TABS: Overview | Security | AI Analytics | Compliance | Logs    │
├────────────────────────────────────────────────────────────────┤
│                      TAB CONTENT                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 📊 TAB 1 — OVERVIEW

**Event Timeline (full width)** — Line chart, events per hour, last 48h, series per level

**Row 2 (2-col)**
- Left: Category Breakdown donut (19 slices, click → filter Logs tab)
- Right: Result Distribution stacked bar (last 7 days)

**Row 3 (2-col)**
- Left: Top 10 Active Users table (email | total | critical count | last seen)
- Right: Top 10 Source IPs table (ip | count | distinct users | flag BLOCKED)

---

## 🛡️ TAB 2 — SECURITY

**Alert Panel** — Cards for each alert type from `check_critical_security_events()`, polled every 60s

**Row 2 (2-col)**
- Left: Failed Auth Spike area chart (last 24h, threshold line at 5)
- Right: Rate Limit Heatmap (hour × day-of-week grid, cell = count)

**PII & Sensitive Data table** — `sensitive_data = true`, FAILURE rows red

**Policy Violations timeline** — POLICY_VIOLATION + ACCESS_CONTROL FAILURE, expandable metadata

---

## 🤖 TAB 3 — AI ANALYTICS

> Source: `ai_cost_summary` view + `AI_OPERATION` category rows

**KPIs:** Total Calls | Total Tokens | Total Cost USD | Avg Cost/Call | Top Model | Top User

**Row 2 (2-col)**
- Left: Daily Cost Trend bar chart (30 days)
- Right: Cost per User horizontal bars (top 10)

**Row 3 (2-col)**
- Left: Operation Breakdown donut (keyword-extraction | tender-analysis | match-analysis)
- Right: Token Usage histogram (buckets: 0-100, 100-300, 300-500, 500-1000, 1000+)

**NIST AI RMF Coverage** — Progress rings for GOVERN | MAP | MEASURE | MANAGE | IDENTIFY | RESPOND (from `metadata->>'nistAIFunction'`)

**AI Calls Table** — event_time | user_email | operation | model | tokensUsed | cost | durationMs | result | confidence — sortable, paginated 25/page

---

## ✅ TAB 4 — COMPLIANCE

**Framework Coverage Grid** — 6 cards (ISO27001 | NIST_800_53 | NIST_AI_RMF | OWASP_API | GDPR | POPIA)
Each card: framework name | event count | coverage % progress bar | coloured by framework colour

**ISO 27001 Controls Heatmap** — Grid of A.9.x / A.12.x / A.18.x controls, cell colour = event count, click → filter

**GDPR / POPIA Events Table** — from `compliance_events` view, columns: event_time | action | resource | gdpr_article | popia_section | result | user_email | sensitive_data — Export to CSV button

**NIST SP 800-53 Controls Table** — nist_control | event_count | last_event | result_breakdown, sorted by count DESC

---

## 📋 TAB 5 — RAW LOGS

**Filter Bar:**
```
[ Search ] [ Level ▼ ] [ Category ▼ ] [ Result ▼ ] [ Framework ▼ ] 
[ Date From ] [ Date To ] [ Sensitive Only ☐ ] [ Clear ] [ Export CSV ]
```

**Table Columns:** event_time | level (badge) | category (badge) | action | resource | result (badge) | user_email | frameworks (pills) | expand →

**Expanded row:** source_ip | user_agent | platform | location | session_id | correlation_id | metadata (formatted JSON with syntax highlighting) | sensitive_data flag

**Pagination:** 50 rows/page, total count, page jump

---

## ⚙️ TECHNICAL REQUIREMENTS

### Stack
- React 19 + TypeScript
- Tailwind CSS (dark theme)
- Recharts (LineChart, BarChart, PieChart, AreaChart)
- @supabase/supabase-js (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
- TanStack Query (caching + polling)

### Auth Guard
```tsx
const { data: { user } } = await supabase.auth.getUser();
const role = user?.user_metadata?.role;
if (role !== 'admin' && role !== 'auditor') redirect('/');
```

### Key Performance Rules
- Use `event_date` (not `event_time`) for date-range filters — uses B-tree index
- Paginate all raw log queries — never fetch all rows
- Use narrow `select('level, category, result')` for aggregate queries
- Limit chart queries to 90 days max
- Poll security alerts every 60s with React Query `refetchInterval`

### Security Rules
- **Never** use `SUPABASE_SERVICE_ROLE_KEY` in frontend — anon key + RLS only
- Sensitive data rows: show 🔒 icon, blur `user_email` by default, click to reveal
- Export CSV: disabled for `auditor` role (admin only)
- Sanitise all filter inputs before building queries

### CSV Export Columns
```
id, event_time, event_date, level, category, action, resource, result,
user_email, user_role, source_ip, frameworks, sensitive_data,
session_id, correlation_id, metadata
```

---

## 🚀 IMPLEMENTATION PHASES

| Phase | Deliverables |
|---|---|
| 1 | Auth guard · KPI cards · Alert bar · Raw Logs tab with full filtering |
| 2 | Overview tab charts · Security tab · CSV export |
| 3 | AI Analytics tab · Compliance tab |
| 4 | Real-time Supabase subscription for CRITICAL events · PDF export |

---

## 📝 SAMPLE DATA

```jsonc
[
  {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "event_time": "2026-03-05T08:14:22Z",
    "event_date": "2026-03-05",
    "level": "HIGH",
    "category": "AUTHENTICATION",
    "action": "Login",
    "resource": "Authentication System",
    "result": "FAILURE",
    "user_email": "user@example.co.za",
    "frameworks": ["ISO27001", "NIST_800_53"],
    "metadata": { "iso27001Control": "A.9.4.1", "nistControl": "IA-2" },
    "sensitive_data": false
  },
  {
    "id": "b2c3d4e5-0000-0000-0000-000000000002",
    "event_time": "2026-03-05T08:22:01Z",
    "event_date": "2026-03-05",
    "level": "INFO",
    "category": "AI_OPERATION",
    "action": "AI API Call",
    "resource": "AI Model: gpt-4o-mini",
    "result": "SUCCESS",
    "user_email": "admin@kumii.africa",
    "frameworks": ["NIST_AI_RMF", "ISO27001"],
    "metadata": {
      "tokensUsed": 643, "cost": 0.000386, "model": "gpt-4o-mini",
      "operation": "tender-analysis", "durationMs": 1104,
      "matchScore": 82, "confidence": "high", "nistAIFunction": "MEASURE"
    },
    "sensitive_data": false
  },
  {
    "id": "c3d4e5f6-0000-0000-0000-000000000003",
    "event_time": "2026-03-05T08:31:45Z",
    "event_date": "2026-03-05",
    "level": "MEDIUM",
    "category": "RATE_LIMIT",
    "action": "Rate Limit Exceeded",
    "resource": "/api/ai/analyze-tender",
    "result": "BLOCKED",
    "user_email": "user2@example.co.za",
    "frameworks": ["OWASP_API", "ISO27001"],
    "metadata": {
      "limit": 30, "current": 31,
      "owaspCategory": "API4:2023 - Unrestricted Resource Consumption",
      "iso27001Control": "A.12.1.3"
    },
    "sensitive_data": false
  },
  {
    "id": "d4e5f6a7-0000-0000-0000-000000000004",
    "event_time": "2026-03-05T09:01:11Z",
    "event_date": "2026-03-05",
    "level": "HIGH",
    "category": "PII_ACCESS",
    "action": "View PII",
    "resource": "PII: user-profile",
    "result": "SUCCESS",
    "user_email": "admin@kumii.africa",
    "frameworks": ["GDPR", "POPIA", "ISO27001"],
    "metadata": {
      "gdprArticle": "Article 30", "popiaSection": "Section 51",
      "iso27001Control": "A.18.1.4", "purpose": "Tender Matching"
    },
    "sensitive_data": true
  }
]
```

---

## ✅ ACCEPTANCE CHECKLIST

- [ ] Page only renders for `admin` or `auditor` role
- [ ] KPIs refresh every 5 minutes
- [ ] Security alert banner appears when `check_critical_security_events()` returns rows
- [ ] All Raw Logs filters work independently and in combination
- [ ] Date filter uses `event_date` column
- [ ] CSV export respects active filters
- [ ] Sensitive data rows show 🔒 and blur email by default
- [ ] AI cost displayed in USD with 6 decimal places
- [ ] All 6 framework badges use correct colours
- [ ] Usable on tablet (768px+)
- [ ] No console errors in production build
- [ ] All Supabase queries use authenticated anon client (no service key on frontend)
