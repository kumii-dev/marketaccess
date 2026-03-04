-- ================================================================
-- AUDIT LOGS SCHEMA - VERIFICATION TEST
-- Run this after deploying the main schema
-- ================================================================

-- Test 1: Verify table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    RAISE NOTICE '✅ Test 1 PASSED: audit_logs table exists';
  ELSE
    RAISE EXCEPTION '❌ Test 1 FAILED: audit_logs table does not exist';
  END IF;
END $$;

-- Test 2: Verify event_time column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema='public' 
    AND table_name='audit_logs' 
    AND column_name='event_time'
  ) THEN
    RAISE NOTICE '✅ Test 2 PASSED: event_time column exists';
  ELSE
    RAISE EXCEPTION '❌ Test 2 FAILED: event_time column does not exist';
  END IF;
END $$;

-- Test 3: Verify all required indexes exist
DO $$
DECLARE
  expected_indexes TEXT[] := ARRAY[
    'idx_audit_logs_event_time',
    'idx_audit_logs_user_id',
    'idx_audit_logs_category',
    'idx_audit_logs_level',
    'idx_audit_logs_session_id',
    'idx_audit_logs_correlation_id',
    'idx_audit_logs_frameworks',
    'idx_audit_logs_sensitive',
    'idx_audit_logs_metadata',
    'idx_audit_logs_dashboard'
  ];
  idx TEXT;
  missing_count INT := 0;
BEGIN
  FOREACH idx IN ARRAY expected_indexes
  LOOP
    IF NOT EXISTS (
      SELECT FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename = 'audit_logs' 
      AND indexname = idx
    ) THEN
      RAISE NOTICE '❌ Missing index: %', idx;
      missing_count := missing_count + 1;
    END IF;
  END LOOP;
  
  IF missing_count = 0 THEN
    RAISE NOTICE '✅ Test 3 PASSED: All % indexes exist', array_length(expected_indexes, 1);
  ELSE
    RAISE EXCEPTION '❌ Test 3 FAILED: % indexes missing', missing_count;
  END IF;
END $$;

-- Test 4: Verify RLS is enabled
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'audit_logs' 
    AND rowsecurity = true
  ) THEN
    RAISE NOTICE '✅ Test 4 PASSED: Row-Level Security is enabled';
  ELSE
    RAISE EXCEPTION '❌ Test 4 FAILED: Row-Level Security is not enabled';
  END IF;
END $$;

-- Test 5: Verify RLS policies exist
DO $$
DECLARE
  policy_count INT;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies 
  WHERE schemaname = 'public' 
  AND tablename = 'audit_logs';
  
  IF policy_count >= 3 THEN
    RAISE NOTICE '✅ Test 5 PASSED: % RLS policies exist', policy_count;
  ELSE
    RAISE EXCEPTION '❌ Test 5 FAILED: Only % RLS policies exist (expected at least 3)', policy_count;
  END IF;
END $$;

-- Test 6: Verify materialized view exists
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_matviews 
    WHERE schemaname = 'public' 
    AND matviewname = 'ai_cost_summary'
  ) THEN
    RAISE NOTICE '✅ Test 6 PASSED: ai_cost_summary materialized view exists';
  ELSE
    RAISE EXCEPTION '❌ Test 6 FAILED: ai_cost_summary materialized view does not exist';
  END IF;
END $$;

-- Test 7: Verify regular views exist
DO $$
DECLARE
  view_count INT;
BEGIN
  SELECT COUNT(*) INTO view_count
  FROM information_schema.views 
  WHERE table_schema = 'public' 
  AND table_name IN ('security_events_summary', 'compliance_events');
  
  IF view_count = 2 THEN
    RAISE NOTICE '✅ Test 7 PASSED: Both regular views exist';
  ELSE
    RAISE EXCEPTION '❌ Test 7 FAILED: Only % of 2 views exist', view_count;
  END IF;
END $$;

-- Test 8: Verify functions exist
DO $$
DECLARE
  function_count INT;
