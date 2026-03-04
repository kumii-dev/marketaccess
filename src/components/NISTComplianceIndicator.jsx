import React, { useState } from 'react';
import { checkNISTCompliance } from '../utils/aiSecurityControls';
import './NISTComplianceIndicator.css';

/**
 * NIST AI RMF Compliance Indicator
 * Shows real-time compliance status for AI security controls
 */
const NISTComplianceIndicator = () => {
  const [expanded, setExpanded] = useState(false);

  // Check compliance once on mount
  const compliance = checkNISTCompliance();

  if (!compliance) {
    return null;
  }

  const getStatusColor = () => {
    if (compliance.complianceRate >= 90) return '#10b981'; // green
    if (compliance.complianceRate >= 70) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const getStatusIcon = () => {
    if (compliance.complianceRate >= 90) return '✅';
    if (compliance.complianceRate >= 70) return '⚠️';
    return '🔴';
  };

  return (
    <div className="nist-compliance-indicator">
      <button 
        className="nist-badge"
        onClick={() => setExpanded(!expanded)}
        style={{ borderColor: getStatusColor() }}
        title="Click to view NIST AI RMF compliance details"
      >
        <span className="nist-icon">{getStatusIcon()}</span>
        <span className="nist-label">NIST AI RMF</span>
        <span className="nist-score" style={{ color: getStatusColor() }}>
          {compliance.complianceRate}%
        </span>
      </button>

      {expanded && (
        <div className="nist-details-panel">
          <div className="nist-header">
            <h3>🔒 AI Security Controls</h3>
            <button 
              className="close-btn"
              onClick={() => setExpanded(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="nist-summary">
            <div className="compliance-ring">
              <svg viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="10"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={getStatusColor()}
                  strokeWidth="10"
                  strokeDasharray={`${compliance.complianceRate * 2.51} 251`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
                <text
                  x="50"
                  y="50"
                  textAnchor="middle"
                  dy="7"
                  fontSize="20"
                  fontWeight="bold"
                  fill={getStatusColor()}
                >
                  {compliance.complianceRate}%
                </text>
              </svg>
            </div>
            <div className="compliance-stats">
              <p className="compliance-status">
                {compliance.compliant ? (
                  <>✅ <strong>Fully Compliant</strong></>
                ) : (
                  <>⚠️ <strong>Partial Compliance</strong></>
                )}
              </p>
              <p className="compliance-checks">
                {compliance.passedChecks} / {compliance.totalChecks} checks passed
              </p>
            </div>
          </div>

          <div className="nist-functions">
            {Object.entries(compliance.functions).map(([key, func]) => (
              <div key={key} className="nist-function">
                <div className="function-header">
                  <h4>{key}</h4>
                  <span className="function-name">{func.name}</span>
                </div>
                <div className="function-checks">
                  {func.checks.map((check) => (
                    <div key={check.id} className="check-item">
                      <span className="check-status">
                        {check.status ? '✅' : '❌'}
                      </span>
                      <div className="check-details">
                        <span className="check-id">{check.id}</span>
                        <span className="check-description">{check.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {compliance.recommendations.length > 0 && (
            <div className="nist-recommendations">
              <h4>📋 Recommendations</h4>
              <ul>
                {compliance.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="nist-footer">
            <p>
              <strong>Framework:</strong> NIST AI Risk Management Framework (AI RMF 1.0)
            </p>
            <p>
              <strong>Playbook:</strong> See <code>nist_ai_rmf_playbook.json</code> for full implementation
            </p>
            <a 
              href="https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="nist-link"
            >
              View NIST AI RMF Documentation →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default NISTComplianceIndicator;
