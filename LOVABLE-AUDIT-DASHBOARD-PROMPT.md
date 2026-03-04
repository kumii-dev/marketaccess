# 🎯 LOVABLE.DEV PROMPT: Enterprise Audit Logs Dashboard

## Project Overview
Build a comprehensive enterprise-grade audit logging dashboard at `https://kumii.africa/admin/audit-logs` for ICT governance, compliance monitoring, and security analytics across multiple applications (starting with MarketAccess).

---

## 🔒 Compliance Requirements

Must support the following frameworks:
- **ISO 27001:2022** - Information Security Management (A.12.4.1 Event Logging)
- **NIST SP 800-53** - Security Controls (AU-2, AU-3, AU-6, AU-12)
- **NIST AI RMF 1.0** - AI Risk Management Framework
- **OWASP API Security Top 10 2023** - API Security Best Practices
- **GDPR** - General Data Protection Regulation (Article 30)
- **POPIA** - Protection of Personal Information Act (South Africa)

---

## 📊 Page Structure

### **Main Dashboard View** (`/admin/audit-logs`)

#### 1. **Header Section**
- **Title**: "Enterprise Audit Logs & Compliance Dashboard"
- **Subtitle**: "ISO 27001 | NIST SP 800-53 | OWASP | GDPR | POPIA Compliance Monitoring"
- **Date Range Selector**: Last 24h, 7 days, 30 days, 90 days, Custom
- **Application Filter**: Dropdown to filter by application (MarketAccess, etc.)
- **Real-time Status Indicator**: Green = Normal, Yellow = Warnings, Red = Critical Events

#### 2. **Key Metrics Cards** (4 cards in a row)

**Card 1: Total Events**
- Number: Total audit log count for selected period
- Icon: 📋
- Trend: % change vs previous period
- Breakdown: SUCCESS (green), FAILURE (red), BLOCKED (orange)

**Card 2: Critical Alerts**
- Number: Count of CRITICAL + HIGH severity events
- Icon: 🚨
- Color: Red if > 0, Green if 0
- Click: Filters to show only critical events

**Card 3: AI Operations Cost**
- Number: Total USD spend on AI operations
- Icon: 🤖
- Subtitle: Total tokens used
- Breakdown: By model (gpt-4o-mini, etc.)

**Card 4: Compliance Score**
- Number: Percentage (e.g., "98%")
- Icon: ✅
- Color: Green > 95%, Yellow 80-95%, Red < 80%
- Subtitle: Framework compliance status

#### 3. **Compliance Framework Status** (5 pills/badges)

Display as horizontal pills with color-coded status:

```
[ISO 27001: ✅ 98%] [NIST: ✅ 97%] [OWASP: ⚠️ 85%] [GDPR: ✅ 100%] [POPIA: ✅ 100%]
```

Click each pill to filter logs by that framework.

#### 4. **Real-Time Event Stream** (Top Section)

- **Live Feed**: Auto-refreshing stream (every 5 seconds)
- **Display**: Last 10 events with color-coded severity
- **Format**: `[TIMESTAMP] [LEVEL] [CATEGORY] [ACTION] - [RESULT]`
- **Example**: 
  ```
  [14:23:45] [HIGH] AUTHENTICATION Login - FAILURE (user@example.com)
  [14:23:42] [INFO] AI_OPERATION AI API Call - SUCCESS (250 tokens, $0.0002)
  ```
- **Click**: Expands to show full event details

#### 5. **Main Data Table** (Sortable, Filterable, Paginated)

**Columns:**
1. **Timestamp** - ISO format with timezone
2. **Level** - Badge with color (CRITICAL=red, HIGH=orange, MEDIUM=yellow, LOW=blue, INFO=gray)
3. **Category** - Text with icon (🔐 AUTH, 🤖 AI, 📊 DATA, ⚠️ ERROR, etc.)
4. **Action** - Brief description
5. **User** - Email or "Anonymous"
6. **Result** - Badge (SUCCESS=green, FAILURE=red, BLOCKED=orange)
7. **Frameworks** - Pills showing compliance tags
8. **Details** - "View" button

