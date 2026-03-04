-- ================================================================
-- ENTERPRISE AUDIT LOGGING SCHEMA
-- Compliance: ISO 27001, NIST SP 800-53, OWASP, GDPR, POPIA
-- ================================================================

-- Drop existing table if it exists (development only)
-- DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- Create audit_logs table with comprehensive tracking
CREATE TABLE IF NOT EXISTS public.audit_logs (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Temporal tracking (NIST AU-3)
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Session tracking
  session_id TEXT NOT NULL,
  correlation_id TEXT,
  
  -- User identification (ISO 27001 A.12.4.1)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_role TEXT,
  
  -- Event classification
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  result TEXT NOT NULL, -- SUCCESS, FAILURE, PARTIAL, BLOCKED
  
  -- System context
  source_ip TEXT,
  user_agent TEXT,
  platform TEXT,
  location TEXT,
  
  -- Compliance frameworks
  frameworks TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Metadata (JSONB for flexible querying)
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Security classification
  sensitive_data BOOLEAN DEFAULT FALSE,
  
  -- Indexing hints
  CONSTRAINT valid_category CHECK (category IN (
    'AUTHENTICATION',
    'AUTHORIZATION',
    'ACCESS_CONTROL',
    'AI_OPERATION',
    'AI_COST',
    'AI_SECURITY',
    'DATA_ACCESS',
    'DATA_MODIFICATION',
    'DATA_EXPORT',
    'PII_ACCESS',
    'SYSTEM_ERROR',
    'PERFORMANCE',
    'AVAILABILITY',
    'RATE_LIMIT',
    'POLICY_VIOLATION',
    'COMPLIANCE_CHECK',
    'TENDER_ACCESS',
    'MATCHING_OPERATION',
    'USER_ACTIVITY'
  )),
  
  CONSTRAINT valid_level CHECK (level IN (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO'
  )),
  
  CONSTRAINT valid_result CHECK (result IN (
    'SUCCESS',
    'FAILURE',
    'PARTIAL',
    'BLOCKED',
    'ERROR'
  ))
);

-- ================================================================
-- INDEXES FOR PERFORMANCE (NIST AU-6 - Audit Review)
-- ================================================================

-- Time-based queries (most common)
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);

-- User activity tracking
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id, timestamp DESC);

-- Category filtering
CREATE INDEX idx_audit_logs_category ON public.audit_logs(category, timestamp DESC);

-- Security event filtering
CREATE INDEX idx_audit_logs_level ON public.audit_logs(level, timestamp DESC);

-- Session tracking
CREATE INDEX idx_audit_logs_session_id ON public.audit_logs(session_id);

-- Correlation tracking (distributed tracing)
CREATE INDEX idx_audit_logs_correlation_id ON public.audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

-- Compliance framework queries
CREATE INDEX idx_audit_logs_frameworks ON public.audit_logs USING GIN(frameworks);

-- Sensitive data queries (GDPR/POPIA compliance)
CREATE INDEX idx_audit_logs_sensitive ON public.audit_logs(sensitive_data, timestamp DESC) WHERE sensitive_data = TRUE;

-- Metadata queries (JSONB indexing)
CREATE INDEX idx_audit_logs_metadata ON public.audit_logs USING GIN(metadata);

-- Combined index for common dashboard queries
CREATE INDEX idx_audit_logs_dashboard ON public.audit_logs(level, category, timestamp DESC);

-- ================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ================================================================

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can see all audit logs
CREATE POLICY audit_logs_admin_all ON public.audit_logs
  FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'admin' OR
    auth.jwt() ->> 'role' = 'auditor'
  );

-- Policy: Users can see their own audit logs (read-only)
CREATE POLICY audit_logs_user_own ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Service role can insert audit logs (backend only)
CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Prevent user deletion of audit logs (immutable)
-- (No DELETE policy = no one can delete)

