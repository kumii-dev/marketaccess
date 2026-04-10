import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import './TenderResponseModal.css';

// ── Collapsible Section ───────────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`trm-section${open ? ' trm-section--open' : ''}`}>
      <button className="trm-section-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="trm-section-icon">{icon}</span>
        <span className="trm-section-title">{title}</span>
        <span className="trm-section-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="trm-section-body">{children}</div>}
    </div>
  );
}

// ── Compliance badge ──────────────────────────────────────────────
function ComplianceBadge({ status }) {
  const map = {
    compliant: { label: 'Compliant', cls: 'trm-badge--compliant' },
    partial:   { label: 'Partial',   cls: 'trm-badge--partial' },
    gap:       { label: 'Gap',       cls: 'trm-badge--gap' },
  };
  const { label, cls } = map[status] || map.partial;
  return <span className={`trm-badge ${cls}`}>{label}</span>;
}

/**
 * TenderResponseModal
 *
 * Props:
 *   tender      — raw OCDS tender object
 *   draft       — { executiveSummary, companyOverview, technicalApproach, teamCapability,
 *                   pricingNarrative, complianceItems, keyRequirements, riskFlags, strengths }
 *   meta        — { tokensUsed, durationMs, documentAnalyzed, model }
 *   userProfile — { email, id, ... }
 *   onClose     — () => void
 *   onSaved     — () => void
 */
