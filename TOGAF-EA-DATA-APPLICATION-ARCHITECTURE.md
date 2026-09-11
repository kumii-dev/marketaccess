# Enterprise Architecture Document — Market Access Platform
### TOGAF ADM-Aligned Architecture Definition Document (ADD) — Extended Volume
### Emphasis: Data Architecture (Phase C1) & Application Architecture (Phase C2)

| Field | Value |
|---|---|
| Document Owner | Enterprise Architecture Function, Kumii |
| System Name | Market Access ("marketaccess") |
| Parent Platform | Kumii Africa (`www.kumii.africa`) |
| Document Status | Baseline (Current State) + Target State Vision — **Extended Volume** |
| Companion Document | `TOGAF-EA-DOCUMENT.md` (Business Architecture-led volume) |
| TOGAF Phases Covered (this volume) | Phase C — Data Architecture, Phase C — Application Architecture, Phase D (technology dependencies only where they bound data/application decisions) |
| Key Milestone | **iFrame embedding deprecated Monday, 7 September** — superseded by native greenfield build on `kumii.africa` |
| Date | 1 September 2026 |
| Classification | Internal — Engineering & Enterprise Architecture Stakeholders |

---

## 0. Purpose & Relationship to the Business Architecture Volume

This document is the **deep-dive companion** to the previously issued Business Architecture-led ADD. Where that document established *why* the migration matters and *what* business capability is affected, this volume specifies **exactly what data structures, application components, service contracts, and integration seams exist today**, and precisely how each is re-platformed in the greenfield build on `kumii.africa`.

As directed, this document **does not define test cycles, UAT windows, or acceptance-testing gates** — the engineering team owns verification. This document's job is to make the *system of record*, the *component inventory*, and the *migration mapping* unambiguous enough that engineering can plan its own test strategy against it.

---

## 1. Data Architecture (TOGAF Phase C — Data)

### 1.1 Data Architecture Principles

| # | Principle | Rationale |
|---|---|---|
| D1 | Supabase Postgres is the single system-of-record | No shadow stores; IndexedDB/localStorage are caches only, never authoritative |
| D2 | Writes to sync/operational tables are `service_role`-only | User clients can never directly mutate background-synced data (`active_tenders`, `tender_sync_cursor`) — enforced via RLS `USING (false)` / absence of INSERT/UPDATE/DELETE policies |
| D3 | All user-scoped tables carry RLS keyed on `auth.uid()` | Zero-trust data access — no reliance on application-layer filtering alone |
| D4 | External data is normalised at ingestion, not at read-time | Province inference, date parsing, etc. happen once during sync, not on every page load |
| D5 | Every cache has an explicit TTL and a documented invalidation trigger | Prevents silent staleness (a failure mode this codebase has already encountered and documented — see §1.5) |

### 1.2 Entity Inventory (Current State)

| Entity / Table | Migration File | Cardinality (approx.) | System Role |
|---|---|---|---|
| `tender_cache` | `001_cache_tables.sql` | 1 row per user × search key | Cross-device sync cache of gov tender search results, 24h TTL |
| `ai_keyword_cache` | `001_cache_tables.sql` | 1 row per user × profile hash | Avoids duplicate OpenAI keyword-extraction calls, 1h TTL |
| *(additional Phase-2 cache tables)* | `001_cache_tables.sql` (315 lines — truncated in this excerpt) | — | Further caching structures for Phase 2 rollout (see `SUPABASE-CACHING-STRATEGY.md`, `PHASE2-MAIN-TENDERS-IMPLEMENTATION.md`) |
| `etender_daily_cache` | `002_etender_daily_cache.sql` | 1 row per day | Daily snapshot cache layer, complements `active_tenders` |
| `email_subscriptions` | `003_email_subscriptions.sql` | 1 row per user (UNIQUE `user_id`) | Digest preferences: `frequency` (daily/weekly), `min_score` (0–100, default 40), `enabled`, `last_sent_at` |
| `active_tenders` | `004_active_tenders.sql` | ~1,900–2,000 rows (all currently-open tenders) | **Primary read model** for the frontend — fast, pre-filtered, service-role-written |
| `tender_sync_cursor` | `005_tender_sync_cursor.sql` | 1 row (singleton, `id=1`) | Resumable pagination state for chunked OCDS ingestion |
| `audit_logs` | `supabase/migrations/create_audit_logs_schema.sql` | High-volume, append-only | Compliance event store (ISO 27001 / NIST SP 800-53 / OWASP-aligned) |
| `tender_responses` | `supabase/migrations/create_tender_responses.sql` | 1 row per user response/application | Tracks SME applications/responses to tenders (feeds `MyTendersPage`) |
| Static JSON snapshots | `src/etender/01042025.json` … `01112025.json` (8 monthly files) | ~1 file/month | **Tier-3 fallback** — last-resort static dataset when both live API and Supabase cache are unavailable |