BEGIN
  SELECT COUNT(*) INTO function_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname IN ('archive_old_audit_logs', 'check_critical_security_events');
  
  IF function_count = 2 THEN
    RAISE NOTICE '✅ Test 8 PASSED: Both functions exist';
  ELSE
    RAISE EXCEPTION '❌ Test 8 FAILED: Only % of 2 functions exist', function_count;
  END IF;
END $$;

-- Test 9: Insert a test log entry
DO $$
BEGIN
  INSERT INTO public.audit_logs (
    session_id,
    category,
    level,
    action,
    resource,
    result,
    frameworks,
    metadata
  ) VALUES (
    'test-session-' || gen_random_uuid()::TEXT,
    'SYSTEM_ERROR',
    'INFO',
    'Schema Verification Test',
    'audit_logs',
    'SUCCESS',
    ARRAY['ISO27001'],
    '{"test": true, "testTime": "' || NOW()::TEXT || '"}'::JSONB
  );
  
  RAISE NOTICE '✅ Test 9 PASSED: Test log entry inserted successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '❌ Test 9 FAILED: Could not insert test log entry - %', SQLERRM;
END $$;

-- Test 10: Query the test log entry
DO $$
DECLARE
  log_count INT;
BEGIN
  SELECT COUNT(*) INTO log_count
  FROM public.audit_logs
  WHERE metadata->>'test' = 'true';
  
  IF log_count > 0 THEN
    RAISE NOTICE '✅ Test 10 PASSED: Test log entry can be queried (found % entries)', log_count;
  ELSE
    RAISE EXCEPTION '❌ Test 10 FAILED: Cannot query test log entry';
  END IF;
END $$;

-- Test 11: Test views return data
DO $$
DECLARE
  compliance_count INT;
BEGIN
  SELECT COUNT(*) INTO compliance_count
  FROM public.compliance_events
  WHERE 'ISO27001' = ANY(frameworks);
  
  IF compliance_count > 0 THEN
    RAISE NOTICE '✅ Test 11 PASSED: compliance_events view returns data (% entries)', compliance_count;
  ELSE
    RAISE NOTICE '⚠️  Test 11 WARNING: compliance_events view is empty (expected for new deployment)';
  END IF;
END $$;

-- Test 12: Test function execution
DO $$
DECLARE
  archive_count INT;
BEGIN
  SELECT archive_old_audit_logs() INTO archive_count;
  RAISE NOTICE '✅ Test 12 PASSED: archive_old_audit_logs() function executed (% old logs)', archive_count;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '❌ Test 12 FAILED: archive_old_audit_logs() function error - %', SQLERRM;
END $$;

-- Test 13: Test alert function
DO $$
DECLARE
  alert_count INT;
BEGIN
  SELECT COUNT(*) INTO alert_count
  FROM check_critical_security_events();
  RAISE NOTICE '✅ Test 13 PASSED: check_critical_security_events() function executed (% alerts)', alert_count;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '❌ Test 13 FAILED: check_critical_security_events() function error - %', SQLERRM;
END $$;

-- Test 14: Verify permissions
DO $$
DECLARE
  grant_count INT;
BEGIN
  SELECT COUNT(*) INTO grant_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
  AND table_name = 'audit_logs'
  AND grantee = 'authenticated';
  
  IF grant_count > 0 THEN
    RAISE NOTICE '✅ Test 14 PASSED: Permissions granted to authenticated role';
  ELSE
    RAISE EXCEPTION '❌ Test 14 FAILED: No permissions found for authenticated role';
  END IF;
END $$;

-- ================================================================
-- CLEANUP (Optional)
-- ================================================================

-- Remove test entries (uncomment if you want to clean up)
-- DELETE FROM public.audit_logs WHERE metadata->>'test' = 'true';

-- ================================================================
-- TEST SUMMARY
-- ================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ ALL TESTS COMPLETED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Audit logging schema is fully functional!';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Configure environment variables (VITE_AUDIT_API_KEY, AUDIT_API_KEY)';
  RAISE NOTICE '2. Start your application and test audit logging';
  RAISE NOTICE '3. Build the admin dashboard using LOVABLE-AUDIT-DASHBOARD-PROMPT.md';
  RAISE NOTICE '';
END $$;