export default function TenderResponseModal({ tender, draft, meta, userProfile, onClose, onSaved }) {
  const [status, setStatus] = useState('draft');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!draft) return null;

  // ── Tender metadata ───────────────────────────────────────────
  const ocid        = tender?.ocid || '';
  const title       = tender?.tender?.title || tender?.title || 'Untitled Tender';
  const buyer       = tender?.buyer?.name || tender?.organOfState || '';
  const closingDate = tender?.tender?.tenderPeriod?.endDate || tender?.closingDate || '';
  const category    = tender?.tender?.mainProcurementCategory || tender?.category || '';
  const tenderRef   = tender?.tender?.id || tender?.tenderRef || ocid;

  // ── Save to Supabase ──────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId    = session?.user?.id    || userProfile?.id    || 'anonymous';
      const userEmail = session?.user?.email || userProfile?.email || '';

      const row = {
        user_id:           userId,
        user_email:        userEmail,
        tender_id:         ocid || tenderRef || title.slice(0, 80),
        tender_title:      title,
        tender_ref:        tenderRef,
        organ_of_state:    buyer,
        closing_date:      closingDate,
        category,
        status,
        executive_summary: draft.executiveSummary || '',
        company_overview:  draft.companyOverview  || '',
        technical_approach:draft.technicalApproach|| '',
        team_capability:   draft.teamCapability   || '',
        pricing_narrative: draft.pricingNarrative || '',
        compliance_items:  draft.complianceItems  || [],
        key_requirements:  draft.keyRequirements  || [],
        document_analyzed: !!(meta?.documentAnalyzed),
        tokens_used:       meta?.tokensUsed || null,
        model:             meta?.model || 'gpt-4o-mini',
        updated_at:        new Date().toISOString(),
      };

      const { error } = await supabase
        .from('tender_responses')
        .upsert(row, { onConflict: 'user_id,tender_id' });

      if (error) throw error;
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setSaveError(err.message || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Copy all to clipboard ─────────────────────────────────────
  function handleCopyAll() {
    const text = [
      `TENDER: ${title}`,
      `ORGAN OF STATE: ${buyer}`,
      `CLOSING DATE: ${closingDate}`,
      '',
      '── EXECUTIVE SUMMARY ──',
      draft.executiveSummary || '',
      '',
      '── COMPANY OVERVIEW ──',
      draft.companyOverview || '',
      '',
      '── TECHNICAL APPROACH ──',
      draft.technicalApproach || '',
      '',
      '── TEAM & CAPABILITY ──',
      draft.teamCapability || '',
      '',
      '── PRICING NARRATIVE ──',
      draft.pricingNarrative || '',
      '',
      '── KEY REQUIREMENTS ──',
      (draft.keyRequirements || []).map(r => `• ${r}`).join('\n'),
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hasRiskFlags = Array.isArray(draft.riskFlags) && draft.riskFlags.length > 0;

  return (
    <div className="trm-overlay" role="dialog" aria-modal="true" aria-label="Draft Tender Response">
      <div className="trm-modal">
        {/* Header */}
        <div className="trm-header">
          <div className="trm-header-left">
            <span className="trm-header-icon">✍</span>
            <div>
              <h2 className="trm-title">Draft Tender Response</h2>
              <p className="trm-subtitle">{title}</p>
            </div>
          </div>
          <button className="trm-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Meta strip */}
        <div className="trm-meta-strip">
          {buyer && <span className="trm-meta-chip">🏛 {buyer}</span>}
          {closingDate && <span className="trm-meta-chip">📅 {closingDate.split('T')[0]}</span>}
          {meta?.documentAnalyzed && <span className="trm-meta-chip trm-meta-chip--green">📄 Doc Analysed</span>}
          {meta?.tokensUsed && <span className="trm-meta-chip">🔢 {meta.tokensUsed} tokens</span>}
        </div>

        {/* Risk flags */}
        {hasRiskFlags && (
          <div className="trm-risk-banner">
            <span className="trm-risk-icon">⚠️</span>
            <div>
              <strong>Risk Flags</strong>
              <ul className="trm-risk-list">
                {draft.riskFlags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="trm-body">
          <CollapsibleSection title="Executive Summary" icon="📋">
            <p>{draft.executiveSummary || '—'}</p>
          </CollapsibleSection>

          <CollapsibleSection title="Company Overview" icon="🏢" defaultOpen={false}>
            <p>{draft.companyOverview || '—'}</p>
          </CollapsibleSection>

          <CollapsibleSection title="Technical Approach" icon="🔧" defaultOpen={false}>
            <p>{draft.technicalApproach || '—'}</p>
          </CollapsibleSection>

          <CollapsibleSection title="Team & Capability" icon="👥" defaultOpen={false}>
            <p>{draft.teamCapability || '—'}</p>
          </CollapsibleSection>

          <CollapsibleSection title="Pricing Narrative" icon="💰" defaultOpen={false}>
            <p>{draft.pricingNarrative || '—'}</p>
          </CollapsibleSection>

          {Array.isArray(draft.complianceItems) && draft.complianceItems.length > 0 && (
            <CollapsibleSection title="Compliance Checklist" icon="✅" defaultOpen={false}>
              <ul className="trm-compliance-list">
                {draft.complianceItems.map((item, i) => (
                  <li key={i} className="trm-compliance-item">
                    <ComplianceBadge status={item.status} />
                    <span className="trm-compliance-label">{item.item}</span>
                    {item.note && <span className="trm-compliance-note">{item.note}</span>}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

          {Array.isArray(draft.strengths) && draft.strengths.length > 0 && (
            <CollapsibleSection title="Strengths to Highlight" icon="⭐" defaultOpen={false}>
              <ul className="trm-strengths-list">
                {draft.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </CollapsibleSection>
          )}
        </div>

        {/* Footer */}
        <div className="trm-footer">
          <div className="trm-footer-left">
            <label className="trm-status-label">Status:</label>
            <select
              className="trm-status-select"
              value={status}
              onChange={e => setStatus(e.target.value)}
              disabled={saving}
            >
              <option value="draft">Draft</option>
              <option value="in_progress">In Progress</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>
          <div className="trm-footer-right">
            <button className="trm-btn trm-btn-ghost" onClick={handleCopyAll}>
              {copied ? '✅ Copied!' : '📋 Copy All'}
            </button>
            <button
              className="trm-btn trm-btn-primary"
              onClick={handleSave}
              disabled={saving || saved}
            >
              {saving ? 'Saving…' : saved ? '✅ Saved!' : '💾 Save Draft'}
            </button>
          </div>
        </div>
        {saveError && <p className="trm-save-error">{saveError}</p>}
      </div>
    </div>
  );
}