### 1.3 Key Entity Detail — `active_tenders` (System-of-Record for Discovery)

```sql
CREATE TABLE active_tenders (
  ocid            TEXT PRIMARY KEY,      -- OCDS contracting identifier (upsert key)
  release_id      TEXT,
  title           TEXT,
  buyer_name      TEXT,
  category        TEXT,
  province        TEXT,                  -- derived, not native to OCDS (see §1.4)
  status          TEXT NOT NULL DEFAULT 'active',
  closing_date    TIMESTAMPTZ,           -- drives expiry pruning
  published_date  TIMESTAMPTZ,
  release         JSONB NOT NULL,         -- full OCDS release payload (source of truth detail)
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes: closing_date, status, synced_at DESC
-- RLS: SELECT USING (true) for anon+authenticated; NO write policies (service_role only)
```

**Design commentary:**
- The table is deliberately a **hybrid relational/document model**: structured columns (`title`, `buyer_name`, `province`, `closing_date`) support fast filtering/sorting/indexing, while the full `release` JSONB column preserves the entire upstream OCDS object for completeness/audit/replay — a pragmatic pattern worth retaining in the greenfield build rather than fully normalising.
- **Storage budget is explicitly documented in-schema**: ~1–2k tenders × ~3KB ≈ 3–6MB JSONB — a useful capacity-planning artefact already present in the codebase.
- Data lifecycle is self-managing: each sync run both upserts open tenders and prunes rows whose `closing_date` has passed — there is no separate archival table; expired tenders are simply deleted (a Target-State candidate improvement is discussed in §1.7).

### 1.4 Data Quality / Enrichment Layer — Province Inference

The upstream National Treasury OCDS API **does not expose a `tender.province` field**. `services/tenderSync.js` implements a **prefix-matching normalisation table** against `buyer.name` (e.g. `"Limpopo - Social Development"` → `"Limpopo"`), covering all 9 official SA provinces plus spelling variants (`"KwaZulu-Natal"`, `"Kwa-Zulu Natal"`, `"KwaZulu Natal"` all normalise to one canonical value). This enrichment happens **once, at ingestion** (`enrichWithProvince()` is also applied a second time to the live-proxy path and the static-fallback path in `server/index.js`, ensuring the derived field is consistently present regardless of which of the three resilience tiers served the data).

**Architectural significance:** this is a textbook example of a **data quality/enrichment pattern that must be ported verbatim** — it is not a UI concern, it is a data architecture concern, and any greenfield rewrite that "re-derives" province logic independently risks behavioural drift (e.g., missing a spelling variant).

### 1.5 Known Data Architecture Failure Mode (Documented In-Repo) & Its Resolution

The codebase contains an explicit, self-documented incident pattern:

> *On Vercel serverless, in-memory `node-cron` schedules never fire because functions are torn down between invocations. Left unaddressed, `active_tenders` silently goes stale — rows are never replenished, and the closing-date expiry filter progressively hides more tenders over time with no code changes.*

**Resolution already implemented (retain in Target State):**
- **Vercel Cron Jobs** (`vercel.json` `crons` array) hit `/api/active-tenders/sync` on a schedule (HTTP-triggered, not in-process).
- Because a full sweep (up to 50 pages × up to 2 min/page against the slow gov IIS server) cannot fit inside one function invocation, the sync is **chunked and resumable** via `tender_sync_cursor` (singleton row: `next_page`, `pages_done`, `is_complete`, `date_from`/`date_to` window).
- Successive scheduled invocations pick up where the last left off, converging toward full coverage across several runs rather than requiring one giant request.

