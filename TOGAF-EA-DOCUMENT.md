# Enterprise Architecture Document — Market Access Platform
### TOGAF ADM-Aligned Architecture Definition Document (ADD)

| Field | Value |
|---|---|
| Document Owner | Enterprise Architecture Function, Kumii |
| System Name | Market Access ("marketaccess") |
| Parent Platform | Kumii Africa (`www.kumii.africa`) |
| Document Status | Baseline (Current State) + Target State Vision |
| TOGAF Phases Covered | Preliminary, A (Vision), B (Business), C (Data & Application), D (Technology), E (Opportunities & Solutions), F (Migration Planning) |
| Key Milestone | **iFrame embedding deprecated Monday, 7 September** — superseded by native greenfield build on `kumii.africa` |
| Date | 1 September 2026 |
| Classification | Internal — Engineering & Business Stakeholders |

---

## 0. Executive Summary

Market Access is a production React/Express application that surfaces South African public-sector tender opportunities (National Treasury eTenders OCDS API) and private-sector tender opportunities to SMEs, augmented with AI-powered matching, an audit/compliance subsystem (NIST/ISO/OWASP-aligned), and email digesting. It currently operates as a **standalone Vercel-hosted application embedded via `<iframe>`** into the `kumii.africa` host shell, with authentication delegated to the host via a `postMessage` JWT handshake.

This document records the **current-state (Baseline) architecture** using TOGAF's four architecture domains (Business, Data, Application, Technology), and defines the **Target-State architecture**: a **greenfield, natively-integrated module inside the `kumii.africa` platform codebase**, eliminating the iframe/postMessage boundary entirely. The iframe integration pattern is scheduled for **decommissioning on Monday, 7 September**, making this the forcing deadline for the Phase E/F migration and consolidation plan below.

Per engineering leadership direction, this document **does not prescribe formal UAT/test-cycle windows** — the engineering team is assumed capable of defining and executing its own verification approach; only architecture, sequencing, and cutover milestones are governed here.

---

## 1. Preliminary Phase — Architecture Principles & Scope

### 1.1 Business Drivers
- **Market access equity**: give South African SMEs, particularly historically disadvantaged suppliers, low-friction discovery of public and private tender opportunities.
- **Trust & compliance**: the platform is positioned as an enterprise-grade, auditable system (NIST AI RMF, ISO 27001, OWASP alignment) — a differentiator in government-adjacent procurement tooling.
- **Platform consolidation**: Kumii is consolidating disparate pilot modules (Market Access, Learning Hub, etc.) into one coherent product surface on `kumii.africa`, removing the operational and UX overhead of iframe-federated micro-apps.

### 1.2 Architecture Principles
| # | Principle | Implication |
|---|---|---|
| P1 | Single Identity Domain | All auth flows through the Kumii host's Supabase project; no module maintains a parallel identity boundary. |
| P2 | API-First Business Logic | Tender sync, matching, and audit logic live in shared services, callable natively, not proxied through `postMessage`. |
| P3 | Data Sovereignty in Supabase | Postgres (Supabase) remains system-of-record; no new database technology introduced in the greenfield build. |
| P4 | Progressive Decommissioning | Legacy iframe path is retired in a single cutover (7 Sept), not run in parallel indefinitely — avoids dual-maintenance drag. |
| P5 | Resilience by Design | External dependency (gov eTenders OCDS API) is unreliable; architecture must degrade gracefully (cache-first, static fallback). |
| P6 | Compliance as a First-Class Capability | Audit logging, AI governance, and rate-limiting are architectural tenants, not bolt-ons. |

### 1.3 Scope
In scope: Market Access frontend (React SPA), Express backend/API layer, Supabase schema, AI-assisted matching/audit services, email digest subsystem, and the integration boundary with `kumii.africa`.
Out of scope: Detailed architecture of unrelated Kumii modules (e.g., Learning Hub), except as an integration reference pattern.

---

## 2. Phase A — Architecture Vision

### 2.1 Baseline Vision Statement
Market Access today is a **federated satellite application**: an independently deployed Vercel app, embedded via iframe into `kumii.africa`, with authentication bridged via `postMessage`. It functions correctly but represents an **architectural seam** — two deployment lifecycles, two codebases, a security-sensitive cross-origin bridge, and duplicated UI chrome (navbars, session handling).

