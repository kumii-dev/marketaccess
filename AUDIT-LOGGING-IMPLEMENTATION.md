# Enterprise Audit Logging Implementation Guide

**Status:** ✅ READY FOR DEPLOYMENT  
**Date:** March 4, 2026  
**Compliance:** ISO 27001, NIST SP 800-53, OWASP, GDPR, POPIA

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [What Was Implemented](#what-was-implemented)
3. [Architecture](#architecture)
4. [Usage Examples](#usage-examples)
5. [Supabase Setup](#supabase-setup)
6. [Integration Points](#integration-points)
7. [Compliance Mapping](#compliance-mapping)
8. [Dashboard Requirements](#dashboard-requirements)
9. [Testing](#testing)
10. [Next Steps](#next-steps)

---

## Overview

Enterprise-grade audit logging system that captures all security-relevant events across the MarketAccess application and sends them to a centralized admin dashboard at `https://kumii.africa/admin/audit-logs` for compliance monitoring, security analytics, and ICT governance.

### Compliance Frameworks Supported

- **ISO 27001:2022** - A.12.4.1 (Event Logging), A.18.1.4 (Privacy & PII)
- **NIST SP 800-53** - AU-2, AU-3, AU-6, AU-12
- **NIST AI RMF 1.0** - GOVERN, MAP, MEASURE, MANAGE functions
- **OWASP API Security Top 10 2023** - API4 (Resource Consumption), API8 (Security Misconfiguration)
- **GDPR** - Article 30 (Records of Processing Activities)
- **POPIA** - Section 51 (Security Measures), Section 24 (Right to Access)

---

## What Was Implemented

### 1. **Audit Logger Module** (`src/utils/auditLogger.js` - 680 lines)

Comprehensive audit logging system with:

**Core Features:**
- ✅ Batch processing (sends every 5 seconds or 10 logs)
- ✅ Dual storage (Supabase + centralized dashboard)
- ✅ Session tracking with correlation IDs
- ✅ User context capture (authentication state)
- ✅ Automatic framework tagging
- ✅ Severity level classification
- ✅ Sensitive data flagging

**Event Categories (19 types):**
- Authentication, Authorization, Access Control
- AI Operations, AI Cost, AI Security
- Data Access, Data Modification, Data Export, PII Access
- System Errors, Performance, Availability
- Rate Limits, Policy Violations, Compliance Checks
- Tender Access, Matching Operations, User Activity

**Pre-built Helper Functions:**
- `logAuthSuccess()` / `logAuthFailure()`
- `logAICall(model, tokens, cost)`
- `logRateLimitViolation(endpoint, limit, current)`
- `logPIIView(dataType, purpose)`
- `logSystemError(error, component, severity)`
- `logTenderView(tenderId, title)`
- `logDataExportRequest(type, recordCount, format)`

### 2. **Supabase Schema** (`supabase/migrations/create_audit_logs_schema.sql` - 380 lines)

PostgreSQL schema with:

**Main Table: `audit_logs`**
- 20+ columns capturing all audit data
- Comprehensive indexing for performance
- Row-Level Security (RLS) policies
- Check constraints for data validation

**Materialized View: `ai_cost_summary`**
- Daily AI cost aggregation per user
- Token usage tracking
- Cost analytics

**Views:**
- `security_events_summary` - Security event aggregation
- `compliance_events` - Framework-specific events with control mappings

**Functions:**
- `archive_old_audit_logs()` - 90-day retention policy
- `check_critical_security_events()` - Real-time alerting

**Permissions:**
- Authenticated users: SELECT on own logs
- Service role: INSERT for audit logs
- Admins/Auditors: SELECT on all logs
- No DELETE permissions (immutable audit trail)

### 3. **Rate Limiter Integration** (`server/middleware/rateLimiters.js` - updated)

Rate limit violations now automatically send audit logs to:
- Centralized dashboard (`https://kumii.africa/admin/audit-logs`)
- Tagged with OWASP API4 + ISO 27001 compliance

### 4. **Lovable Dashboard Prompt** (`LOVABLE-AUDIT-DASHBOARD-PROMPT.md` - 500+ lines)

Complete specification for building the admin dashboard:
- UI/UX mockups
- API specifications
- Chart requirements
- Compliance report generator
- Real-time monitoring
- Alert configuration

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   MarketAccess App                      │
│                                                         │
│  ┌────────────────────────────────────────┐            │
│  │  auditLogger.js                        │            │
│  │  - Batch Queue (10 logs or 5 seconds) │            │
│  │  - Session Tracking                    │            │
│  │  - User Context Capture                │            │
│  └────────────┬───────────────────────────┘            │
│               │                                         │
│               ├─────────────────┬──────────────────────┤
│               │                 │                      │
│               ▼                 ▼                      │
│    ┌──────────────────┐  ┌──────────────────┐        │
│    │ Supabase         │  │ Centralized      │        │
│    │ audit_logs table │  │ Dashboard API    │        │
│    │ (Local redundancy)│  │ kumii.africa     │        │
│    └──────────────────┘  └─────────┬────────┘        │
└────────────────────────────────────┼─────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │ Enterprise Audit Dashboard │
                        │ https://kumii.africa/      │
                        │        admin/audit-logs    │
                        │                            │
                        │ - Real-time monitoring     │
                        │ - Compliance reports       │
                        │ - Security analytics       │
                        │ - Cost tracking            │
                        └────────────────────────────┘
```

### Data Flow

1. **Event Occurs** → App calls audit logger
2. **Batching** → Logger queues event (max 10 or 5 seconds)
3. **Dual Storage:**
   - **Local**: Supabase `audit_logs` table (redundancy + fast queries)
   - **Central**: Dashboard API (cross-application analytics)
4. **Dashboard** → Displays events in real-time
5. **Compliance** → Generates reports tagged by framework

---

## Usage Examples

### Example 1: Log User Authentication

```javascript
import { auditLogger, logAuthSuccess, logAuthFailure } from './utils/auditLogger';

// Login success
await logAuthSuccess({
  loginMethod: 'email/password',
  deviceInfo: 'iOS 15.0'
});

// Login failure
await logAuthFailure({
  loginMethod: 'email/password',
  failureReason: 'Invalid credentials',
  attemptNumber: 3
});
```

### Example 2: Log AI Operation

```javascript
import { logAICall } from './utils/auditLogger';

const response = await openai.chat.completions.create({...});

await logAICall(
  'gpt-4o-mini',
  response.usage.total_tokens,
  response.usage.total_tokens * 0.0000002,
  {
    operation: 'keyword_extraction',
    inputLength: bioText.length,
    nistAIFunction: 'MEASURE'
  }
);
```

### Example 3: Log Rate Limit Violation

```javascript
import { logRateLimitViolation } from './utils/auditLogger';

if (req.rateLimit.remaining === 0) {
  await logRateLimitViolation(
    '/api/ai/analyze-tender',
    req.rateLimit.limit,
    req.rateLimit.current,
    {
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer']
    }
  );
}
```

### Example 4: Log PII Access

```javascript
import { logPIIView } from './utils/auditLogger';

// Before accessing user profile with email
await logPIIView(
  'Email Address',
  'Display user profile',
  {
    profileId: user.id,
    legalBasis: 'Legitimate Interest',
    dataMinimization: true
  }
);
```

### Example 5: Log Tender Access

```javascript
import { logTenderView } from './utils/auditLogger';

// When user opens tender details
await logTenderView(
  tender.ocid,
  tender.tender.title,
  {
    province: tender.tender.province,
    category: tender.tender.mainProcurementCategory,
    closingDate: tender.tender.tenderPeriod.endDate
  }
);
```

### Example 6: Log System Error

```javascript
import { logSystemError, AuditLogLevel } from './utils/auditLogger';

try {
  // Some operation
} catch (error) {
  await logSystemError(
    error,
    'TenderMatchingEngine',
    AuditLogLevel.HIGH,
    {
      operation: 'calculateMatchScore',
      tenderId: tender.id,
      userId: user.id
    }
  );
}
```

### Example 7: Log Data Export

```javascript
import { logDataExportRequest } from './utils/auditLogger';

// When user exports tender list
await logDataExportRequest(
  'Tender List',
  filteredTenders.length,
  'CSV',
  {
    filters: JSON.stringify(filters),
    dateRange: `${dateFrom} to ${dateTo}`
  }
);
```

### Example 8: Custom Audit Log

```javascript
import { auditLogger, AuditEventCategory, AuditLogLevel, ComplianceFramework } from './utils/auditLogger';

await auditLogger.createLogEntry({
  category: AuditEventCategory.USER_ACTIVITY,
  level: AuditLogLevel.INFO,
  action: 'Profile Update',
  resource: 'User Profile',
  result: 'SUCCESS',
  frameworks: [ComplianceFramework.GDPR, ComplianceFramework.POPIA],
  metadata: {
    fieldsUpdated: ['bio', 'industry', 'skills'],
    gdprArticle: 'Article 16', // Right to Rectification
    popiaSection: 'Section 24'
  }
});
```

---

## Supabase Setup

### Step 1: Run Migration

```bash
# Connect to your Supabase project
psql postgresql://[user]:[password]@[host]:5432/[database]

# Run the migration script
\i supabase/migrations/create_audit_logs_schema.sql
```

OR use Supabase Dashboard:
1. Go to SQL Editor
2. Paste contents of `create_audit_logs_schema.sql`
3. Click "Run"

### Step 2: Verify Schema

```sql
-- Check table exists
SELECT * FROM public.audit_logs LIMIT 1;

-- Check indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'audit_logs';

-- Test materialized view
SELECT * FROM public.ai_cost_summary WHERE date = CURRENT_DATE;
```

### Step 3: Grant Permissions

```sql
-- Service role for backend inserts
GRANT INSERT ON public.audit_logs TO service_role;

-- Authenticated users for reads
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.ai_cost_summary TO authenticated;
GRANT SELECT ON public.security_events_summary TO authenticated;
GRANT SELECT ON public.compliance_events TO authenticated;
```

### Step 4: Schedule Materialized View Refresh

Set up a cron job or pg_cron extension:

```sql
-- Refresh every hour
SELECT cron.schedule('refresh-ai-cost-summary', '0 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.ai_cost_summary');
```

---

## Integration Points

### 1. Authentication Events

**File**: `src/components/Auth/LoginForm.jsx`

```javascript
import { logAuthSuccess, logAuthFailure } from '../utils/auditLogger';

// On successful login
await logAuthSuccess({
  loginMethod: 'email/password',
  deviceInfo: navigator.userAgent
});

// On failed login
await logAuthFailure({
  loginMethod: 'email/password',
  failureReason: error.message,
  attemptNumber: attemptCounter
});
```

### 2. AI Operations

**File**: `src/utils/openaiService.js`

```javascript
import { logAICall } from './auditLogger';

// After OpenAI API call
await logAICall(
  'gpt-4o-mini',
  response.usage.total_tokens,
  calculateCost(response.usage),
  {
    operation: 'extractKeywordsFromBio',
    nistAIFunction: 'MEASURE',
    inputLength: bioText.length,
    outputLength: keywords.length
  }
);
```

### 3. Rate Limiting

**File**: `server/middleware/rateLimiters.js` ✅ ALREADY INTEGRATED

Automatically logs rate limit violations to dashboard.

### 4. Tender Access

**File**: `src/components/TenderDetailsModal.jsx`

```javascript
import { logTenderView } from '../utils/auditLogger';

// When modal opens
useEffect(() => {
  if (isOpen && tender) {
    logTenderView(
      tender.ocid,
      tender.tender?.title,
      {
        province: tender.tender?.province,
        category: tender.tender?.mainProcurementCategory
      }
    );
  }
}, [isOpen, tender]);
```

### 5. Data Exports

**File**: `src/components/FilterBar.jsx` (Add export button)

```javascript
import { logDataExportRequest } from '../utils/auditLogger';

const handleExport = async () => {
  await logDataExportRequest(
    'Tender List',
    tenders.length,
    'CSV',
    {
      filters: JSON.stringify(filters),
      dateRange: `${dateFrom} to ${dateTo}`
    }
  );
  
  // Perform export...
};
```

### 6. PII Access

**File**: `src/components/ProfileSettings.jsx`

```javascript
import { logPIIView } from '../utils/auditLogger';

// When viewing user profile
useEffect(() => {
  if (profile) {
    logPIIView(
      'User Profile',
      'Display settings page',
      {
        fieldsAccessed: ['email', 'phone', 'address'],
        legalBasis: 'Legitimate Interest'
      }
    );
  }
}, [profile]);
```

### 7. Error Handling

**File**: `src/App.jsx`

```javascript
import { logSystemError, AuditLogLevel } from './utils/auditLogger';

// Global error boundary
useEffect(() => {
  const handleError = (event) => {
    logSystemError(
      event.error,
      'GlobalErrorHandler',
      AuditLogLevel.HIGH,
      {
        componentStack: event.error.stack,
        userAction: 'pageLoad'
      }
    );
  };
  
  window.addEventListener('error', handleError);
  return () => window.removeEventListener('error', handleError);
}, []);
```

---

## Compliance Mapping

### ISO 27001:2022

| Control | Description | Implementation |
|---------|-------------|----------------|
| A.9.4.1 | Information Access Management | `logAuthentication()` |
| A.12.1.3 | Capacity Management | `logPerformance()`, rate limiting |
| A.12.4.1 | Event Logging | All audit logs |
| A.12.4.2 | Protection of Log Information | Supabase RLS + immutable logs |
| A.18.1.4 | Privacy & Protection of PII | `logPIIAccess()`, sensitive flag |

### NIST SP 800-53

| Control | Description | Implementation |
|---------|-------------|----------------|
| AU-2 | Event Logging | 19 event categories |
| AU-3 | Content of Audit Records | Comprehensive log structure |
| AU-6 | Audit Review & Analysis | Dashboard + SQL views |
| AU-12 | Audit Generation | auditLogger module |
| IA-2 | Identification & Authentication | `logAuthentication()` |
| SI-4 | System Monitoring | `logError()`, performance tracking |

### NIST AI RMF 1.0

| Function | Implementation |
|----------|----------------|
| GOVERN | `logPIIAccess()`, privacy controls |
| MAP | `logAIOperation()`, risk identification |
| MEASURE | AI performance tracking, cost monitoring |
| MANAGE | Rate limiting, security controls |

### OWASP API Security Top 10 2023

| Risk | Implementation |
|------|----------------|
| API1 | Authorization logging |
| API2 | Authentication logging |
| API4 | Rate limit logging ✅ INTEGRATED |
| API8 | Security misconfiguration alerts |

### GDPR

| Article | Implementation |
|---------|----------------|
| Article 30 | Records of processing activities (`audit_logs` table) |
| Article 20 | Data portability (`logDataExport()`) |
| Article 16 | Right to rectification (track profile updates) |

### POPIA (South Africa)

| Section | Implementation |
|---------|----------------|
| Section 24 | Right to access (`logDataExport()`) |
| Section 51 | Security measures (comprehensive audit trail) |

---

## Dashboard Requirements

### Endpoint Configuration

The MarketAccess app sends logs to:
```
POST https://kumii.africa/admin/audit-logs
```

**Required Headers:**
- `Content-Type: application/json`
- `X-API-Key: [your-api-key]`
- `X-Application: MarketAccess`

**Environment Variable:**
```bash
VITE_AUDIT_API_KEY=your-api-key-here
```

### Dashboard Must Support

1. **Receive Logs** - POST endpoint accepts batch of audit logs
2. **Store Logs** - PostgreSQL/Supabase with proper indexing
3. **Display Logs** - Real-time table with filtering and search
4. **Visualize Data** - Charts for events, costs, security
5. **Compliance Reports** - Generate PDF reports by framework
6. **Alert Rules** - Configure alerts for critical events
7. **Export** - CSV, JSON, PDF exports
8. **Authentication** - Admin/Auditor role-based access

### API Specification

See `LOVABLE-AUDIT-DASHBOARD-PROMPT.md` for complete API spec.

---

## Testing

### Test 1: Verify Audit Logger Initialization

```javascript
import auditLogger from './utils/auditLogger';

console.log('Session ID:', auditLogger.sessionId);
// Should output: Session ID: 1709568225123-abc123def456
```

### Test 2: Test Authentication Logging

```javascript
import { logAuthSuccess } from './utils/auditLogger';

await logAuthSuccess({ loginMethod: 'test' });
// Check Supabase audit_logs table for new row
```

### Test 3: Test AI Operation Logging

```javascript
import { logAICall } from './utils/auditLogger';

await logAICall('gpt-4o-mini', 250, 0.0002, { test: true });
// Check ai_cost_summary materialized view
```

### Test 4: Test Rate Limit Logging

```javascript
import { logRateLimitViolation } from './utils/auditLogger';

await logRateLimitViolation('/api/test', 30, 31, { test: true });
// Should send to both Supabase and dashboard
```

### Test 5: Query Audit Logs

```sql
-- Recent events
SELECT * FROM public.audit_logs
ORDER BY timestamp DESC
LIMIT 10;

-- Critical events
SELECT * FROM public.audit_logs
WHERE level IN ('CRITICAL', 'HIGH')
ORDER BY timestamp DESC;

-- AI costs today
SELECT * FROM public.ai_cost_summary
WHERE date = CURRENT_DATE;

-- Security events
SELECT * FROM public.security_events_summary
WHERE date >= CURRENT_DATE - INTERVAL '7 days';
```

### Test 6: Check Critical Alerts

```sql
SELECT * FROM check_critical_security_events();
```

---

## Next Steps

### Immediate (This Week)

1. **Deploy Supabase Migration**
   ```bash
   # Run create_audit_logs_schema.sql on production Supabase
   ```

2. **Configure Environment Variables**
   ```bash
   # Add to .env
   VITE_AUDIT_API_KEY=your-api-key-here
   ```

3. **Test Audit Logging**
   - Add test calls to key functions
   - Verify logs appear in Supabase
   - Check batch sending to dashboard

### Short Term (This Month)

4. **Build Admin Dashboard** (Use Lovable prompt)
   - Start with `LOVABLE-AUDIT-DASHBOARD-PROMPT.md`
   - Build at `https://kumii.africa/admin/audit-logs`
   - Test receiving logs from MarketAccess

5. **Integrate All Event Points**
   - Authentication (login/logout)
   - AI operations (all OpenAI calls)
   - Tender access (views, exports)
   - Profile access (PII viewing)
   - Errors (global error handler)

6. **Set Up Alerts**
   - Configure email/Slack alerts
   - Test critical event detection
   - Schedule materialized view refresh

### Long Term (Next Quarter)

7. **Compliance Reports**
   - Build PDF report generator
   - Create framework-specific dashboards
   - Schedule automated reports

8. **Advanced Analytics**
   - User behavior analysis
   - Cost optimization recommendations
   - Security posture scoring

9. **Multi-Application Support**
   - Extend to other kumii.africa apps
   - Cross-application correlation
   - Unified security monitoring

---

## 🎉 Summary

### What's Ready Now

✅ Audit logger module (`auditLogger.js`)  
✅ Supabase schema with full compliance tagging  
✅ Rate limiter integration  
✅ Helper functions for common events  
✅ Batch processing to centralized dashboard  
✅ Comprehensive documentation  
✅ Lovable dashboard prompt (500+ lines)  

### What's Needed

⏳ Deploy Supabase schema (5 minutes)  
⏳ Build admin dashboard using Lovable (1-2 weeks)  
⏳ Integrate audit logging into all components (2-3 days)  
⏳ Configure alert rules (1 day)  
⏳ Test end-to-end flow (1 day)  

### Impact

🔒 **Security**: Complete audit trail of all security events  
📊 **Compliance**: ISO 27001, NIST, OWASP, GDPR, POPIA ready  
💰 **Cost Control**: AI operation cost tracking  
🎯 **Governance**: Enterprise-grade ICT governance  
⚡ **Performance**: Fast queries with proper indexing  
🌍 **Cross-device**: Centralized logging across all apps  

---

**Ready to proceed with dashboard implementation using the Lovable prompt!** 🚀
