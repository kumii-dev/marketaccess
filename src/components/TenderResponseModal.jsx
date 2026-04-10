import React, { useState, useEffect } from 'react';
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

// ── Editable text field ───────────────────────────────────────────
function EditableText({ value, onChange, editMode, rows = 5, placeholder = '' }) {
  if (editMode) {
    return (
      <textarea
        className="trm-editable-textarea"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    );
  }
  return <p className="trm-read-text">{value || '—'}</p>;
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
 *   rowId       — existing Supabase row id (for updates from My Tenders page)
 *   initialStatus — pre-fill status when opening a saved draft
 *   onClose     — () => void
 *   onSaved     — () => void
 */
export default function TenderResponseModal({ tender, draft, meta, userProfile, rowId, initialStatus, onClose, onSaved }) {
  // ── Editable content state (mirrors draft prop) ───────────────
  const [fields, setFields] = useState({
    executiveSummary:  draft?.executiveSummary  || '',
    companyOverview:   draft?.companyOverview   || '',
    technicalApproach: draft?.technicalApproach || '',
    teamCapability:    draft?.teamCapability    || '',
    pricingNarrative:  draft?.pricingNarrative  || '',
  });
  const [status, setStatus]   = useState(initialStatus || 'draft');
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [copied, setCopied]   = useState(false);

  // Reset when draft prop changes (re-opened with different tender)
  useEffect(() => {
    setFields({
      executiveSummary:  draft?.executiveSummary  || '',
      companyOverview:   draft?.companyOverview   || '',
      technicalApproach: draft?.technicalApproach || '',
      teamCapability:    draft?.teamCapability    || '',
      pricingNarrative:  draft?.pricingNarrative  || '',
    });
    setStatus(initialStatus || 'draft');
    setDirty(false);
    setSaved(false);
    setSaveError(null);
    setEditMode(false);
  }, [draft, initialStatus]);

  if (!draft) return null;

  // ── Tender metadata ───────────────────────────────────────────
  const ocid        = tender?.ocid || '';
  const title       = tender?.tender?.title || tender?.title || 'Untitled Tender';
  const buyer       = tender?.buyer?.name || tender?.organOfState || '';
  const closingDate = tender?.tender?.tenderPeriod?.endDate || tender?.closingDate || '';
  const category    = tender?.tender?.mainProcurementCategory || tender?.category || '';
  const tenderRef   = tender?.tender?.id || tender?.tenderRef || ocid;

  function updateField(key, val) {
    setFields(prev => ({ ...prev, [key]: val }));
    setDirty(true);
    setSaved(false);
  }

  // ── Save / update to Supabase ─────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId    = session?.user?.id    || userProfile?.id    || 'anonymous';
      const userEmail = session?.user?.email || userProfile?.email || '';

      const payload = {
        user_id:            userId,
        user_email:         userEmail,
        tender_id:          ocid || tenderRef || title.slice(0, 80),
        tender_title:       title,
        tender_ref:         tenderRef,
        organ_of_state:     buyer,
        closing_date:       closingDate,
        category,
        status,
        executive_summary:  fields.executiveSummary,
        company_overview:   fields.companyOverview,
        technical_approach: fields.technicalApproach,
        team_capability:    fields.teamCapability,
        pricing_narrative:  fields.pricingNarrative,
        compliance_items:   draft.complianceItems  || [],
        key_requirements:   draft.keyRequirements  || [],
        document_analyzed:  !!(meta?.documentAnalyzed),
        tokens_used:        meta?.tokensUsed || null,
        model:              meta?.model || 'gpt-4o-mini',
        updated_at:         new Date().toISOString(),
      };

      let dbError;
      if (rowId) {
        // UPDATE existing row by primary key
        ({ error: dbError } = await supabase
          .from('tender_responses')
          .update(payload)
          .eq('id', rowId));
      } else {
        // INSERT or upsert (new draft from TenderCard)
        ({ error: dbError } = await supabase
          .from('tender_responses')
          .upsert(payload, { onConflict: 'user_id,tender_id' }));
      }

      if (dbError) throw dbError;
      setSaved(true);
      setDirty(false);
      setEditMode(false);
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
      fields.executiveSummary,
      '',
      '── COMPANY OVERVIEW ──',
      fields.companyOverview,
      '',
      '── TECHNICAL APPROACH ──',
      fields.technicalApproach,
      '',
      '── TEAM & CAPABILITY ──',
      fields.teamCapability,
      '',
      '── PRICING NARRATIVE ──',
      fields.pricingNarrative,
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
  const isExisting   = !!rowId; // opened from My Tenders (has a saved row)

  return (
    <div className="trm-overlay" role="dialog" aria-modal="true" aria-label="Draft Tender Response">
      <div className="trm-modal">
        {/* Header */}
        <div className="trm-header">
          <div className="trm-header-left">
            <span className="trm-header-icon">{editMode ? '✏️' : '✍'}</span>
            <div>
              <h2 className="trm-title">
                {isExisting ? (editMode ? 'Editing Draft' : 'Tender Response Draft') : 'Draft Tender Response'}
              </h2>
              <p className="trm-subtitle">{title}</p>
            </div>
          </div>
          <div className="trm-header-actions">
            {/* Edit / View toggle */}
            <button
              className={`trm-edit-toggle${editMode ? ' trm-edit-toggle--active' : ''}`}
              onClick={() => { setEditMode(e => !e); setSaved(false); }}
              title={editMode ? 'Switch to view mode' : 'Edit draft content'}
            >
              {editMode ? '👁 View' : '✏️ Edit'}
            </button>
            <button className="trm-close-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Meta strip */}
        <div className="trm-meta-strip">
          {buyer && <span className="trm-meta-chip">🏛 {buyer}</span>}
          {closingDate && <span className="trm-meta-chip">📅 {closingDate.split('T')[0]}</span>}
          {meta?.documentAnalyzed && <span className="trm-meta-chip trm-meta-chip--green">📄 Doc Analysed</span>}
          {meta?.tokensUsed && <span className="trm-meta-chip">🔢 {meta.tokensUsed} tokens</span>}
          {editMode && <span className="trm-meta-chip trm-meta-chip--edit">✏️ Editing</span>}
          {dirty && !saved && <span className="trm-meta-chip trm-meta-chip--dirty">● Unsaved changes</span>}
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
            <EditableText
              value={fields.executiveSummary}
              onChange={v => updateField('executiveSummary', v)}
              editMode={editMode}
              rows={6}
              placeholder="Write an executive summary for this tender response…"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Company Overview" icon="🏢" defaultOpen={false}>
            <EditableText
              value={fields.companyOverview}
              onChange={v => updateField('companyOverview', v)}
              editMode={editMode}
              rows={5}
              placeholder="Describe your company and its relevance to this tender…"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Technical Approach" icon="🔧" defaultOpen={false}>
            <EditableText
              value={fields.technicalApproach}
              onChange={v => updateField('technicalApproach', v)}
              editMode={editMode}
              rows={6}
              placeholder="Detail your technical methodology and approach…"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Team & Capability" icon="👥" defaultOpen={false}>
            <EditableText
              value={fields.teamCapability}
              onChange={v => updateField('teamCapability', v)}
              editMode={editMode}
              rows={5}
              placeholder="Describe your team's qualifications and experience…"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Pricing Narrative" icon="💰" defaultOpen={false}>
            <EditableText
              value={fields.pricingNarrative}
              onChange={v => updateField('pricingNarrative', v)}
              editMode={editMode}
              rows={4}
              placeholder="Explain your pricing structure and value proposition…"
            />
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

          {Array.isArray(draft.keyRequirements) && draft.keyRequirements.length > 0 && (
            <CollapsibleSection title="Key Requirements" icon="📌" defaultOpen={false}>
              <ul className="trm-strengths-list">
                {draft.keyRequirements.map((r, i) => <li key={i}>{r}</li>)}
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
              onChange={e => { setStatus(e.target.value); setDirty(true); setSaved(false); }}
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
              disabled={saving || (saved && !dirty)}
            >
              {saving ? 'Saving…' : saved ? '✅ Saved!' : isExisting ? '💾 Save Changes' : '💾 Save Draft'}
            </button>
          </div>
        </div>
        {saveError && <p className="trm-save-error">{saveError}</p>}
      </div>
    </div>
  );
}