### 2.2 Target Vision Statement
Market Access becomes a **native domain module inside the `kumii.africa` monorepo/platform**, sharing the host's routing, authentication session, design system, and deployment pipeline. The user experience becomes seamless (`kumii.africa/access-to-market` as a first-class route, not an embedded frame). All backend capabilities (tender sync, AI matching, audit intelligence, email digests) are re-hosted as services within (or directly callable by) the Kumii platform backend.

### 2.3 Stakeholders

| Stakeholder | Concern |
|---|---|
| SME end-users (tender applicants) | Fast, accurate, trustworthy tender discovery; single sign-on with rest of Kumii |
| Kumii Platform team | One deployment surface, consistent auth/session model, reduced cross-origin security surface |
| Compliance/Governance | Continued NIST AI RMF / ISO 27001 / OWASP audit trail post-migration |
| Engineering (Market Access team) | Clean migration path, minimal rework of business logic, clear cutover date |
| Procurement/Business Sponsors | No loss of the AI-matching / private-tenders differentiators during migration |

### 2.4 Key Constraint / Forcing Function
> **The iframe integration is deprecated Monday, 7 September.** This is a hard architectural deadline. From that date, `kumii.africa` will not host the `<iframe src="...vercel.app">` embed, nor rely on the `postMessage` auth-bridge (`REQUEST_AUTH_TOKEN` / `KUMII_AUTH_TOKEN` / `OPEN_DOCUMENT` / `NAVIGATE_TO_*` message catalogue). The Target State must be live (at minimum, MVP-complete for core tender discovery + auth) by that date, or an interim continuity plan must be enacted (§7.4).

---

## 3. Phase B — Business Architecture

### 3.1 Business Capability Map

| Capability | Current Realization | Target Realization |
|---|---|---|
| **Public Tender Discovery** | `/api/tenders`, `/api/active-tenders` (Express) + `TenderCard`, `FilterBar`, `Pagination` components | Native Kumii module route; same capability, same Supabase-backed cache |
| **Private Tender Management** | `PrivateTendersPage`, `AddTenderModal`, Supabase `private_tenders`-style tables | Ported as-is; owned by same domain team |
| **AI-Powered Smart Matching** | `SmartMatchedTenders.jsx` + OpenAI GPT-4o-mini via `routes/ai.js` | Retained; OpenAI call proxied through Kumii's shared AI gateway if one exists, else kept as dedicated service |
| **My Tenders / Applicant Workspace** | `MyTendersPage.jsx` | Retained; benefits from native session (no auth race conditions) |
| **Audit & Compliance Intelligence** | `routes/audit.js`, `routes/auditAI.js`, `NISTComplianceIndicator.jsx` | Elevated to a platform-wide capability — audit ingestion becomes a shared Kumii service, Market Access is one producer among many |
| **Email Digest / Notifications** | `routes/email.js`, `node-cron` daily/weekly SAST digest | Migrated to Kumii's central notification/cron infrastructure |
| **Document Retrieval & Parsing** | `routes/tenderDocs.js` (mammoth/pdf-parse) | Retained as a backend microservice/function |
| **Rate Limiting & API Governance** | `middleware/rateLimiters.js` (express-rate-limit) | Superseded by Kumii platform's central API gateway rate limiting where available |

### 3.2 Business Process View — Tender Discovery (Baseline)

```
SME User → kumii.africa (host) → <iframe> Market Access (Vercel)
                                        │
                                        ├─ postMessage: REQUEST_AUTH_TOKEN
                                        ├─ (host replies) KUMII_AUTH_TOKEN
                                        ▼
                                Express /api/active-tenders (Supabase cache)
                                        │
                                        ▼
                                Hourly cron sync ← National Treasury OCDS API
```

### 3.3 Business Process View — Tender Discovery (Target)

```
SME User → kumii.africa/access-to-market (native route, shared session)
                    │
                    ▼
        Kumii platform backend (Market Access domain service)
                    │
                    ▼
        Supabase (shared/co-located project) ← hourly sync ← OCDS API
```

