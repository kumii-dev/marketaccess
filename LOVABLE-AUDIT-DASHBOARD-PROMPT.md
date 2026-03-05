# Lovable Prompt — Add Audit & Compliance Dashboard Page
**Route:** `/admin/audit-logs`
**Platform:** kumii.africa (existing Lovable project)
**Module:** MarketAccess — Government Tender Platform (South Africa)
**Last Updated:** March 2026

---

## 📋 WHAT TO BUILD

Add a new **protected page** at `/admin/audit-logs` to the existing kumii.africa Lovable project.

**Do NOT create a new project. Do NOT change any existing pages, components, routing, auth or styling.**

Only add:
1. A new page component: `src/pages/AdminAuditLogs.tsx` (or equivalent path for this project)
2. A new route entry: `/admin/audit-logs` → `AdminAuditLogs`
3. Any new sub-components scoped to this page only (e.g. `src/components/audit/...`)

The page reads live data from **Supabase** using the project's existing Supabase client and credentials.

---

## 🔐 AUTH GUARD

This page is **admin/auditor only**. On mount, check the logged-in user's role:

```tsx
const { data: { user } } = await supabase.auth.getUser();
const role = user?.app_metadata?.role ?? user?.user_metadata?.role;
if (role !== 'admin' && role !== 'auditor') {
  navigate('/');   // or wherever the platform's home route is
  return;
}
```

If there is no active session, redirect to the platform's existing sign-in page.

---

## 🗄️ SUPABASE — TABLE & VIEWS

All data comes from the **existing Supabase project** already connected to this Lovable project.

### Table: `public.audit_logs`
```sql
id             UUID        PRIMARY KEY
event_time     TIMESTAMPTZ NOT NULL
created_at     TIMESTAMPTZ NOT NULL
event_date     DATE        GENERATED ALWAYS AS ((event_time AT TIME ZONE 'UTC')::date) STORED
session_id     TEXT        NOT NULL
correlation_id TEXT        NULL
user_id        UUID        NULL
user_email     TEXT        NULL
user_role      TEXT        NULL
category       TEXT        NOT NULL
level          TEXT        NOT NULL   -- CRITICAL | HIGH | MEDIUM | LOW | INFO
action         TEXT        NOT NULL
resource       TEXT        NOT NULL
result         TEXT        NOT NULL   -- SUCCESS | FAILURE | PARTIAL | BLOCKED | ERROR
source_ip      TEXT        NULL
user_agent     TEXT        NULL
platform       TEXT        NULL
location       TEXT        NULL
frameworks     TEXT[]      NOT NULL DEFAULT '{}'
metadata       JSONB       NOT NULL DEFAULT '{}'
sensitive_data BOOLEAN     NOT NULL DEFAULT false
```

### Views & Functions (already deployed in Supabase)
| Object | Type | Purpose |
|---|---|---|
| `public.ai_cost_summary` | Materialized view | Daily AI cost per user |
| `public.security_events_summary` | View | Daily CRITICAL/HIGH aggregates |
| `public.compliance_events` | View | Framework-tagged events with control mappings |
| `check_critical_security_events()` | Function | Returns active security alerts |

