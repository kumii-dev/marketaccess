/**
 * Audit Supabase client.
 *
 * audit_logs lives in the same Supabase project as the main app
 * (private_tenders, auth, storage — all on njcancswtqnxihxavshl).
 *
 * We re-export the main client so there is one connection, one set
 * of env vars, and zero risk of the audit client being misconfigured.
 *
 * Compliance:
 *  ISO 27001:2022  A.12.4.1  Event Logging
 *  NIST SP 800-53  AU-9      Protection of Audit Information
 *  GDPR Art. 30    Records of Processing Activities
 */

export { supabase as supabaseAudit } from './supabase';