**Business benefit:** removal of the auth handshake latency window ("waiting for authentication" UI state), removal of dual-origin CORS policy (`origin: '*'` currently — a flagged security gap), and unification of navigation (`NAVIGATE_TO_PROFILE`, `NAVIGATE_TO_TENDERS` message types become simple in-app router calls).

### 3.4 Organisational Impact
- **No new business roles required.** Existing Market Access engineering owns the ported domain module.
- **Governance responsibility for audit logs** shifts from an application-level `/admin/audit-logs` endpoint to a platform-level compliance capability — recommend a RACI update naming the Kumii platform team as *Accountable* for the ingestion pipeline, Market Access team as *Responsible* for event production.
- **Vendor/contract impact:** Vercel hosting for the standalone frontend/backend becomes redundant post-migration; decommission after cutover to avoid duplicate hosting spend.

### 3.5 Value Stream Alignment
| Value Stream Stage | Current Friction | Target Improvement |
|---|---|---|
| Discover opportunity | iframe load + auth handshake delay | Instant, session already warm |
| Assess fit (AI match) | Works well today | Unchanged, retained as-is |
| Apply / respond | `TenderResponseModal` inside iframe, `OPEN_DOCUMENT` postMessage to pop external tab | Native `window.open` / in-app viewer, no cross-origin indirection |
| Track (My Tenders) | Isolated frame state | Shared with Kumii-wide notification/profile state |
| Get notified (email digest) | Independent cron on Market Access server | Unified with Kumii's notification cadence |

---

## 4. Phase C — Information Systems Architecture

### 4.1 Data Architecture (Baseline)

**System of record:** Supabase (PostgreSQL).

| Table / Migration | Purpose |
|---|---|
| `001_cache_tables.sql` | General tender/API response caching |
| `002_etender_daily_cache.sql` | Daily eTenders snapshot cache |
| `003_email_subscriptions.sql` | User digest preferences (`min_score`, `frequency`) |
| `004_active_tenders.sql` | Fast-read active tenders table, populated by cron sync |
| `005_tender_sync_cursor.sql` | Resumable sync cursor for paginated OCDS ingestion |
| Static fallback | `src/etender/*.json` monthly snapshots — last-resort static data when the gov API and cache both fail |

**Data flow (Baseline):**
1. `services/tenderSync.js` pulls OCDS releases (paginated, cursor-tracked) → normalises → writes to `active_tenders`.
2. `enrichWithProvince()` derives missing `tender.province` from `buyer.name` heuristics (a data-quality patch for a gov API gap).
3. Frontend reads exclusively from the fast Supabase-backed `/api/active-tenders`, never the live gov API directly (isolates user experience from upstream instability).

