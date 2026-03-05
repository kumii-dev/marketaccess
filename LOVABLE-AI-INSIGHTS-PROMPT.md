# Lovable Prompt — Add AI Insights Tab to Audit Dashboard
**Route:** `/admin/audit-logs` (existing page — add one new tab only)
**Date:** March 2026

---

## WHAT TO BUILD

Add a **6th tab called "AI Insights"** to the existing `/admin/audit-logs` page.

**Do NOT create a new page. Do NOT change any existing tabs, components, or routing.**

Only add:
1. A new "AI Insights" tab entry in the existing tab bar
2. A new `src/components/audit/AIInsightsTab.tsx` component
3. No new dependencies needed — uses existing fetch/React Query patterns

---

## THREE BACKEND ENDPOINTS

All three are already live at `https://marketaccess.vercel.app`. Call them from the frontend using a standard `fetch` POST:

### 1. Threat Summary
```
POST https://marketaccess.vercel.app/api/ai/audit/threat-summary
Body: { "hoursBack": 24 }

Response:
{
  "success": true,
  "logsAnalysed": 9,
  "summary": "Plain English threat briefing text...",
  "meta": { "tokensUsed": 1347, "costUSD": "0.000406", "durationMs": 10513 }
}
```

### 2. Anomaly Detection
```
POST https://marketaccess.vercel.app/api/ai/audit/anomaly-detect
Body: { "hoursBack": 24 }

Response:
{
  "success": true,
  "logsAnalysed": 9,
  "anomalyCount": 3,
  "anomalies": [
    {
      "severity": "HIGH" | "CRITICAL" | "MEDIUM" | "LOW",
      "type": "Credential Stuffing",
      "description": "One sentence description",
      "affectedEntity": "user@example.co.za",
      "eventCount": 1,
      "recommendation": "Concrete action to take",
      "frameworks": ["ISO27001", "NIST_800_53"]
    }
  ],
  "meta": { "tokensUsed": 1546, "costUSD": "0.000359", "durationMs": 5883 }
}
```

### 3. Compliance Report
```
POST https://marketaccess.vercel.app/api/ai/audit/compliance-report
Body: { "framework": "ISO27001", "hoursBack": 168 }

framework options: "ISO27001" | "GDPR" | "POPIA" | "NIST_800_53" | "NIST_AI_RMF" | "OWASP_API" | "ALL"

Response:
{
  "success": true,
  "framework": "ISO27001",
  "period": "Wed Mar 04 2026 to Thu Mar 05 2026",
  "logsAnalysed": 9,
  "report": "Full formatted report text...",
  "controlCoverage": {
    "A.9.4.1": { "count": 2, "failures": 1, "categories": ["AUTHENTICATION"] }
  },
  "meta": { "tokensUsed": 1942, "costUSD": "0.000591", "durationMs": 12747 }
}
```

---

## PAGE LAYOUT — AI Insights Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  🤖 AI Insights   [Analyse Last: 24h ▼]  [Run Analysis ▶]       │
│  Powered by GPT-4o-mini · Last run: 5 Mar 2026 10:37            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────── THREAT BRIEFING ──────────────────────────┐   │
│  │  🔴 HIGH  2 HIGH events  │  🟡 MEDIUM  2 MEDIUM events   │   │
│  │  Threat briefing text renders here as formatted          │   │
│  │  markdown/prose. Full width card. Copyable.              │   │
│  │  [Copy] [Download .txt]         Cost: $0.000406  1347 tok│   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────── ANOMALY DETECTION ────────────────────────┐   │
│  │  3 anomalies detected                                    │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ 🔴 HIGH  │ Credential Stuffing                     │  │   │
│  │  │ test@example.co.za · 1 event                       │  │   │
│  │  │ Description text                                   │  │   │
│  │  │ 💡 Recommendation text                             │  │   │
│  │  │ Frameworks: ISO27001, NIST_800_53                  │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │  (one card per anomaly, sorted by severity)              │   │
│  │                          Cost: $0.000359  1546 tok       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────── COMPLIANCE REPORT ────────────────────────┐   │
│  │  Framework: [ISO27001 ▼]   Period: [7 days ▼]            │   │
│  │  [Generate Report ▶]                                     │   │
│  │                                                          │   │
│  │  Report text renders here as formatted markdown prose.   │   │
│  │  Full width. Copyable. Downloadable as .txt              │   │
│  │  [Copy] [Download .txt]        Cost: $0.000591  1942 tok │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## COMPONENT SPEC