**Features:**
- **Sorting**: Click column headers to sort
- **Filtering**: 
  - Search bar: Full-text search across all fields
  - Category filter: Multi-select dropdown
  - Level filter: Multi-select dropdown
  - Result filter: Multi-select dropdown
  - Framework filter: Multi-select dropdown
  - User filter: Email autocomplete
- **Pagination**: 50 items per page
- **Export**: CSV, JSON, PDF buttons

#### 6. **Charts Section** (Below table)

**Chart 1: Event Timeline** (Line chart)
- X-axis: Time (hourly/daily based on date range)
- Y-axis: Event count
- Series: One line per severity level (CRITICAL, HIGH, MEDIUM, LOW, INFO)
- Stacked area chart style

**Chart 2: Category Distribution** (Donut chart)
- Segments: Each event category with percentage
- Colors: Distinct for each category
- Click: Filters table to that category

**Chart 3: AI Cost Trend** (Bar chart)
- X-axis: Date
- Y-axis: USD cost
- Bars: Daily/hourly AI operation costs
- Tooltip: Shows token count and cost

**Chart 4: Security Events Heatmap** (Calendar heatmap)
- Grid: Days of the month
- Color intensity: Number of security events (auth, access control, etc.)
- Tooltip: Shows event count on hover

#### 7. **Event Detail Modal** (Click "View" on any row)

Shows comprehensive event information:

```
Event ID: abc123-def456
Timestamp: 2026-03-04T14:23:45.123Z
Session ID: sess-xyz789
Correlation ID: corr-abc123

=== User Context ===
User ID: user-uuid-here
Email: user@example.com
Role: user
IP Address: 192.168.1.1
User Agent: Mozilla/5.0...

=== Event Details ===
Category: AUTHENTICATION
Level: HIGH
Action: Login Attempt
Resource: Authentication System
Result: FAILURE

=== Compliance Frameworks ===
📋 ISO 27001 - Control A.9.4.1 (Information Access Management)
📋 NIST SP 800-53 - Control IA-2 (Identification and Authentication)

=== Metadata ===
{
  "loginMethod": "email/password",
  "failureReason": "Invalid credentials",
  "attemptNumber": 3
}

=== Related Events ===
[Show 3 other events with same correlation ID]
```

Buttons: [Close] [Export JSON] [View Related Events]

---

## 🎨 Design System