**Target State:** Data architecture is **unchanged in shape** — this is the strongest argument for a low-risk migration: re-point the same Supabase schema (or a namespaced copy within Kumii's shared project) at the native module. Recommend **Supabase project consolidation** (single Kumii Supabase org/project, schema-per-domain) rather than one Supabase project per historic pilot.

### 4.2 Application Architecture (Baseline)

```
┌─────────────────────────────────────────────────────────┐
│ Frontend: React 19 SPA (Vite 7)                          │
│  App.jsx / Sidebar / TopNavbar / FilterBar / TenderCard   │
│  SmartMatchedTenders / PrivateTendersPage / MyTendersPage │
│  NISTComplianceIndicator                                  │
└───────────────┬───────────────────────────────────────────┘
                │ Axios (REST)
┌───────────────▼───────────────────────────────────────────┐
│ Backend: Express 5 (server/index.js)                      │
│  /api/tenders            (live OCDS proxy, cascading      │
│                            date-window fallback)           │
│  /api/active-tenders      (fast Supabase-cached read)      │
│  /api/active-tenders/sync (Vercel Cron / manual trigger)   │
│  /api/ai/*                 (OpenAI-backed matching)         │
│  /api/ai/audit/*            (threat summary, anomaly,      │
│                               compliance report)            │
│  /api/tenders (docs)        (mammoth/pdf-parse extraction)  │
│  /api/email/*                (subscriptions + digests)      │
│  /admin/audit-logs           (ingestion + health + stats)   │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────┐
│ Supabase (Postgres) + OpenAI GPT-4o-mini + Resend (email)  │
│ National Treasury OCDS API (external, unreliable)           │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Application Architecture (Target — Greenfield on kumii.africa)

- **Frontend module**: React components ported into the `kumii.africa` frontend's module/route structure (e.g., `apps/kumii-web/modules/access-to-market/`), consuming the **shared Kumii auth context** directly (no `useKumiiAuth` postMessage hook required — replace with native `useAuth()`/session context already used by the host).
- **Backend services**: Express routes re-hosted either as (a) additional routes on the Kumii platform's existing backend, or (b) retained as an internal microservice reachable only via the platform's internal network / API gateway — **not directly internet-exposed with `cors: origin: '*'`** as today.
- **AI services**: `routes/ai.js` and `routes/auditAI.js` logic retained; recommend routing through a **shared Kumii AI gateway** if one exists, for centralized cost/rate governance across modules (currently each pilot module independently manages its own OpenAI key/budget).
- **Cron/scheduling**: `node-cron` in-process scheduling (which the code itself documents as **non-functional on Vercel serverless**) is replaced by Kumii's **platform-level cron infrastructure** (Vercel Cron Jobs already used for `active-tenders/sync`; email digest cron should follow the same externally-triggered pattern rather than relying on a persistent Node process).

### 4.4 Integration Architecture — Removal of the iFrame Boundary

**Current pattern (to be retired 7 September):**
- Host (`kumii.africa`) renders `<iframe src="https://module.vercel.app">`.
- Auth token bridged via `postMessage` envelope: `{ type, ...payload }`.
- Message catalogue: `REQUEST_AUTH_TOKEN`, `KUMII_AUTH_TOKEN`, `OPEN_DOCUMENT`, `NAVIGATE_TO_PROFILE`, `NAVIGATE_TO_TENDERS`.
- Documented in `KUMII-IFRAME-INTEGRATION-GUIDE.md` — **this guide becomes historical/reference-only post-migration**, retained for institutional memory but no longer an active integration pattern.

**Target pattern:**
- Module is compiled/bundled as part of the host application (or federated at build-time, not runtime, if a micro-frontend approach such as Module Federation is adopted).
- Auth is the host's existing Supabase session — no cross-origin handshake, no "waiting for authentication" UX state, no `X-Frame-Options`/CSP frame-ancestors configuration to maintain.
- Navigation (`NAVIGATE_TO_PROFILE`, `NAVIGATE_TO_TENDERS`) becomes direct calls to the shared router (`react-router` / Next.js router) already present in the host.
- Document opening (`OPEN_DOCUMENT`) becomes a direct `window.open()` call — the parent-mediation was only ever necessary because the iframe's popup/download behaviour is otherwise constrained by the host's CSP/sandbox attributes.

---

## 5. Phase D — Technology Architecture

### 5.1 Baseline Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, Vite 7 |
| Backend runtime | Node.js, Express 5 |
| Data platform | Supabase (Postgres + Auth) |
| AI | OpenAI GPT-4o-mini |
| Email | Resend |
| Hosting | Vercel (frontend + serverless functions), Vercel Cron Jobs |
| Document parsing | `mammoth` (docx), `pdf-parse` (pdf) |
| Security middleware | `express-rate-limit`, CORS (currently permissive `origin: '*'`) |
| Client-side cache | `idb` (IndexedDB) for offline/local caching |

### 5.2 Target Technology Stack
No wholesale technology replacement is warranted — the stack is modern and fit for purpose. Target-state technology changes are **consolidation, not replacement**:

| Change | Rationale |
|---|---|
| Merge Supabase projects (or apply strict schema namespacing) | Single data plane for platform, reduces ops overhead |
| Replace permissive CORS (`origin: '*'`) with host-origin allowlist, or remove CORS layer entirely (same-origin once natively hosted) | Removes an explicitly flagged security gap (`⚠️ WARNING` comment already in code) |
| Consolidate cron triggers under one Vercel Cron configuration (`vercel.json`) at the platform level | Avoids the documented Vercel/node-cron incompatibility being solved twice |
| Centralize rate limiting at API gateway/edge if the Kumii platform has one | Reduces per-module boilerplate (`middleware/rateLimiters.js`) |
| Retain OpenAI GPT-4o-mini integration, but centralize key management/budget via platform secrets management | Cost governance across all AI-enabled modules |

### 5.3 Non-Functional / Resilience Architecture (Retained Unchanged)
The Baseline's most valuable engineering asset is its **resilience pattern for the unreliable OCDS gov API**, which should be preserved verbatim in the Target State:
1. Cascading date-window retry (`today → 2 days → 3 days → 7 days`) to cope with slow/unstable upstream responses.
2. Fast-read Supabase cache (`/api/active-tenders`) decouples user experience entirely from upstream latency.
3. Static JSON snapshot fallback (`src/etender/*.json`) as a last-resort degradation path when both live API and cache are unavailable.

This three-tier degradation strategy (Live → Cache → Static Snapshot) should be formally adopted as a **reusable Kumii platform resilience pattern**, applicable to other modules with flaky upstream dependencies.

### 5.4 Security & Compliance Architecture
- NIST AI RMF playbook (`nist_ai_rmf_playbook.json`) and associated indicators (`NISTComplianceIndicator.jsx`) demonstrate an existing AI governance capability — carry this forward as a **platform-wide AI governance standard**, not a Market-Access-specific feature.
- Audit logging (`/admin/audit-logs`, ISO 27001 / NIST SP 800-53 / OWASP aligned) should become the **canonical audit ingestion path for all Kumii modules** post-migration, rather than each module maintaining its own audit receiver.
- `trust proxy` handling for Vercel's `X-Forwarded-For` header (already correctly implemented) should be retained as-is when re-hosted.

---

## 6. Phase E — Opportunities & Solutions

### 6.1 Gap Analysis Summary

| Gap | Baseline | Target | Resolution |
|---|---|---|---|
| G1 — Dual deployment lifecycle | Independent Vercel project | Single Kumii deployment pipeline | Fold Market Access into Kumii monorepo/CI |
| G2 — Cross-origin auth bridge | `postMessage` handshake | Native shared session | Remove `useKumiiAuth` hook; consume host auth context directly |
| G3 — Permissive CORS | `origin: '*'` | Same-origin / allowlisted | Remove or restrict CORS middleware |
| G4 — Fragmented cron/notification infra | Per-module `node-cron` (non-functional on Vercel) | Centralized Vercel Cron / platform scheduler | Migrate email + sync cron triggers to platform-level cron config |
| G5 — Duplicated audit ingestion | Module-local `/admin/audit-logs` | Platform-wide audit service | Market Access becomes a producer into shared audit pipeline |
| G6 — Multiple Supabase projects | Standalone project | Consolidated/namespaced schema | Data migration script + RLS policy review |
| G7 — Redundant UI chrome | Module's own `TopNavbar`/`Sidebar` inside iframe | Reuse host's navigation shell | Retire Market-Access-local nav components in favour of host nav |

### 6.2 Solution Building Blocks (Reusable As-Is)
These are **low-risk, high-value carry-overs** requiring no redesign:
- Tender sync service (`services/tenderSync.js`) and its cursor-based resumability.
- AI matching prompt/scoring logic (`routes/ai.js`, `AI-MATCHING.md`).
- Document extraction service (`routes/tenderDocs.js`).
- Three-tier resilience/fallback pattern (§5.3).
- Existing Supabase schema/migrations (`supabase-migrations/`).

---

## 7. Phase F — Migration Planning

### 7.1 Migration Approach
**Single hard-cutover**, not a phased parallel-run, in line with the fixed 7 September deprecation date and the principle of avoiding prolonged dual-maintenance (P4). Engineering leads own verification rigor internally per team directive; this plan governs **sequencing and go/no-go milestones only**.

### 7.2 Migration Work Packages

| WP | Description | Dependency |
|---|---|---|
| WP1 | Stand up Market Access module inside `kumii.africa` codebase (routing, components ported, shared auth context wired) | Host repo access + design system components |
| WP2 | Re-point backend routes (`/api/tenders`, `/api/active-tenders`, `/api/ai/*`, `/api/email/*`, `/admin/audit-logs`, tender-docs) into platform backend or internal service mesh | WP1 |
| WP3 | Supabase consolidation — migrate/replicate schema (5 migration files) into shared project; validate RLS | Independent, can run in parallel with WP1 |
| WP4 | Cron consolidation — port `active-tenders/sync` and email digest triggers into platform Vercel Cron config | WP2 |
| WP5 | Remove iframe embed + `postMessage` bridge code from host shell | WP1, WP2 complete |
| WP6 | Decommission standalone Vercel deployment + old Supabase project (post-cutover cleanup) | WP5 |

### 7.3 Indicative Cutover Timeline (Compressed — Deadline-Driven)

| Date | Milestone |
|---|---|
| Now → T-3 days | WP1–WP4 development complete; engineering-led internal verification (per team's own process) |
| T-1 day (Sun 6 Sept) | Final data sync validation, DNS/routing cutover rehearsal, rollback plan confirmed |
| **Mon 7 Sept** | **Cutover**: iframe removed from `kumii.africa`; native module goes live; old Vercel iframe target decommissioned or redirected |
| Post-cutover | WP6 cleanup; retire `KUMII-IFRAME-INTEGRATION-GUIDE.md` pattern to historical reference status |

### 7.4 Contingency (If Native Build Is Not Fully Ready by 7 Sept)
Given the hard deprecation date is business-mandated, if WP1–WP4 are not fully complete:
- **Preferred fallback**: ship the core capability slice only (public + private tender discovery, auth via native session) natively, with AI-matching/audit-intelligence enhancements following in a fast-follow release — rather than delaying the cutover itself.
- **Avoid**: extending the iframe's life past 7 September, as this contradicts the stated architectural forcing function and re-introduces the security/UX debt this migration is designed to remove.

### 7.5 Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Supabase schema divergence during consolidation | Data inconsistency | Freeze schema changes on legacy project during migration window; single migration script, applied once |
| OpenAI key/quota duplication post-merge | Cost overrun | Migrate to platform-managed secret before cutover, not after |
| Loss of resilience pattern (§5.3) during re-hosting | User-facing outages if gov API fails | Explicitly port the cascading-fallback logic verbatim; do not "simplify" during migration |
| Audit trail continuity gap during cutover | Compliance gap for the cutover window | Run audit ingestion endpoint in read-compatible mode until platform-wide audit service fully absorbs it |

---

## 8. Governance & Ownership Post-Migration

| Architecture Domain | Owner (Target State) |
|---|---|
| Business capability (tender discovery, matching) | Market Access product/engineering team |
| Shared auth/session | Kumii Platform team |
| Data platform (Supabase) | Kumii Platform team (shared), Market Access (schema steward) |
| AI governance (NIST RMF alignment) | Platform-wide Compliance/EA function, informed by Market Access as first adopter |
| Audit ingestion pipeline | Kumii Platform team (accountable), Market Access (responsible, as event producer) |
| Cron/scheduling infrastructure | Kumii Platform team |

---

## Appendix A — Reference Documents Consulted
- `README.md`, `package.json`
- `KUMII-IFRAME-INTEGRATION-GUIDE.md` (integration baseline reference)
- `AI-MATCHING.md`, `AI-KEYWORD-OPTIMIZATION.md`
- `NIST-AI-IMPLEMENTATION.md`, `NIST-IMPLEMENTATION-COMPLETE.md`, `NIST-QUICK-REFERENCE.md`, `nist_ai_rmf_playbook.json`
- `AUDIT-LOGGING-IMPLEMENTATION.md`, `AUDIT-SCHEMA-FIXED.md`
- `RATE-LIMITING-GUIDE.md`, `RATE-LIMITING-COMPLETE.md`
- `server/index.js`, `server/services/tenderSync.js`, `server/routes/*.js`, `server/middleware/rateLimiters.js`
- `supabase-migrations/*.sql`
- `vercel.json`, `vite.config.js`

## Appendix B — Glossary
- **OCDS**: Open Contracting Data Standard — the schema National Treasury's eTenders API exposes releases in.
- **RLS**: Row-Level Security (Postgres/Supabase access control).
- **ADM**: TOGAF Architecture Development Method.
- **NIST AI RMF**: NIST AI Risk Management Framework.
