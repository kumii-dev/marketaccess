import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import TenderResponseModal from './TenderResponseModal';
import { useEmailSubscription } from '../hooks/useEmailSubscription';
import './MyTendersPage.css';

const STATUS_LABELS = {
  draft:       { label: 'Draft',       cls: 'mtp-badge--draft' },
  in_progress: { label: 'In Progress', cls: 'mtp-badge--progress' },
  submitted:   { label: 'Submitted',   cls: 'mtp-badge--submitted' },
};

function StatusBadge({ status }) {
  const { label, cls } = STATUS_LABELS[status] || STATUS_LABELS.draft;
  return <span className={`mtp-badge ${cls}`}>{label}</span>;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Days remaining until a closing date. Returns null if no date. */
function daysRemaining(dateStr) {
  if (!dateStr) return null;
  try {
    const diff = new Date(dateStr) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

/** Urgency colour class based on days remaining */
function urgencyClass(days) {
  if (days === null) return '';
  if (days < 0)  return 'mtp-urgency--expired';
  if (days <= 3) return 'mtp-urgency--critical';
  if (days <= 7) return 'mtp-urgency--warning';
  return 'mtp-urgency--ok';
}

/** % of AI draft sections that are non-empty */
function draftCompleteness(row) {
  const sections = [
    row.executive_summary,
    row.company_overview,
    row.technical_approach,
    row.team_capability,
    row.pricing_narrative,
  ];
  const jsonSections = [
    Array.isArray(row.compliance_items) ? row.compliance_items : [],
    Array.isArray(row.key_requirements)  ? row.key_requirements  : [],
  ];
  const filled = sections.filter(s => s && s.trim().length > 0).length
               + jsonSections.filter(a => a.length > 0).length;
  return Math.round((filled / (sections.length + jsonSections.length)) * 100);
}

export default function MyTendersPage({ onBack }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [filter, setFilter]       = useState('all');
  const [deleting, setDeleting]   = useState(null);
  const [openDraft, setOpenDraft] = useState(null);

  // ── Profile context from SmartMatchedTenders data ─────────────────────────
  // Reads the same ai_keyword_cache that SmartMatchedTenders writes to, giving
  // MyTendersPage awareness of what keywords are driving the user's matches.
  const [profileCtx, setProfileCtx] = useState({
    displayName: '',
    companyName: '',
    keywords: [],     // from ai_keyword_cache — same keywords used for matching
    keywordsLoaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadProfileCtx() {
      try {
        // Get user from session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const displayName = user.user_metadata?.full_name
          || user.user_metadata?.name
          || user.email?.split('@')[0]
          || '';
        const companyName = user.user_metadata?.company_name || '';

        if (!cancelled) setProfileCtx(p => ({ ...p, displayName, companyName }));

        // Pull AI keywords from the cache SmartMatchedTenders wrote
        const { data: cache } = await supabase
          .from('ai_keyword_cache')
          .select('keywords')
          .eq('user_id', user.id)
          .order('last_used_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!cancelled && cache?.keywords?.length) {
          setProfileCtx(p => ({
            ...p,
            keywords: cache.keywords.slice(0, 12), // cap at 12 pills
            keywordsLoaded: true,
          }));
        } else if (!cancelled) {
          setProfileCtx(p => ({ ...p, keywordsLoaded: true }));
        }
      } catch { /* non-fatal */ }
    }

    loadProfileCtx();
    return () => { cancelled = true; };
  }, []);

  // ── Email subscription ────────────────────────────────────────────────────
  const {
    subscription, loading: subLoading, saving: subSaving,
    testSending, error: subError, successMsg,
    save: saveSub, unsubscribe, sendTest,
  } = useEmailSubscription();

  // Local form state for the email panel — seeded from subscription once loaded
  const [userEmail, setUserEmail]   = useState('');
  const [frequency, setFrequency]   = useState('weekly');
  const [minScore, setMinScore]     = useState(40);
  const [subEnabled, setSubEnabled] = useState(true);

  // Seed form from loaded subscription
  useEffect(() => {
    if (subscription) {
      setUserEmail(subscription.email   || '');
      setFrequency(subscription.frequency || 'weekly');
      setMinScore(subscription.min_score  ?? 40);
      setSubEnabled(subscription.enabled ?? true);
    } else if (!subLoading) {
      // Not subscribed yet — pre-fill email from Supabase session
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.email) setUserEmail(session.user.email);
      });
    }
  }, [subscription, subLoading]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('tender_responses')
        .select('*')
        .order('updated_at', { ascending: false });
      if (dbErr) throw dbErr;
      setRows(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load saved drafts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter);

  async function handleDelete(row) {
    if (!window.confirm(`Delete draft for "${row.tender_title}"?`)) return;
    setDeleting(row.id);
    const { error: dbErr } = await supabase
      .from('tender_responses')
      .delete()
      .eq('id', row.id);
    if (dbErr) {
      alert('Delete failed: ' + dbErr.message);
    } else {
      setRows(prev => prev.filter(r => r.id !== row.id));
    }
    setDeleting(null);
  }

  // Reconstruct a minimal tender object for the modal
  function rowToTender(row) {
    return {
      ocid: row.tender_id,
      buyer: { name: row.organ_of_state || '' },
      tender: {
        title: row.tender_title,
        id: row.tender_ref || row.tender_id,
        tenderPeriod: { endDate: row.closing_date },
        mainProcurementCategory: row.category,
      }
    };
  }

  function rowToDraft(row) {
    return {
      executiveSummary:  row.executive_summary || '',
      companyOverview:   row.company_overview  || '',
      technicalApproach: row.technical_approach|| '',
      teamCapability:    row.team_capability   || '',
      pricingNarrative:  row.pricing_narrative || '',
      complianceItems:   row.compliance_items  || [],
      keyRequirements:   row.key_requirements  || [],
      riskFlags:         [],
      strengths:         [],
    };
  }

  return (
    <div className="mtp-page">
      {/* Page header */}
      <div className="mtp-header">
        <button className="mtp-back-btn" onClick={onBack}>
          <i className="bi bi-arrow-left"></i> Back
        </button>
        <div className="mtp-header-row">
          <div>
            <h1 className="mtp-title">
              My Tender Drafts
              {profileCtx.companyName && (
                <span className="mtp-title-company"> · {profileCtx.companyName}</span>
              )}
            </h1>
            <p className="mtp-subtitle">
              {profileCtx.displayName
                ? `${profileCtx.displayName}'s AI-drafted tender responses`
                : 'Your saved AI-drafted tender responses'}
            </p>
          </div>
          {rows.length > 0 && (
            <div className="mtp-header-stats">
              <div className="mtp-stat">
                <span className="mtp-stat__value">{rows.length}</span>
                <span className="mtp-stat__label">Total</span>
              </div>
              <div className="mtp-stat">
                <span className="mtp-stat__value">
                  {rows.filter(r => r.status === 'submitted').length}
                </span>
                <span className="mtp-stat__label">Submitted</span>
              </div>
              <div className="mtp-stat">
                <span className="mtp-stat__value">
                  {rows.filter(r => {
                    const d = daysRemaining(r.closing_date);
                    return d !== null && d >= 0 && d <= 7;
                  }).length}
                </span>
                <span className="mtp-stat__label">Closing Soon</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Active match keywords from SmartMatchedTenders AI cache ───────── */}
      {profileCtx.keywords.length > 0 && (
        <div className="mtp-keywords-banner">
          <span className="mtp-keywords-banner__label">
            <i className="bi bi-cpu"></i> Active match keywords
          </span>
          <div className="mtp-keywords-banner__pills">
            {profileCtx.keywords.map((kw, i) => (
              <span key={i} className="mtp-kw-pill">{kw}</span>
            ))}
          </div>
          <span className="mtp-keywords-banner__hint">
            These keywords drive your Smart Match scores
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div className="mtp-filter-bar">
        {['all', 'draft', 'in_progress', 'submitted'].map(f => (
          <button
            key={f}
            className={`mtp-filter-btn${filter === f ? ' mtp-filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : STATUS_LABELS[f]?.label}
            {f === 'all'
              ? <span className="mtp-filter-count">{rows.length}</span>
              : <span className="mtp-filter-count">{rows.filter(r => r.status === f).length}</span>
            }
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="mtp-loading">
          <span className="mtp-spinner" />
          <span>Loading drafts…</span>
        </div>
      )}

      {error && (
        <div className="mtp-error">
          <p><i className="bi bi-exclamation-triangle-fill"></i> {error}</p>
          <button className="mtp-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="mtp-empty">
          <span className="mtp-empty-icon"><i className="bi bi-file-earmark-text" style={{ fontSize: '48px', color: '#94a3b8' }}></i></span>
          <p className="mtp-empty-text">
            {filter === 'all'
              ? 'No saved drafts yet. Click "Draft Tender Response" on any tender to get started.'
              : `No drafts with status "${STATUS_LABELS[filter]?.label || filter}".`}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="mtp-grid">
          {filtered.map(row => {
            const days       = daysRemaining(row.closing_date);
            const urgCls     = urgencyClass(days);
            const completePct = draftCompleteness(row);
            const hasScore   = row.match_percentage != null;

            return (
            <div key={row.id} className="mtp-card">
              <div className="mtp-card-header">
                <StatusBadge status={row.status} />
                {row.document_analyzed && (
                  <span className="mtp-doc-badge">Doc Analysed</span>
                )}
                {/* Match % badge — data from SmartMatchedTenders scoring */}
                {hasScore && (
                  <span className={`mtp-match-badge ${row.match_percentage >= 70 ? 'mtp-match-badge--high' : row.match_percentage >= 40 ? 'mtp-match-badge--mid' : 'mtp-match-badge--low'}`}>
                    {row.match_percentage}% match
                  </span>
                )}
              </div>

              <h3 className="mtp-card-title">{row.tender_title}</h3>

              {row.organ_of_state && (
                <p className="mtp-card-buyer">
                  <i className="bi bi-building"></i> {row.organ_of_state}
                </p>
              )}

              {/* Closing date with urgency chip */}
              {row.closing_date && (
                <p className={`mtp-card-date ${urgCls}`}>
                  {days === null ? null
                    : days < 0  ? <><i className="bi bi-x-circle-fill"></i> Expired</>
                    : days === 0 ? <><i className="bi bi-exclamation-circle-fill"></i> Closes today!</>
                    : days <= 3 ? <><i className="bi bi-exclamation-triangle-fill"></i> {days}d left</>
                    : days <= 7 ? <><i className="bi bi-clock-fill"></i> {days}d left</>
                    : <><i className="bi bi-calendar3"></i> {days}d left</>
                  }
                  <span className="mtp-card-date__raw">
                    &nbsp;· {row.closing_date.split('T')[0]}
                  </span>
                </p>
              )}

              {/* Draft completeness progress bar */}
              <div className="mtp-completeness">
                <div className="mtp-completeness__bar">
                  <div
                    className="mtp-completeness__fill"
                    style={{ width: `${completePct}%` }}
                  />
                </div>
                <span className="mtp-completeness__label">{completePct}% complete</span>
              </div>

              {row.executive_summary && (
                <p className="mtp-card-excerpt">
                  {row.executive_summary.substring(0, 140)}{row.executive_summary.length > 140 ? '…' : ''}
                </p>
              )}

              <p className="mtp-card-meta">
                Updated {formatDate(row.updated_at)}
                {row.tokens_used ? ` · ${row.tokens_used.toLocaleString()} tokens` : ''}
              </p>

              <div className="mtp-card-actions">
                <button
                  className="mtp-btn mtp-btn-primary"
                  onClick={() => setOpenDraft({ row })}
                >
                  <i className="bi bi-pencil-square"></i> Open Draft
                </button>
                <button
                  className="mtp-btn mtp-btn-danger"
                  onClick={() => handleDelete(row)}
                  disabled={deleting === row.id}
                >
                  {deleting === row.id ? 'Deleting…' : <><i className="bi bi-trash3"></i> Delete</>}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Reopen modal — passes rowId + initialStatus for targeted UPDATE */}
      {openDraft && (
        <TenderResponseModal
          tender={rowToTender(openDraft.row)}
          draft={rowToDraft(openDraft.row)}
          meta={{ tokensUsed: openDraft.row.tokens_used, model: openDraft.row.model, documentAnalyzed: openDraft.row.document_analyzed }}
          rowId={openDraft.row.id}
          initialStatus={openDraft.row.status}
          userProfile={null}
          onClose={() => setOpenDraft(null)}
          onSaved={() => { load(); }}
        />
      )}

      {/* ── Email Alerts Panel ────────────────────────────────────────── */}
      <div className="mtp-email-panel">
        <div className="mtp-email-panel__header">
          <i className="bi bi-envelope-check"></i>
          <div>
            <h2 className="mtp-email-panel__title">Smart Match Email Alerts</h2>
            <p className="mtp-email-panel__subtitle">
              Receive a digest of tenders matched above your score threshold, delivered on your schedule.
            </p>
          </div>
        </div>

        {subLoading ? (
          <div className="mtp-loading" style={{ padding: '24px 0' }}>
            <span className="mtp-spinner" /> <span>Loading preferences…</span>
          </div>
        ) : (
          <form
            className="mtp-email-form"
            onSubmit={e => {
              e.preventDefault();
              saveSub({ email: userEmail, frequency, minScore, enabled: subEnabled });
            }}
          >
            {/* Enable toggle */}
            <div className="mtp-email-row mtp-email-row--toggle">
              <label className="mtp-email-label" htmlFor="sub-enabled">
                Enable email alerts
              </label>
              <button
                type="button"
                id="sub-enabled"
                role="switch"
                aria-checked={subEnabled}
                className={`mtp-toggle${subEnabled ? ' mtp-toggle--on' : ''}`}
                onClick={() => setSubEnabled(v => !v)}
              >
                <span className="mtp-toggle__thumb" />
              </button>
            </div>

            {/* Email address */}
            <div className="mtp-email-row">
              <label className="mtp-email-label" htmlFor="sub-email">Deliver to</label>
              <input
                id="sub-email"
                type="email"
                className="mtp-email-input"
                value={userEmail}
                onChange={e => setUserEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={!subEnabled}
              />
            </div>

            {/* Frequency */}
            <div className="mtp-email-row">
              <label className="mtp-email-label">Frequency</label>
              <div className="mtp-freq-group">
                {[
                  { value: 'daily',  label: 'Daily',  desc: 'Every morning at 7 am' },
                  { value: 'weekly', label: 'Weekly', desc: 'Every Monday at 7 am'  },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`mtp-freq-btn${frequency === opt.value ? ' mtp-freq-btn--active' : ''}`}
                    onClick={() => setFrequency(opt.value)}
                    disabled={!subEnabled}
                  >
                    <span className="mtp-freq-btn__label">{opt.label}</span>
                    <span className="mtp-freq-btn__desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Minimum score */}
            <div className="mtp-email-row">
              <label className="mtp-email-label" htmlFor="sub-score">
                Minimum match score
                <span className="mtp-score-badge">{minScore}%</span>
              </label>
              {profileCtx.keywords.length > 0 && (
                <p className="mtp-score-context">
                  <i className="bi bi-info-circle"></i> Based on your{' '}
                  <strong>{profileCtx.keywords.length} active keywords</strong>,
                  tenders scored {minScore}%+ are strong profile matches.
                </p>
              )}
              <div className="mtp-score-slider-wrap">
                <input
                  id="sub-score"
                  type="range"
                  min="10" max="90" step="5"
                  value={minScore}
                  onChange={e => setMinScore(Number(e.target.value))}
                  className="mtp-score-slider"
                  disabled={!subEnabled}
                />
                <div className="mtp-score-ticks">
                  {[10, 25, 40, 55, 70, 90].map(v => (
                    <span key={v} style={{ left: `${((v - 10) / 80) * 100}%` }}>{v}%</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Feedback messages */}
            {subError && (
              <p className="mtp-email-msg mtp-email-msg--error">
                <i className="bi bi-exclamation-triangle-fill"></i> {subError}
              </p>
            )}
            {successMsg && (
              <p className="mtp-email-msg mtp-email-msg--success">
                {successMsg}
              </p>
            )}

            {/* Actions */}
            <div className="mtp-email-actions">
              <button
                type="submit"
                className="mtp-btn mtp-btn-primary"
                disabled={subSaving}
                style={{ minWidth: 140 }}
              >
                {subSaving ? 'Saving…' : subscription ? 'Update Preferences' : 'Subscribe'}
              </button>

              <button
                type="button"
                className="mtp-btn mtp-btn-secondary"
                disabled={testSending || !userEmail}
                onClick={() => sendTest({ email: userEmail, minScore, frequency })}
                title="Send a test digest to your email now"
              >
                {testSending ? (
                  <><span className="mtp-spinner mtp-spinner--sm" /> Sending…</>
                ) : (
                  <><i className="bi bi-send"></i> Send Now</>
                )}
              </button>

              {subscription?.enabled && (
                <button
                  type="button"
                  className="mtp-btn mtp-btn-ghost"
                  onClick={unsubscribe}
                  disabled={subSaving}
                >
                  Unsubscribe
                </button>
              )}
            </div>

            {subscription?.last_sent_at && (
              <p className="mtp-email-last-sent">
                <i className="bi bi-clock"></i> Last digest sent: {formatDate(subscription.last_sent_at)}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