This is a **first-class Target-State data architecture pattern** — "cursor-based resumable ingestion for time-boxed serverless execution" — and should be documented as a **reusable Kumii platform pattern** for any other module that syncs from a slow/paginated upstream source.

### 1.6 Data Flow Diagram (Baseline)

```
National Treasury OCDS API (external, slow/unreliable, ~1,944 open tenders)
        │  paginated GET, cursor-resumable, 180-day lookback window
        ▼
services/tenderSync.js  (fetchOpenReleasesFromApi → syncActiveTenders)
        │  enrichWithProvince() applied per-release
        │  chunked UPSERT (batches of 500) keyed on `ocid`
        ▼
Supabase: active_tenders (service_role writes only)
        │  pruneExpiredTenders() deletes closing_date < now, same run
        ▼
GET /api/active-tenders  (RLS: anon/auth SELECT true)
        │  Cache-Control: public, max-age=600, stale-while-revalidate=3600
        ▼
Frontend (React) — TenderCard / FilterBar / Pagination
```

Parallel/independent flows:
```
User profile/bio → ai_keyword_cache (1h TTL) → OpenAI GPT-4o-mini → SmartMatchedTenders
User search → tender_cache (24h TTL, per user+cache_key) → cross-device sync
All app events → audit_logs (append-only, service_role write) → auditAI.js analysis
email_subscriptions (enabled, frequency) → node-cron/Vercel-cron digest dispatch → Resend
```

### 1.7 Data Architecture Gaps & Target-State Recommendations

| Gap | Baseline | Target Recommendation |
|---|---|---|
| Multiple, possibly-divergent Supabase projects across Kumii pilot modules | Market Access has its own Supabase project | Consolidate into one Kumii Supabase org/project; adopt **schema-per-domain** (e.g. `market_access.*` schema namespace) rather than a flat public schema shared across unrelated modules |
| No archival of expired tenders | `pruneExpiredTenders()` hard-deletes | Consider an `active_tenders_archive` table (or a `status='expired'` soft-delete column with a longer-lived partition) if historical tender analytics ever become a business requirement — currently no such requirement exists, so this is optional, not urgent |
| Cache table proliferation (`tender_cache`, `ai_keyword_cache`, `etender_daily_cache`, IndexedDB `tenderCacheDB.js`) | Multiple overlapping cache layers evolved incrementally across phases | Rationalise into a single caching strategy document + implementation during the greenfield rebuild — audit `SUPABASE-CACHING-STRATEGY.md` and `PHASE2-*` docs for redundant layers before porting all of them 1:1 |
| RLS policy pattern is inconsistent in strictness (`USING (true)` for public tender data vs `USING (false)` for cursor state vs `auth.uid()`-scoped for user tables) | Correct today, but implicit/undocumented as a *pattern* | Formalise as a named RLS classification standard (Public-Read / Service-Only / User-Scoped) applied consistently platform-wide |

---

## 2. Application Architecture (TOGAF Phase C — Application)

### 2.1 Application Component Inventory (Baseline)

#### 2.1.1 Frontend Components (`src/components/`)