### Colors
- **Primary**: Deep Blue (#0f172a)
- **Success**: Green (#10b981)
- **Warning**: Yellow/Orange (#f59e0b)
- **Danger**: Red (#ef4444)
- **Info**: Blue (#3b82f6)
- **Background**: Light Gray (#f9fafb)
- **Card Background**: White (#ffffff)

### Typography
- **Headers**: Inter Bold, 24px-32px
- **Body**: Inter Regular, 14px-16px
- **Monospace** (for logs): Fira Code, 13px

### Components
- **Cards**: White background, subtle shadow, rounded corners (8px)
- **Badges**: Pill-shaped, colored by status
- **Buttons**: Primary (blue), Secondary (gray), Danger (red)
- **Table**: Striped rows, hover effect, sticky header

---

## 🔌 API Integration

### **Endpoint**: `POST https://kumii.africa/admin/audit-logs`

**Request Headers:**
```json
{
  "Content-Type": "application/json",
  "X-API-Key": "your-api-key-here",
  "X-Application": "MarketAccess"
}
```

**Request Body:**
```json
{
  "batch": [
    {
      "timestamp": "2026-03-04T14:23:45.123Z",
      "sessionId": "sess-xyz789",
      "userId": "user-uuid",
      "userEmail": "user@example.com",
      "userRole": "user",
      "category": "AUTHENTICATION",
      "level": "HIGH",
      "action": "Login",
      "resource": "Authentication System",
      "result": "FAILURE",
      "sourceIp": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "frameworks": ["ISO27001", "NIST_800_53"],
      "metadata": {
        "iso27001Control": "A.9.4.1",
        "nistControl": "IA-2",
        "failureReason": "Invalid credentials"
      },
      "sensitiveData": false,
      "correlationId": "corr-abc123"
    }
  ],
  "batchMetadata": {
    "batchId": "batch-1234567890",
    "batchSize": 1,
    "timestamp": "2026-03-04T14:23:45.123Z"
  }
}
```

**Response:**
```json
{
  "success": true,
  "received": 1,
  "processed": 1,
  "batchId": "batch-1234567890"
}
```

### **Dashboard Data Endpoint**: `GET https://kumii.africa/admin/audit-logs/api/events`

**Query Parameters:**
- `from` - Start timestamp (ISO 8601)
- `to` - End timestamp (ISO 8601)
- `application` - Filter by application name
- `category` - Filter by category
- `level` - Filter by severity level
- `result` - Filter by result (SUCCESS, FAILURE, etc.)
- `frameworks` - Filter by compliance framework
- `userId` - Filter by user ID
- `search` - Full-text search
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)

**Example:**
```
GET /admin/audit-logs/api/events?from=2026-03-03T00:00:00Z&to=2026-03-04T23:59:59Z&level=CRITICAL,HIGH&limit=50
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "log-uuid-1",
      "timestamp": "2026-03-04T14:23:45.123Z",
      "level": "HIGH",
      "category": "AUTHENTICATION",
      "action": "Login",
      "userEmail": "user@example.com",
      "result": "FAILURE",
      "frameworks": ["ISO27001", "NIST_800_53"],
      "metadata": {...}
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1234,
    "pages": 25
  },
  "metrics": {
    "totalEvents": 1234,
    "criticalCount": 5,
    "successRate": 98.5,
    "aiCost": 12.45
  }
}
```

---

## 📈 Additional Features

### 1. **Compliance Report Generator**
- Button: "Generate Compliance Report"
- Options: Select frameworks (ISO 27001, NIST, OWASP, GDPR, POPIA)
- Date range selector
- Output: PDF report with:
  - Executive summary
  - Event statistics by framework
  - Critical findings
  - Compliance score breakdown
  - Recommendations

### 2. **Alert Rules Configuration** (Admin panel)
- Define custom alert rules:
  - "Alert if > 5 failed logins in 1 hour"
  - "Alert if AI cost > $50/day"
  - "Alert on any CRITICAL event"
- Notification channels: Email, Slack, SMS
- Test alert button

### 3. **User Activity Timeline**
- Click on any user email
- Shows chronological timeline of all their events
- Visual timeline with zoom/scroll
- Export user activity report (GDPR/POPIA compliance)

### 4. **Framework Deep-Dive Pages**
- `/admin/audit-logs/iso27001` - ISO 27001 specific dashboard
- `/admin/audit-logs/nist` - NIST specific dashboard
- `/admin/audit-logs/owasp` - OWASP specific dashboard
- Each shows only events tagged with that framework
- Framework-specific metrics and recommendations

### 5. **Real-Time Monitoring Dashboard** (Optional TV mode)
- `/admin/audit-logs/monitor` - Full-screen monitoring view
- Large real-time event stream
- Big metric numbers
- Auto-refresh every 5 seconds
- Perfect for displaying on office monitors

---

## 🔐 Security & Access Control

### Authentication
- Require admin authentication (JWT token)
- Support for role-based access:
  - **Admin**: Full access
  - **Auditor**: Read-only access
  - **User**: Can only see their own logs (separate endpoint)

### Data Protection
- Sensitive data flagged logs: Mask email addresses except for admins
- IP address anonymization option (GDPR compliance)
- Export logs with PII redaction option

### Audit Trail
- Log all access to the audit logs dashboard (meta-audit)
- Track who viewed which logs and when
- Track exports and report generations

---

## 🎯 Success Criteria

The dashboard is complete when:
- ✅ Can receive and display audit logs from MarketAccess app
- ✅ Shows real-time events (< 5 second delay)
- ✅ All filters and search work correctly
- ✅ Charts render correctly with accurate data
- ✅ Compliance scores calculate correctly
- ✅ Export functions work (CSV, JSON, PDF)
- ✅ Event detail modal shows all information
- ✅ Responsive design works on desktop, tablet, mobile
- ✅ Loading states and error handling work smoothly
- ✅ Admin authentication is enforced
- ✅ Performance: Loads 10,000+ logs without lag

---

## 📦 Tech Stack Recommendations

- **Frontend**: React 18+ with TypeScript
- **UI Framework**: Tailwind CSS + shadcn/ui components
- **Charts**: Recharts or Chart.js
- **Tables**: TanStack Table (react-table)
- **Date Handling**: date-fns or dayjs
- **API Client**: Axios or Fetch
- **State Management**: React Query (TanStack Query) for server state
- **Authentication**: JWT with HTTP-only cookies
- **Backend**: Node.js + Express OR Next.js API routes
- **Database**: PostgreSQL (Supabase) with proper indexing

---

## 🚀 Implementation Priority

### Phase 1 - Core Dashboard (Week 1)
1. Basic layout and navigation
2. API endpoint to receive logs
3. Main data table with sorting and filtering
4. Key metrics cards
5. Event detail modal

### Phase 2 - Visualization (Week 2)
6. Event timeline chart
7. Category distribution chart
8. Real-time event stream
9. Compliance framework pills

### Phase 3 - Advanced Features (Week 3)
10. AI cost tracking and charts
11. Security events heatmap
12. Export functionality (CSV, JSON)
13. User activity timeline

### Phase 4 - Compliance & Reporting (Week 4)
14. Compliance report generator (PDF)
15. Alert rules configuration
16. Framework-specific dashboards
17. Real-time monitoring view

---

## 📝 Sample Data for Testing

Use this JSON structure to test the dashboard with sample data:

```json
{
  "batch": [
    {
      "timestamp": "2026-03-04T14:23:45.123Z",
      "sessionId": "sess-abc123",
      "userId": "user-001",
      "userEmail": "john@example.com",
      "userRole": "user",
      "category": "AUTHENTICATION",
      "level": "INFO",
      "action": "Login",
      "resource": "Authentication System",
      "result": "SUCCESS",
      "sourceIp": "192.168.1.100",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "frameworks": ["ISO27001", "NIST_800_53"],
      "metadata": {
        "iso27001Control": "A.9.4.1",
        "nistControl": "IA-2",
        "loginMethod": "email/password"
      },
      "sensitiveData": false,
      "correlationId": "corr-xyz789"
    },
    {
      "timestamp": "2026-03-04T14:25:12.456Z",
      "sessionId": "sess-abc123",
      "userId": "user-001",
      "userEmail": "john@example.com",
      "userRole": "user",
      "category": "AI_OPERATION",
      "level": "INFO",
      "action": "AI API Call",
      "resource": "AI Model: gpt-4o-mini",
      "result": "SUCCESS",
      "sourceIp": "192.168.1.100",
      "frameworks": ["NIST_AI_RMF", "ISO27001"],
      "metadata": {
        "model": "gpt-4o-mini",
        "tokensUsed": 250,
        "cost": 0.0002,
        "costCurrency": "USD",
        "nistAIFunction": "MEASURE"
      },
      "sensitiveData": false,
      "correlationId": "corr-xyz789"
    },
    {
      "timestamp": "2026-03-04T14:30:00.789Z",
      "sessionId": "sess-def456",
      "userId": "anonymous",
      "userEmail": null,
      "userRole": "guest",
      "category": "RATE_LIMIT",
      "level": "MEDIUM",
      "action": "Rate Limit Exceeded",
      "resource": "/api/ai/analyze-tender",
      "result": "BLOCKED",
      "sourceIp": "203.0.113.45",
      "frameworks": ["OWASP_API", "ISO27001"],
      "metadata": {
        "limit": 30,
        "current": 31,
        "owaspCategory": "API4:2023 - Unrestricted Resource Consumption"
      },
      "sensitiveData": false,
      "correlationId": "corr-abc456"
    }
  ]
}
```

---

## 🎨 UI Mockup Description

**Top Section:**
```
┌────────────────────────────────────────────────────────────────┐
│ 🔒 Enterprise Audit Logs & Compliance Dashboard                │
│ ISO 27001 | NIST SP 800-53 | OWASP | GDPR | POPIA             │
│                                                                 │
│ [Last 24h ▼] [MarketAccess ▼] [Search...] [Export ▼] 🟢 Live │
└────────────────────────────────────────────────────────────────┘

┌─────────────┬─────────────┬─────────────┬─────────────┐
│ 📋 Total    │ 🚨 Critical │ 🤖 AI Cost  │ ✅ Complianc│
│ 1,234       │ 5           │ $12.45      │ 98%         │
│ Events      │ Alerts      │ (25K tokens)│ Score       │
│ ↑ 5.2%      │ 🔴 High     │ ↑ $2.30     │ 🟢 Excellent│
└─────────────┴─────────────┴─────────────┴─────────────┘

[ISO 27001: ✅ 98%] [NIST: ✅ 97%] [OWASP: ⚠️ 85%] [GDPR: ✅ 100%]

🔴 LIVE: [14:23:45] [HIGH] AUTHENTICATION Login - FAILURE
🟢 LIVE: [14:23:42] [INFO] AI_OPERATION AI API Call - SUCCESS
```

**Table Section:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Filters: [All Categories ▼] [All Levels ▼] [All Results ▼]    │
├──────────┬──────┬────────────┬──────────┬──────┬────────┬──────┤
│Timestamp │Level │Category    │Action    │User  │Result  │Detail│
├──────────┼──────┼────────────┼──────────┼──────┼────────┼──────┤
│14:23:45  │🔴 HI │🔐 AUTH     │Login     │john@ │❌ FAIL │[View]│
│14:23:42  │🟢 IN │🤖 AI       │API Call  │john@ │✅ SUCC │[View]│
│14:23:40  │🟡 ME │⚡ RATE_LIM │Exceeded  │anon  │🚫 BLOC │[View]│
└──────────┴──────┴────────────┴──────────┴──────┴────────┴──────┘
```

---

## ✅ Acceptance Checklist

Before considering the dashboard complete, verify:

- [ ] All compliance frameworks are properly tagged and filterable
- [ ] Real-time updates work without manual refresh
- [ ] Charts accurately reflect the underlying data
- [ ] Export functions generate valid files
- [ ] Sensitive data is properly handled (masked where appropriate)
- [ ] Performance is acceptable with 10,000+ log entries
- [ ] Mobile responsiveness works well
- [ ] Authentication prevents unauthorized access
- [ ] API error handling shows user-friendly messages
- [ ] Timezone handling is correct for all timestamps
- [ ] Search works across all relevant fields
- [ ] Correlation ID linking works for related events
- [ ] Compliance report PDF generates correctly
- [ ] Alert configuration interface is intuitive

---

## 🎯 End Goal

A production-ready enterprise audit logging dashboard that:
1. Provides complete visibility into security and compliance events
2. Helps identify security threats in real-time
3. Supports regulatory compliance audits (ISO 27001, NIST, GDPR, POPIA)
4. Tracks AI operation costs and usage
5. Enables data-driven security decisions
6. Scales to handle millions of audit log entries
7. Meets enterprise ICT governance standards

**This dashboard should be the single source of truth for all security, compliance, and operational audit data across the kumii.africa platform.**