### State
```ts
const [hoursBack, setHoursBack] = useState(24);           // for threat + anomaly
const [complianceFramework, setComplianceFramework] = useState('ISO27001');
const [compliancePeriod, setCompliancePeriod] = useState(168); // hours = 7 days

const [threatLoading, setThreatLoading] = useState(false);
const [anomalyLoading, setAnomalyLoading] = useState(false);
const [complianceLoading, setComplianceLoading] = useState(false);

const [threatResult, setThreatResult] = useState(null);
const [anomalyResult, setAnomalyResult] = useState(null);
const [complianceResult, setComplianceResult] = useState(null);
```

### "Run Analysis" button
Calls all three endpoints in parallel using `Promise.all` — threat-summary and anomaly-detect share the same `hoursBack`.

### "Generate Report" button
Calls only the compliance-report endpoint with `complianceFramework` and `compliancePeriod`.

### Loading state
Show a spinner with text "GPT-4o-mini is analysing X log entries..." while loading.

### Error state
Show a red alert card: "AI analysis failed: [error message]. Please try again."

### Severity badge colours (match existing dashboard)
- CRITICAL → red-600
- HIGH → red-400
- MEDIUM → amber-500
- LOW → blue-400

### Framework pill colours (match existing dashboard)
- ISO27001 → indigo
- NIST_800_53 → sky
- NIST_AI_RMF → violet
- OWASP_API → orange
- GDPR → emerald
- POPIA → cyan

### Cost display
Show `Cost: $X.XXXXXX · Xtok` in small muted text at the bottom-right of each result card.

### Copy / Download buttons
- Copy: copies the `summary` or `report` string to clipboard using `navigator.clipboard.writeText`
- Download .txt: triggers a `Blob` download with filename `threat-brief-YYYY-MM-DD.txt` / `compliance-ISO27001-YYYY-MM-DD.txt`

### Time selector options
```
[1h, 4h, 12h, 24h, 48h, 7 days, 30 days]
→ values in hours: [1, 4, 12, 24, 48, 168, 720]
```

### Framework selector options
```
ISO 27001 | GDPR | POPIA | NIST SP 800-53 | NIST AI RMF | OWASP API | All Frameworks
→ values: ISO27001 | GDPR | POPIA | NIST_800_53 | NIST_AI_RMF | OWASP_API | ALL
```

---

## ACCEPTANCE CHECKLIST

- [ ] "AI Insights" tab appears as 6th tab in existing tab bar
- [ ] No existing tabs broken or shifted
- [ ] "Run Analysis" triggers all three endpoints in parallel
- [ ] Loading spinner shows during each fetch
- [ ] Threat briefing renders as readable prose (preserve line breaks)
- [ ] Anomaly cards render sorted by severity (CRITICAL first)
- [ ] Zero anomalies shows "✅ No anomalies detected in this period"
- [ ] Compliance report renders as readable prose (preserve line breaks)
- [ ] Copy button copies to clipboard
- [ ] Download button triggers .txt file download
- [ ] Cost and token count shown per result
- [ ] Severity badges use correct colours
- [ ] Framework pills use correct colours
- [ ] Error state shown if any endpoint returns success: false
- [ ] Uses `https://marketaccess.vercel.app` as base URL for all three calls
- [ ] No changes to any other tab or existing component