| Component | Responsibility |
|---|---|
| `App.jsx` / `main.jsx` | Root composition, routing/shell |
| `TopNavbar.jsx`, `Sidebar.jsx` | Navigation chrome (**candidate for retirement** — replaced by host's shared nav in Target State) |
| `FilterBar.jsx` | Search/filter controls for tender discovery |
| `TenderCard.jsx`, `Pagination.jsx` | Tender list rendering + pagination |
| `TenderDetailsModal.jsx`, `TenderResponseModal.jsx` | Tender detail view + application/response capture (writes to `tender_responses`) |
| `AddTenderModal.jsx`, `PrivateTendersPage.jsx` | Private/SME-sourced tender CRUD |
| `MyTendersPage.jsx` | Applicant's tracked tenders/responses workspace |
| `SmartMatchedTenders.jsx` | AI-matching UI — consumes `/api/ai/*`, renders confidence/reasons/concerns |
| `NISTComplianceIndicator.jsx` | Visual compliance/governance indicator, tied to NIST AI RMF playbook |
| `LoadingSpinner.jsx`, `ErrorMessage.jsx` | Cross-cutting UX states |

#### 2.1.2 Frontend Support Layer (`src/lib/`, `src/hooks/`, `src/utils/`)

| File | Responsibility |
|---|---|
| `lib/api.js` | Axios client wrapper — all backend calls funnel through here |
| `lib/supabase.js` | Supabase client init (anon key, browser-side) |
| `lib/supabaseAudit.js` | Client-side audit event capture, batched to `/admin/audit-logs` |
| `lib/mockData.js` | Local dev/demo fixture data |
| `hooks/useEmailSubscription.js` | Digest preference state management hook |
| `utils/tenderCache.js`, `utils/tenderCacheDB.js` | Client-side caching — `tenderCacheDB.js` specifically wraps **IndexedDB via `idb`** for offline/local persistence |
| `utils/supabaseCache.js` | Bridges local cache with the Supabase `tender_cache` table (cross-device sync) |
| `utils/etenderDailyCache.js` | Client-side handling of the daily cache tier |
| `utils/openaiService.js` | Client-side helper around AI endpoints (prompt shaping before calling `/api/ai/*`) |
| `utils/aiSecurityControls.js` | Client-side enforcement aligned to NIST AI RMF (input validation/sanitisation before AI calls) |
| `utils/__tests__/` | Existing test scaffolding (left to engineering's own discretion per current directive) |

#### 2.1.3 Backend Services (`server/`)

| Module | Responsibility | Key NFRs Implemented |
|---|---|---|
| `index.js` | Express app bootstrap, CORS, route mounting, `/api/tenders` live-proxy with cascading fallback, cron scheduling guard (`process.env.VERCEL`) | Resilience (3-tier fallback), `trust proxy` correctness for Vercel |
| `services/tenderSync.js` (514 lines) | OCDS ingestion, province enrichment, cursor-resumable pagination, upsert/prune | Chunked/resumable execution within serverless time-boxing |
| `routes/ai.js` (680 lines) | `/api/ai/*` — keyword extraction, tender-match analysis, portfolio summary; server-side-only OpenAI key handling | OWASP API8 (key never reaches browser), rate-limited (`aiEndpointLimiter`, `keywordExtractionLimiter`, `tenderAnalysisLimiter`, `batchOperationLimiter`) |
| `routes/auditAI.js` | AI-driven audit intelligence: threat summary, anomaly detection, compliance report generation over `audit_logs` | Compliance automation |
| `routes/audit.js` (267 lines) | `/admin/audit-logs` ingestion — validates category/level/result enums server-side, batches up to 100 entries/request, service-role writes | ISO 27001 A.12.4.1, NIST SP 800-53 AU-2/AU-3/AU-6/AU-9/AU-12, OWASP Logging Cheat Sheet, GDPR Art. 30, POPIA §51 |
| `routes/tenderDocs.js` | Server-side document fetch + text extraction (`mammoth` for docx, `pdf-parse` for PDF) | Offloads parsing from client, normalises document formats for AI analysis |
| `routes/email.js` | Subscription CRUD + `dispatchDigest()` — queried against `email_subscriptions`, sends via Resend | Digest cadence logic (daily 07:00 SAST / weekly Monday 07:00 SAST) |
| `middleware/rateLimiters.js` | Central definition of all rate-limit tiers (general API, AI endpoints, keyword extraction, tender analysis, batch ops, auth) | OWASP API4 (Unrestricted Resource Consumption) |

### 2.2 Application Architecture Diagram — Component-Level (Baseline)

```
┌───────────────────────────── FRONTEND (React 19 / Vite 7) ─────────────────────────────┐
│ App.jsx ── TopNavbar / Sidebar (chrome)                                                  │
│   ├─ FilterBar → TenderCard[] → Pagination        (public tender discovery)              │
│   ├─ PrivateTendersPage → AddTenderModal          (private tender CRUD)                  │
│   ├─ SmartMatchedTenders                          (AI matching UI)                       │
│   ├─ MyTendersPage → TenderResponseModal          (applicant workspace)                  │
│   └─ NISTComplianceIndicator                       (governance UX)                        │
│                                                                                            │
│ lib/api.js (Axios) ── lib/supabase.js ── lib/supabaseAudit.js                             │
│ utils/{tenderCache, tenderCacheDB(idb), supabaseCache, etenderDailyCache}                  │
│ utils/{openaiService, aiSecurityControls}                                                  │
│ hooks/useEmailSubscription                                                                 │
└───────────────────────────────────────┬──────────────────────────────────────────────────┘
                                         │ REST (Axios)
┌───────────────────────────────────────▼──────────────────────────────────────────────────┐
│ BACKEND (Express 5 — server/index.js)                                                      │
│  ├─ /api/tenders                (live OCDS proxy, cascading date-window fallback)          │
│  ├─ /api/active-tenders(/status/sync)  (fast Supabase read + resumable background sync)     │
│  ├─ /api/ai/*                   (routes/ai.js — matching, keyword extraction)               │
│  ├─ /api/ai/audit/*             (routes/auditAI.js — threat/anomaly/compliance)             │
│  ├─ /api/tenders (docs)         (routes/tenderDocs.js — mammoth/pdf-parse)                  │
│  ├─ /api/email/*                (routes/email.js — subs + digest dispatch)                 │
│  └─ /admin/audit-logs           (routes/audit.js — ingestion/health/stats)                  │
│  middleware/rateLimiters.js applied across all of the above                                 │
└───────────────────────────────────────┬──────────────────────────────────────────────────┘
                                         │
┌───────────────────────────────────────▼──────────────────────────────────────────────────┐
│ EXTERNAL SYSTEMS: Supabase (Postgres+Auth) · OpenAI GPT-4o-mini · Resend · OCDS gov API     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Application Interaction Patterns Worth Preserving

1. **Server-side-only secret handling** — `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` never leave `server/`; all privileged writes (sync, audit ingestion) go through lazily-instantiated admin clients (`getSupabaseAdmin()` / `getAdmin()`), deliberately deferred past module-load time to avoid `FUNCTION_INVOCATION_FAILED` on Vercel when env vars aren't yet available during ESM import — a subtle but important serverless-correctness pattern to retain.
2. **Layered rate limiting** — a single `middleware/rateLimiters.js` module defines distinct limiter instances per endpoint class (general/AI/keyword/analysis/batch/auth), applied via `router.use()` at the top of each route file rather than ad hoc per-handler — a clean separation to preserve.
3. **Batch validation before persistence** — `routes/audit.js`'s `sanitiseEntry()` enforces enum membership (`VALID_CATEGORIES`, `VALID_LEVELS`, `VALID_RESULTS`) and batch-size caps (`MAX_BATCH_SIZE = 100`) **before** any Supabase write — defense-in-depth beyond DB constraints alone.

### 2.4 Application Architecture — Target State (Native Module on `kumii.africa`)

| Baseline Component | Target-State Disposition |
|---|---|
| `TopNavbar.jsx`, `Sidebar.jsx` | **Retire** — replaced by host's shared navigation shell |
| `lib/supabase.js` (standalone client init) | **Replace** with the host's already-initialised Supabase client instance (single client per browser session, not one per module) |
| All `server/routes/*.js` | **Rehost** as additional route modules on the Kumii platform backend, or as internally-reachable services — Express `Router()` objects are trivially mountable into a larger Express (or compatible) app with minimal change |
| `middleware/rateLimiters.js` | Retain as-is initially; evaluate migration to platform-level API gateway rate limiting as a fast-follow, not a blocker |
| `services/tenderSync.js` + `tender_sync_cursor` | **Port verbatim** — this is upstream-integration logic, entirely decoupled from the iframe/hosting question |
| `routes/audit.js` / `routes/auditAI.js` | Target as the **seed of a platform-wide audit ingestion service** — other Kumii modules should eventually POST into the same `/admin/audit-logs` contract rather than each building their own |
| `useKumiiAuth` postMessage hook (documented in the companion iframe guide) | **Delete entirely** — replaced by direct consumption of the host's native auth/session context |
| `lib/supabaseAudit.js`, `utils/aiSecurityControls.js`, `utils/openaiService.js` | Port as-is; these are UI-layer concerns independent of hosting model |

### 2.5 API Contract Continuity

To minimize blast radius during the hard cutover (7 September), the **recommended approach is contract preservation**: the native module should expose the *same* REST paths and payload shapes (`/api/active-tenders`, `/api/ai/match-analysis`, `/admin/audit-logs`, etc.) even if mounted under a different base path within the host (e.g. `kumii.africa/api/market-access/...`). This allows the frontend components to port with **only an Axios `baseURL` change**, not a rewrite of every call site in `lib/api.js`.

### 2.6 Application Architecture Gaps & Target-State Recommendations

| Gap | Baseline | Target Recommendation |
|---|---|---|
| No API versioning scheme | Routes are unversioned (`/api/tenders`, not `/api/v1/tenders`) | Introduce versioning when rehosting, to allow the platform to evolve the contract without breaking other Kumii modules that may eventually consume it |
| CORS fully open (`origin: '*'`) | Documented in-code as a known `⚠️ WARNING` | Remove entirely once same-origin (native hosting eliminates the need for cross-origin calls) |
| No API gateway / centralized auth middleware on Express routes | `routes/ai.js` comment explicitly flags `API2: Broken Authentication ⏳ (TODO: JWT)` | Native hosting inherits the platform's existing authenticated-request middleware — this TODO is resolved *by the migration itself*, not by new code |
| Duplicate rate-limiting infrastructure across modules (assumption, pending platform audit) | Each pilot module (Market Access, likely Learning Hub) maintains its own `express-rate-limit` config | Candidate for shared platform middleware — flagged as an opportunity, not a blocker, in Phase E of the companion document |

---

## 3. Cross-Reference: Data ↔ Application Traceability Matrix

| Application Component | Reads From | Writes To |
|---|---|---|
| `FilterBar` / `TenderCard` / `Pagination` | `active_tenders` (via `/api/active-tenders`) | — |
| `routes/tenderSync` (background) | OCDS API, `tender_sync_cursor` | `active_tenders`, `tender_sync_cursor` |
| `SmartMatchedTenders` / `routes/ai.js` | `active_tenders`, `ai_keyword_cache` | `ai_keyword_cache`, `audit_logs` (cost/usage events) |
| `PrivateTendersPage` / `AddTenderModal` | private tenders table(s) | private tenders table(s) |
| `MyTendersPage` / `TenderResponseModal` | `tender_responses` | `tender_responses` |
| `useEmailSubscription` hook / `routes/email.js` | `email_subscriptions` | `email_subscriptions` (CRUD), `last_sent_at` update post-dispatch |
| `lib/supabaseAudit.js` / `routes/audit.js` | — | `audit_logs` |
| `routes/auditAI.js` | `audit_logs` | (read-only analysis; no writes) |
| `utils/tenderCacheDB.js` (IndexedDB) | Browser-local only | Browser-local only (not server-visible) |
| `utils/supabaseCache.js` | `tender_cache` | `tender_cache` |

This matrix should be treated as the **authoritative migration checklist** — every row must have a confirmed Target-State equivalent before the 7 September cutover is declared complete.

---

## 4. Summary of Migration-Critical Data & Application Decisions

1. **Port, don't rewrite**, the ingestion/resilience/enrichment logic in `tenderSync.js` and the 3-tier fallback in `index.js` — this is the platform's most battle-tested code and carries no iframe dependency.
2. **Consolidate Supabase** into one Kumii project with schema namespacing rather than maintaining a second project indefinitely.
3. **Preserve REST contract shapes** so frontend componentry ports with minimal call-site changes — only the Axios `baseURL` and auth-token acquisition method change.
4. **Delete the `postMessage` auth bridge and its message catalogue entirely** — it has no Target-State equivalent and should not be "kept just in case."
5. **Treat `/admin/audit-logs` as the seed of a platform-wide service**, not a Market-Access-only endpoint, going forward.

No test-cycle, UAT, or acceptance-window guidance is prescribed in this document, per engineering leadership's directive — the above is architecture and data/component mapping guidance only.