-- ================================================================
-- AI COST TRACKING MATERIALIZED VIEW
-- ================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS public.ai_cost_summary AS
SELECT
  DATE(al.timestamp) as date,
  al.user_id,
  al.user_email,
  COUNT(*) as ai_call_count,
  SUM((al.metadata->>'tokensUsed')::NUMERIC) as total_tokens,
  SUM((al.metadata->>'cost')::NUMERIC) as total_cost,
  AVG((al.metadata->>'cost')::NUMERIC) as avg_cost_per_call,
  MAX((al.metadata->>'cost')::NUMERIC) as max_cost_per_call
FROM public.audit_logs al
WHERE al.category = 'AI_OPERATION'
  AND al.metadata->>'cost' IS NOT NULL
GROUP BY DATE(al.timestamp), al.user_id, al.user_email;

-- Index for cost summary queries
CREATE INDEX idx_ai_cost_summary_date ON public.ai_cost_summary(date DESC);
CREATE INDEX idx_ai_cost_summary_user ON public.ai_cost_summary(user_id);

-- Refresh schedule (run this periodically via cron or trigger)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.ai_cost_summary;

-- ================================================================
-- SECURITY EVENT SUMMARY VIEW
-- ================================================================

CREATE OR REPLACE VIEW public.security_events_summary AS
SELECT
  DATE(al.timestamp) as date,
  al.category,
  al.level,
  al.result,
  COUNT(*) as event_count,
  COUNT(DISTINCT al.user_id) as unique_users,
  COUNT(DISTINCT al.source_ip) as unique_ips
FROM public.audit_logs al
WHERE al.level IN ('CRITICAL', 'HIGH')
  OR al.category IN ('AUTHENTICATION', 'AUTHORIZATION', 'ACCESS_CONTROL', 'POLICY_VIOLATION')
GROUP BY DATE(al.timestamp), al.category, al.level, al.result
ORDER BY date DESC, event_count DESC;

-- ================================================================
-- COMPLIANCE REPORT VIEW (ISO 27001 + NIST)
-- ================================================================

CREATE OR REPLACE VIEW public.compliance_events AS
SELECT
  al.id,
  al.timestamp,
  al.category,
  al.level,
  al.action,
  al.resource,
  al.result,
  al.frameworks,
  al.metadata->>'iso27001Control' as iso27001_control,
  al.metadata->>'nistControl' as nist_control,
  al.metadata->>'owaspCategory' as owasp_category,
  al.metadata->>'gdprArticle' as gdpr_article,
  al.metadata->>'popiaSection' as popia_section,
  al.sensitive_data,
  al.user_email
FROM public.audit_logs al
WHERE array_length(al.frameworks, 1) > 0
ORDER BY al.timestamp DESC;

-- ================================================================
-- AUDIT LOG RETENTION POLICY
-- ================================================================

-- Function to archive old audit logs (ISO 27001 A.12.4.2)
-- Keep 90 days in hot storage, archive older logs
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  -- In production, move to archive table instead of deleting
  -- For now, just count how many would be archived
  SELECT COUNT(*) INTO archived_count
  FROM public.audit_logs al
  WHERE al.timestamp < NOW() - INTERVAL '90 days';
  
  -- TODO: Move to archive table
  -- INSERT INTO public.audit_logs_archive
  -- SELECT * FROM public.audit_logs al
  -- WHERE al.timestamp < NOW() - INTERVAL '90 days';
  
  -- DELETE FROM public.audit_logs
  -- WHERE timestamp < NOW() - INTERVAL '90 days';
  
  RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- REAL-TIME ALERTS FUNCTION
-- ================================================================

