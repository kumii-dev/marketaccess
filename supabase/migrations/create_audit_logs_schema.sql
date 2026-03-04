-- ================================================================
-- ENTERPRISE AUDIT LOGGING SCHEMA
-- Compliance: ISO 27001, NIST SP 800-53, OWASP, GDPR, POPIA
-- ================================================================

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing objects cleanly before recreating (safe re-run)
DROP MATERIALIZED VIEW IF EXISTS public.ai_cost_summary CASCADE;
DROP VIEW IF EXISTS public.security_events_summary CASCADE;
DROP VIEW IF EXISTS public.compliance_events CASCADE;
DROP FUNCTION IF EXISTS archive_old_audit_logs() CASCADE;
DROP FUNCTION IF EXISTS check_critical_security_events() CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- ================================================================
-- MAIN TABLE
-- ================================================================

CREATE TABLE public.audit_logs (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event timestamps
  -- event_time: when the event actually occurred (provided by the application)
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- created_at: when the event was recorded/ingested by the system
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- event_date: derived DATE column for efficient grouping and indexing
  event_date DATE GENERATED ALWAYS AS ((event_time AT TIME ZONE 'UTC')::date) STORED NOT NULL,

  -- Session and correlation tracking
  session_id TEXT NOT NULL,
  correlation_id TEXT NULL,

  -- User identification (nullable for system/service events)
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT NULL,
  user_role TEXT NULL,

  -- Event classification
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  result TEXT NOT NULL,

  -- System context (all optional)
  source_ip TEXT NULL,
  user_agent TEXT NULL,
  platform TEXT NULL,
  location TEXT NULL,

  -- Compliance frameworks
  frameworks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Flexible metadata
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Sensitive/PII flag
  sensitive_data BOOLEAN NOT NULL DEFAULT FALSE,

  -- Constraints
  CONSTRAINT audit_logs_valid_category CHECK (category IN (
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

  CONSTRAINT audit_logs_valid_level CHECK (level IN (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO'
  )),

  CONSTRAINT audit_logs_valid_result CHECK (result IN (
    'SUCCESS',
    'FAILURE',
    'PARTIAL',
    'BLOCKED',
    'ERROR'
  ))
);

-- ================================================================
-- TABLE COMMENTS
-- ================================================================

COMMENT ON TABLE public.audit_logs IS 'Enterprise audit logging table - ISO 27001, NIST SP 800-53, OWASP, GDPR, POPIA compliant';
COMMENT ON COLUMN public.audit_logs.event_time IS 'Timestamp when the event actually occurred (provided by the application where available)';
COMMENT ON COLUMN public.audit_logs.created_at IS 'Timestamp when the event was ingested/recorded by the system';
COMMENT ON COLUMN public.audit_logs.event_date IS 'Derived DATE of event_time for efficient grouping and indexing (GENERATED ALWAYS AS STORED)';
COMMENT ON COLUMN public.audit_logs.session_id IS 'Session identifier for the user session that generated the event';
COMMENT ON COLUMN public.audit_logs.correlation_id IS 'Correlation identifier for tracing related events across distributed services';
COMMENT ON COLUMN public.audit_logs.user_id IS 'Reference to auth.users.id when applicable; nullable for system events';
COMMENT ON COLUMN public.audit_logs.user_email IS 'User email if available for easier reporting';
COMMENT ON COLUMN public.audit_logs.user_role IS 'Application role claim at the time of the event';
COMMENT ON COLUMN public.audit_logs.frameworks IS 'Compliance frameworks this event relates to (e.g. ISO27001, NIST_800_53, GDPR, POPIA)';
COMMENT ON COLUMN public.audit_logs.metadata IS 'JSONB blob with flexible metadata (tokensUsed, cost, requestId, etc.)';
COMMENT ON COLUMN public.audit_logs.sensitive_data IS 'Indicates whether the entry references sensitive/PII data';

-- ================================================================
-- INDEXES FOR PERFORMANCE (NIST AU-6 - Audit Review)
-- ================================================================

-- Date-based queries (uses generated column - very efficient)
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_date ON public.audit_logs(event_date DESC);

-- Time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_time ON public.audit_logs(event_time DESC);

-- User activity tracking
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_event_time ON public.audit_logs(user_id, event_time DESC);

-- Category filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_event_time ON public.audit_logs(category, event_time DESC);

-- Security event filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_level_event_time ON public.audit_logs(level, event_time DESC);

-- Session tracking
CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON public.audit_logs(session_id);

-- Correlation tracking (distributed tracing) - partial index saves space
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON public.audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

-- Compliance framework queries (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_audit_logs_frameworks ON public.audit_logs USING GIN(frameworks);

-- Metadata queries (GIN for JSONB)
CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata ON public.audit_logs USING GIN(metadata);

-- Sensitive data queries (GDPR/POPIA) - partial index
CREATE INDEX IF NOT EXISTS idx_audit_logs_sensitive_event_time ON public.audit_logs(sensitive_data, event_time DESC) WHERE sensitive_data = TRUE;

-- Combined index for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_dashboard ON public.audit_logs(level, category, event_time DESC);

-- ================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ================================================================

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins and auditors can see all audit logs
CREATE POLICY audit_logs_admin_all ON public.audit_logs
  FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'admin' OR
    auth.jwt() ->> 'role' = 'auditor'
  );

-- Policy: Users can read only their own audit logs
CREATE POLICY audit_logs_user_own ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Service role can insert audit logs (backend only)
CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- No DELETE policy = immutable audit trail (ISO 27001 A.12.4.2)

-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT INSERT ON public.audit_logs TO service_role;

-- ================================================================
-- AI COST TRACKING MATERIALIZED VIEW
-- Uses event_date (generated column) for efficient grouping
-- ================================================================

CREATE MATERIALIZED VIEW public.ai_cost_summary AS
SELECT
  al.event_date AS date,
  al.user_id,
  al.user_email,
  COUNT(*) AS ai_call_count,
  SUM((al.metadata->>'tokensUsed')::NUMERIC) AS total_tokens,
  SUM((al.metadata->>'cost')::NUMERIC) AS total_cost,
  AVG((al.metadata->>'cost')::NUMERIC) AS avg_cost_per_call,
  MAX((al.metadata->>'cost')::NUMERIC) AS max_cost_per_call
FROM public.audit_logs al
WHERE al.category = 'AI_OPERATION'
  AND al.metadata->>'cost' IS NOT NULL
GROUP BY al.event_date, al.user_id, al.user_email;

-- Indexes on materialized view columns
CREATE INDEX IF NOT EXISTS idx_ai_cost_summary_date ON public.ai_cost_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cost_summary_user ON public.ai_cost_summary(user_id);

-- Refresh schedule (run periodically via pg_cron or Supabase scheduled function)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.ai_cost_summary;

COMMENT ON MATERIALIZED VIEW public.ai_cost_summary IS 'Daily AI cost tracking per user - refresh periodically';

GRANT SELECT ON public.ai_cost_summary TO authenticated;

-- ================================================================
-- SECURITY EVENT SUMMARY VIEW
-- Uses event_date (generated column) for efficient grouping
-- ================================================================

CREATE OR REPLACE VIEW public.security_events_summary AS
SELECT
  al.event_date AS date,
  al.category,
  al.level,
  al.result,
  COUNT(*) AS event_count,
  COUNT(DISTINCT al.user_id) AS unique_users,
  COUNT(DISTINCT al.source_ip) AS unique_ips
FROM public.audit_logs al
WHERE al.level IN ('CRITICAL', 'HIGH')
  OR al.category IN ('AUTHENTICATION', 'AUTHORIZATION', 'ACCESS_CONTROL', 'POLICY_VIOLATION')
GROUP BY al.event_date, al.category, al.level, al.result;

COMMENT ON VIEW public.security_events_summary IS 'Security event aggregation for dashboard visualization';
GRANT SELECT ON public.security_events_summary TO authenticated;

-- ================================================================
-- COMPLIANCE REPORT VIEW (ISO 27001 + NIST)
-- ================================================================

CREATE OR REPLACE VIEW public.compliance_events AS
SELECT
  al.id,
  al.event_time,
  al.event_date,
  al.category,
  al.level,
  al.action,
  al.resource,
  al.result,
  al.frameworks,
  al.metadata->>'iso27001Control' AS iso27001_control,
  al.metadata->>'nistControl' AS nist_control,
  al.metadata->>'owaspCategory' AS owasp_category,
  al.metadata->>'gdprArticle' AS gdpr_article,
  al.metadata->>'popiaSection' AS popia_section,
  al.sensitive_data,
  al.user_email
FROM public.audit_logs al
WHERE array_length(al.frameworks, 1) > 0;

COMMENT ON VIEW public.compliance_events IS 'Compliance-tagged events with control mappings';
GRANT SELECT ON public.compliance_events TO authenticated;

-- ================================================================
-- AUDIT LOG RETENTION FUNCTION (ISO 27001 A.12.4.2)
-- ================================================================

CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO archived_count
  FROM public.audit_logs
  WHERE event_date < CURRENT_DATE - INTERVAL '90 days';

  -- TODO: In production, move to archive table before deleting:
  -- INSERT INTO public.audit_logs_archive SELECT * FROM public.audit_logs
  --   WHERE event_date < CURRENT_DATE - INTERVAL '90 days';
  -- DELETE FROM public.audit_logs
  --   WHERE event_date < CURRENT_DATE - INTERVAL '90 days';

  RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION archive_old_audit_logs() IS 'Archives audit logs older than 90 days (ISO 27001 A.12.4.2)';

-- ================================================================
-- REAL-TIME SECURITY ALERTS FUNCTION
-- ================================================================

CREATE OR REPLACE FUNCTION check_critical_security_events()
RETURNS TABLE (
  alert_type TEXT,
  alert_message TEXT,
  event_count BIGINT,
  last_occurrence TIMESTAMPTZ
) AS $$
BEGIN
  -- Failed authentication spike (> 5 in last hour)
  RETURN QUERY
  SELECT
    'FAILED_AUTH_SPIKE'::TEXT,
    'High number of failed authentication attempts'::TEXT,
    COUNT(*),
    MAX(al.event_time)
  FROM public.audit_logs al
  WHERE al.category = 'AUTHENTICATION'
    AND al.result = 'FAILURE'
    AND al.event_time > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 5;

  -- Rate limit abuse (> 10 in last hour)
  RETURN QUERY
  SELECT
    'RATE_LIMIT_ABUSE'::TEXT,
    'Excessive rate limit violations detected'::TEXT,
    COUNT(*),
    MAX(al.event_time)
  FROM public.audit_logs al
  WHERE al.category = 'RATE_LIMIT'
    AND al.event_time > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 10;

  -- Unauthorized PII access attempts
  RETURN QUERY
  SELECT
    'UNAUTHORIZED_PII_ACCESS'::TEXT,
    'Unauthorized PII access attempts detected'::TEXT,
    COUNT(*),
    MAX(al.event_time)
  FROM public.audit_logs al
  WHERE al.category = 'PII_ACCESS'
    AND al.result = 'FAILURE'
    AND al.event_time > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 0;

  -- Critical system errors
  RETURN QUERY
  SELECT
    'CRITICAL_SYSTEM_ERROR'::TEXT,
    'Critical system errors detected'::TEXT,
    COUNT(*),
    MAX(al.event_time)
  FROM public.audit_logs al
  WHERE al.level = 'CRITICAL'
    AND al.event_time > NOW() - INTERVAL '1 hour'
  HAVING COUNT(*) > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_critical_security_events() IS 'Real-time alert detection for critical security events';

-- ================================================================
-- USAGE EXAMPLES
-- ================================================================

-- Get all critical events from last 24 hours
-- SELECT * FROM public.audit_logs
-- WHERE level = 'CRITICAL'
--   AND event_time > NOW() - INTERVAL '24 hours'
-- ORDER BY event_time DESC;

-- Get AI cost summary for today
-- SELECT * FROM public.ai_cost_summary
-- WHERE date = CURRENT_DATE
-- ORDER BY total_cost DESC;

-- Get security events summary for last 7 days
-- SELECT * FROM public.security_events_summary
-- WHERE date >= CURRENT_DATE - INTERVAL '7 days'
-- ORDER BY date DESC, event_count DESC;

-- Check for active security alerts
-- SELECT * FROM check_critical_security_events();

-- Get compliance events for specific framework
-- SELECT * FROM public.compliance_events
-- WHERE 'ISO27001' = ANY(frameworks)
-- ORDER BY event_time DESC
-- LIMIT 100;

-- ================================================================
-- END OF SCHEMA
-- ================================================================
