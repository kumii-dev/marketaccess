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

export default function MyTendersPage({ onBack }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [filter, setFilter]       = useState('all');
  const [deleting, setDeleting]   = useState(null); // id of row being deleted
  const [openDraft, setOpenDraft] = useState(null);  // { row } to reopen modal

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
        <h1 className="mtp-title">My Tender Drafts</h1>
        <p className="mtp-subtitle">Your saved AI-drafted tender responses</p>
      </div>

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
          {filtered.map(row => (
            <div key={row.id} className="mtp-card">
              <div className="mtp-card-header">
                <StatusBadge status={row.status} />
                {row.document_analyzed && (
                  <span className="mtp-doc-badge">Doc Analysed</span>
                )}
              </div>

              <h3 className="mtp-card-title">{row.tender_title}</h3>

              {row.organ_of_state && (
                <p className="mtp-card-buyer">{row.organ_of_state}</p>
              )}

              {row.closing_date && (
                <p className="mtp-card-date">Closing: {row.closing_date.split('T')[0]}</p>
              )}

              {row.executive_summary && (
                <p className="mtp-card-excerpt">
                  {row.executive_summary.substring(0, 160)}{row.executive_summary.length > 160 ? '…' : ''}
                </p>
              )}

              <p className="mtp-card-meta">
                Last updated {formatDate(row.updated_at)}
                {row.tokens_used ? ` · ${row.tokens_used} tokens` : ''}
              </p>

      <div className="mtp-card-actions">
                <button
                  className="mtp-btn mtp-btn-primary"
                  onClick={() => setOpenDraft({ row })}
                >
                  Open Draft
                </button>
                <button
                  className="mtp-btn mtp-btn-danger"
                  onClick={() => handleDelete(row)}
                  disabled={deleting === row.id}
                >
                  {deleting === row.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
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