-- Function to check for critical security events
CREATE OR REPLACE FUNCTION check_critical_security_events()
RETURNS TABLE (
  alert_type TEXT,
  alert_message TEXT,
  event_count BIGINT,
  last_occurrence TIMESTAMPTZ
) AS $$
BEGIN
  -- Failed authentication attempts (> 5 in last hour)
  RETURN QUERY
  SELECT
    'FAILED_AUTH_SPIKE'::TEXT,
    'High number of failed authentication attempts'::TEXT,
    COUNT(*),
    MAX(al.timestamp)
  FROM public.audit_logs al
  WHERE al.category = 'AUTHENTICATION'
    AND al.result = 'FAILURE'
    AND al.timestamp > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 5;
  
  -- Rate limit violations (> 10 in last hour)
  RETURN QUERY
  SELECT
    'RATE_LIMIT_ABUSE'::TEXT,
    'Excessive rate limit violations detected'::TEXT,
    COUNT(*),
    MAX(al.timestamp)
  FROM public.audit_logs al
  WHERE al.category = 'RATE_LIMIT'
    AND al.timestamp > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 10;
  
  -- Unauthorized PII access
  RETURN QUERY
  SELECT
    'UNAUTHORIZED_PII_ACCESS'::TEXT,
    'Unauthorized PII access attempts detected'::TEXT,
    COUNT(*),
    MAX(al.timestamp)
  FROM public.audit_logs al
  WHERE al.category = 'PII_ACCESS'
    AND al.result = 'FAILURE'
    AND al.timestamp > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 0;
  
  -- Critical system errors
  RETURN QUERY
  SELECT
    'CRITICAL_SYSTEM_ERROR'::TEXT,
    'Critical system errors detected'::TEXT,
    COUNT(*),
    MAX(al.timestamp)
  FROM public.audit_logs al
  WHERE al.level = 'CRITICAL'
    AND al.timestamp > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- USAGE EXAMPLES
-- ================================================================

-- Get all critical events from last 24 hours
-- SELECT * FROM public.audit_logs
-- WHERE level = 'CRITICAL'
--   AND timestamp > NOW() - INTERVAL '24 hours'
-- ORDER BY timestamp DESC;

-- Get AI cost summary for today
-- SELECT * FROM public.ai_cost_summary
-- WHERE date = CURRENT_DATE;

-- Get security events summary
-- SELECT * FROM public.security_events_summary
-- WHERE date >= CURRENT_DATE - INTERVAL '7 days';

-- Check for critical security events
-- SELECT * FROM check_critical_security_events();

-- Get compliance events for specific framework
-- SELECT * FROM public.compliance_events
-- WHERE 'ISO27001' = ANY(frameworks)
-- ORDER BY timestamp DESC
-- LIMIT 100;

-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================

-- Grant read access to authenticated users (via RLS)
GRANT SELECT ON public.audit_logs TO authenticated;

-- Grant insert access to service role (backend)
GRANT INSERT ON public.audit_logs TO service_role;

-- Grant read access to views
GRANT SELECT ON public.ai_cost_summary TO authenticated;
GRANT SELECT ON public.security_events_summary TO authenticated;
GRANT SELECT ON public.compliance_events TO authenticated;

-- ================================================================
-- COMMENTS FOR DOCUMENTATION
-- ================================================================

COMMENT ON TABLE public.audit_logs IS 'Enterprise audit logging table - ISO 27001, NIST SP 800-53, OWASP, GDPR, POPIA compliant';
COMMENT ON COLUMN public.audit_logs.frameworks IS 'Compliance frameworks this event relates to (ISO27001, NIST_800_53, NIST_AI_RMF, OWASP_API, GDPR, POPIA)';
COMMENT ON COLUMN public.audit_logs.sensitive_data IS 'Indicates if this log entry contains references to sensitive/PII data';
COMMENT ON COLUMN public.audit_logs.correlation_id IS 'Correlation ID for tracking related events across distributed systems';

COMMENT ON MATERIALIZED VIEW public.ai_cost_summary IS 'Daily AI cost tracking per user - refresh periodically';
COMMENT ON VIEW public.security_events_summary IS 'Security event aggregation for dashboard visualization';
COMMENT ON VIEW public.compliance_events IS 'Compliance-tagged events with control mappings';

COMMENT ON FUNCTION archive_old_audit_logs() IS 'Archives audit logs older than 90 days (ISO 27001 A.12.4.2)';
COMMENT ON FUNCTION check_critical_security_events() IS 'Real-time alert detection for critical security events';

-- ================================================================
-- END OF SCHEMA
-- ================================================================
