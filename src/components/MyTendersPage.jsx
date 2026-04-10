import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import TenderResponseModal from './TenderResponseModal';
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
        <h1 className="mtp-title">📝 My Tender Drafts</h1>
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
          <p>⚠️ {error}</p>
          <button className="mtp-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="mtp-empty">
          <span className="mtp-empty-icon">📄</span>
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
                  <span className="mtp-doc-badge">📄 Doc Analysed</span>
                )}
              </div>

              <h3 className="mtp-card-title">{row.tender_title}</h3>

              {row.organ_of_state && (
                <p className="mtp-card-buyer">🏛 {row.organ_of_state}</p>
              )}

              {row.closing_date && (
                <p className="mtp-card-date">📅 Closing: {row.closing_date.split('T')[0]}</p>
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

      {/* Reopen modal */}
      {openDraft && (
        <TenderResponseModal
          tender={rowToTender(openDraft.row)}
          draft={rowToDraft(openDraft.row)}
          meta={{ tokensUsed: openDraft.row.tokens_used, model: openDraft.row.model, documentAnalyzed: openDraft.row.document_analyzed }}
          userProfile={null}
          onClose={() => setOpenDraft(null)}
          onSaved={() => { load(); setOpenDraft(null); }}
        />
      )}
    </div>
  );
}