### metadata JSONB common keys
```jsonc
{
  "tokensUsed": 823,
  "cost": 0.000493,
  "model": "gpt-4o-mini",
  "operation": "tender-analysis",   // keyword-extraction | tender-analysis | match-analysis
  "durationMs": 1240,
  "matchScore": 78,
  "confidence": "high",
  "nistAIFunction": "MEASURE",      // GOVERN | MAP | MEASURE | MANAGE | IDENTIFY | RESPOND
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

## 🎨 DESIGN

Match the existing kumii.africa design system exactly — colours, fonts, card styles, button styles, nav.

If the platform uses a dark theme, use dark. If light, use light. **Do not introduce a new theme.**

### Level badge colours (these are universal regardless of theme)
| Level | Colour |
|---|---|
| CRITICAL | red-600 |
| HIGH | red-400 |
| MEDIUM | amber-500 |
| LOW | blue-400 |
| INFO | slate-400 |

### Framework pill colours
| Framework | Colour |
|---|---|
| ISO27001 | indigo |
| NIST_800_53 | sky |
| NIST_AI_RMF | violet |
| OWASP_API | orange |
| GDPR | emerald |
| POPIA | cyan |

---

## 📐 PAGE STRUCTURE

```
┌──────────────────────────────────────────────────────────────┐
│  [Platform's existing nav/header — unchanged]                │
├──────────────────────────────────────────────────────────────┤
│  🔴 ALERT BAR (only visible when security alerts active)     │
│     "⚠ 3 critical security events in the last hour"          │
├──────┬──────┬──────┬──────┬──────┬──────┬───────────────────┤
│Total │Crit  │High  │AI $  │Rate  │GDPR  │ Active Users      │
│ 24h  │ 24h  │ 24h  │Today │Block │Events│ Today             │
├──────┴──────┴──────┴──────┴──────┴──────┴───────────────────┤
│  TABS: Overview | Security | AI Analytics | Compliance | Logs │
├──────────────────────────────────────────────────────────────┤
│                     TAB CONTENT (below)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 TAB 1 — OVERVIEW

- **Event Timeline** — Line chart, events per hour for last 48h, one series per level
- **Category Breakdown** — Donut chart (19 categories), click slice → pre-filters Logs tab
- **Result Distribution** — Stacked bar chart by day, last 7 days
- **Top 10 Users** — Table: email | total events | critical count | last seen
- **Top 10 Source IPs** — Table: ip | count | distinct users | blocked flag

---

## 🛡️ TAB 2 — SECURITY

- **Alert Cards** — One card per row from `check_critical_security_events()`, polled every 60s
- **Failed Auth chart** — Area chart last 24h with threshold line at 5
- **Rate Limit Heatmap** — Hour × day-of-week grid, cell colour = violation count
- **PII & Sensitive Data table** — `sensitive_data = true` rows, FAILURE rows highlighted
- **Policy Violations timeline** — POLICY_VIOLATION + ACCESS_CONTROL FAILURE, expandable metadata

---

## 🤖 TAB 3 — AI ANALYTICS

Data source: `ai_cost_summary` materialized view + `audit_logs WHERE category = 'AI_OPERATION'`

- **KPI row:** Total Calls | Total Tokens | Total Cost USD | Avg Cost/Call | Top Model | Top User
- **Daily Cost Trend** — Bar chart, 30 days
- **Cost per User** — Horizontal bar chart, top 10
- **Operation Breakdown** — Donut: keyword-extraction | tender-analysis | match-analysis
- **Token Usage Histogram** — Buckets: 0–100, 100–300, 300–500, 500–1000, 1000+
- **NIST AI RMF Coverage** — Progress rings for GOVERN | MAP | MEASURE | MANAGE | IDENTIFY | RESPOND (from `metadata->>'nistAIFunction'`)
- **AI Calls Table** — event_time | user_email | operation | model | tokensUsed | cost | durationMs | result | confidence — sortable, 25/page

---

## ✅ TAB 4 — COMPLIANCE

- **Framework Coverage Cards** — 6 cards (one per framework): event count + progress bar + colour
- **ISO 27001 Controls Heatmap** — Grid of A.9.x / A.12.x / A.18.x controls, colour = event count
- **GDPR / POPIA Events Table** — from `compliance_events` view: event_time | action | resource | gdpr_article | popia_section | result | user_email | sensitive_data + **Export CSV** (admin only)
- **NIST SP 800-53 Controls Table** — nist_control | event_count | last_event | result_breakdown

---

## 📋 TAB 5 — RAW LOGS

**Filter bar:**
```
[Search] [Level ▼] [Category ▼] [Result ▼] [Framework ▼]
[Date From] [Date To] [Sensitive Only ☐] [Clear] [Export CSV]
```

**Table columns:** event_time | level (badge) | category (badge) | action | resource | result (badge) | user_email | frameworks (pills) | ▶ expand

**Expanded row:** source_ip | user_agent | platform | location | session_id | correlation_id | metadata (JSON with syntax highlight) | sensitive_data flag

**Pagination:** 50 rows/page with total count and page jump

---

## ⚙️ TECHNICAL REQUIREMENTS

### Stack
Use whatever stack the existing kumii.africa Lovable project already uses (React + TypeScript + Tailwind assumed). Add:
- **Recharts** for all charts (LineChart, BarChart, PieChart, AreaChart) — if not already installed
- **TanStack Query** for data fetching + caching + polling — if not already installed

### Supabase Queries — Performance Rules
```ts
// ✅ Use event_date (indexed generated column) for date filtering
.gte('event_date', dateFrom)
.lte('event_date', dateTo)

// ✅ Narrow selects for aggregate queries
.select('level, category, result')

// ✅ Always paginate raw logs — never fetch all rows
.range(from, to)

// ✅ Limit chart queries to 90 days max

// ✅ Poll security alerts every 60s
useQuery({ queryKey: ['alerts'], queryFn: fetchAlerts, refetchInterval: 60_000 })
```

### Security Rules
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` in frontend — use anon key + RLS only
- Sensitive data rows: show 🔒 icon, blur `user_email` by default, reveal on click
- CSV export button disabled for `auditor` role (admin only)
- Sanitise all filter inputs before Supabase query construction

### CSV Export columns
```
id, event_time, event_date, level, category, action, resource, result,
user_email, user_role, source_ip, frameworks, sensitive_data,
session_id, correlation_id, metadata
```

---

## 📝 SAMPLE DATA (for UI development / Storybook)

```jsonc
[
  {
    "level": "HIGH", "category": "AUTHENTICATION", "action": "Login",
    "resource": "Authentication System", "result": "FAILURE",
    "user_email": "user@example.co.za",
    "frameworks": ["ISO27001", "NIST_800_53"],
    "metadata": { "iso27001Control": "A.9.4.1", "nistControl": "IA-2" },
    "sensitive_data": false
  },
  {
    "level": "INFO", "category": "AI_OPERATION", "action": "AI API Call",
    "resource": "AI Model: gpt-4o-mini", "result": "SUCCESS",
    "user_email": "admin@kumii.africa",
    "frameworks": ["NIST_AI_RMF", "ISO27001"],
    "metadata": {
      "tokensUsed": 643, "cost": 0.000386, "model": "gpt-4o-mini",
      "operation": "tender-analysis", "durationMs": 1104,
      "matchScore": 82, "nistAIFunction": "MEASURE"
    },
    "sensitive_data": false
  },
  {
    "level": "MEDIUM", "category": "RATE_LIMIT", "action": "Rate Limit Exceeded",
    "resource": "/api/ai/analyze-tender", "result": "BLOCKED",
    "frameworks": ["OWASP_API", "ISO27001"],
    "metadata": { "limit": 30, "current": 31, "owaspCategory": "API4:2023" },
    "sensitive_data": false
  },
  {
    "level": "HIGH", "category": "PII_ACCESS", "action": "View PII",
    "resource": "PII: user-profile", "result": "SUCCESS",
    "user_email": "admin@kumii.africa",
    "frameworks": ["GDPR", "POPIA", "ISO27001"],
    "metadata": { "gdprArticle": "Article 30", "popiaSection": "Section 51" },
    "sensitive_data": true
  }
]
```

---

## ✅ ACCEPTANCE CHECKLIST

- [ ] Page added to existing kumii.africa project — no new project, no changes to existing pages
- [ ] Route `/admin/audit-logs` renders only for `admin` or `auditor` role
- [ ] All other roles redirected to platform home
- [ ] KPI cards refresh every 5 minutes
- [ ] Security alert banner visible when `check_critical_security_events()` returns rows
- [ ] Raw Logs: all filters work independently and in combination
- [ ] Date filter uses `event_date` column (not `event_time`)
- [ ] Sensitive rows show 🔒 and blur email by default
- [ ] CSV export disabled for auditor role
- [ ] AI cost shown in USD to 6 decimal places
- [ ] Framework pills use correct colours
- [ ] No service_role key in any frontend code
- [ ] No console errors in production build
- [ ] Page inherits platform's existing nav/header/footer unchanged
