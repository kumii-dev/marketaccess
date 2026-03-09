/**
 * Enterprise-Grade Audit Logger
 * 
 * 🔒 COMPLIANCE FRAMEWORKS:
 * - ISO 27001:2022 (A.12.4.1 - Event Logging)
 * - NIST SP 800-53 (AU-2, AU-3, AU-6, AU-12)
 * - OWASP Logging Cheat Sheet
 * - GDPR Article 30 (Records of Processing Activities)
 * 
 * 📊 LOG CATEGORIES:
 * - Security Events (authentication, authorization, access control)
 * - AI Operations (OpenAI calls, token usage, cost tracking)
 * - Data Access (PII access, data exports, modifications)
 * - System Events (errors, performance, availability)
 * - Compliance Events (rate limits, policy violations)
 */

// Dedicated audit database client (separate Supabase project — DB 2)
import { supabaseAudit as supabase } from '../lib/supabaseAudit';

/**
 * Audit Log Levels (ISO 27001 severity classification)
 */
export const AuditLogLevel = {
  CRITICAL: 'CRITICAL',   // System compromise, data breach
  HIGH: 'HIGH',           // Security violation, unauthorized access
  MEDIUM: 'MEDIUM',       // Policy violation, suspicious activity
  LOW: 'LOW',             // Normal operations, informational
  INFO: 'INFO'            // General information, routine events
};

/**
 * Audit Event Categories (NIST SP 800-53 AU-2)
 */
export const AuditEventCategory = {
  // Security Events
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  
  // AI Operations
  AI_OPERATION: 'AI_OPERATION',
  AI_COST: 'AI_COST',
  AI_SECURITY: 'AI_SECURITY',
  
  // Data Events
  DATA_ACCESS: 'DATA_ACCESS',
  DATA_MODIFICATION: 'DATA_MODIFICATION',
  DATA_EXPORT: 'DATA_EXPORT',
  PII_ACCESS: 'PII_ACCESS',
  
  // System Events
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  PERFORMANCE: 'PERFORMANCE',
  AVAILABILITY: 'AVAILABILITY',
  
  // Compliance Events
  RATE_LIMIT: 'RATE_LIMIT',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  COMPLIANCE_CHECK: 'COMPLIANCE_CHECK',
  
  // Business Events
  TENDER_ACCESS: 'TENDER_ACCESS',
  MATCHING_OPERATION: 'MATCHING_OPERATION',
  USER_ACTIVITY: 'USER_ACTIVITY'
};

/**
 * Compliance Framework Tags
 */
export const ComplianceFramework = {
  ISO27001: 'ISO27001',
  NIST_800_53: 'NIST_800_53',
  NIST_AI_RMF: 'NIST_AI_RMF',
  OWASP_API: 'OWASP_API',
  GDPR: 'GDPR',
  POPIA: 'POPIA'  // South African data protection
};

/**
 * Main Audit Logger Class
 */
class AuditLogger {
  constructor() {
    // ✅ Correct endpoint: Vercel backend receiver (NOT the Lovable dashboard URL)
    this.endpoint = 'https://marketaccess.vercel.app/admin/audit-logs';
    this.batchQueue = [];
    this.batchSize = 10;
    this.batchInterval = 5000; // 5 seconds
    this.sessionId = this.generateSessionId();
    
    // Start batch processor
    this.startBatchProcessor();
  }

  /**
   * Generate unique session ID for tracking
   */
  generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Get current user context
   */
  async getUserContext() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return {
        userId: user?.id || 'anonymous',
        email: user?.email || null,
        role: user?.user_metadata?.role || 'user'
      };
    } catch {
      return {
        userId: 'anonymous',
        email: null,
        role: 'user'
      };
    }
  }

  /**
   * Create audit log entry (NIST AU-3 - Content of Audit Records)
   */
  async createLogEntry({
    category,
    level,
    action,
    resource,
    result,
    frameworks = [],
    metadata = {},
    sensitiveData = false
  }) {
    const userContext = await this.getUserContext();
    
    const logEntry = {
      // Core audit fields (NIST AU-3)
      event_time: new Date().toISOString(),
      sessionId: this.sessionId,
      
      // User identification (ISO 27001 A.12.4.1)
      userId: userContext.userId,
      userEmail: userContext.email,
      userRole: userContext.role,
      
      // Event classification
      category,
      level,
      action,
      resource,
      result, // SUCCESS, FAILURE, PARTIAL
      
      // System context
      sourceIp: await this.getClientIp(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      location: window.location.href,
      
      // Compliance frameworks
      frameworks: Array.isArray(frameworks) ? frameworks : [frameworks],
      
      // Additional metadata
      metadata: {
        ...metadata,
        applicationName: 'MarketAccess',
        applicationVersion: '1.0.0',
        environment: import.meta.env.MODE || 'production'
      },
      
      // Security classification
      sensitiveData,
      
      // Correlation ID for tracking related events
      correlationId: metadata.correlationId || this.generateCorrelationId()
    };

    // Add to batch queue
    this.batchQueue.push(logEntry);
    
    // Send immediately for critical/high events; flush after batchSize for others
    if (level === AuditLogLevel.CRITICAL || level === AuditLogLevel.HIGH) {
      await this.flushBatch();
    } else if (this.batchQueue.length >= this.batchSize) {
      // Fire-and-forget when batch is full
      this.flushBatch().catch(() => {});
    }

    // NOTE: Direct Supabase write removed — anon key cannot INSERT (service_role only).
    // The flushBatch() HTTP POST to the Vercel backend is the authoritative write path.
    // The backend uses the service_role key to bypass RLS.

    return logEntry;
  }

  /**
   * Get client IP address (best effort)
   */
  async getClientIp() {
    // In production, this should come from backend
    // For now, return placeholder
    return 'client-ip-from-backend';
  }

  /**
   * Generate correlation ID for event tracking
   */
  generateCorrelationId() {
    return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Store audit log in Supabase (redundancy + local querying)
   */
  async storeInSupabase(logEntry) {
    try {
      const { error } = await supabase
        .from('audit_logs')
        .insert({
          event_time: logEntry.event_time,
          session_id: logEntry.sessionId,
          user_id: logEntry.userId,
          user_email: logEntry.userEmail,
          user_role: logEntry.userRole,
          category: logEntry.category,
          level: logEntry.level,
          action: logEntry.action,
          resource: logEntry.resource,
          result: logEntry.result,
          source_ip: logEntry.sourceIp,
          user_agent: logEntry.userAgent,
          frameworks: logEntry.frameworks,
          metadata: logEntry.metadata,
          sensitive_data: logEntry.sensitiveData,
          correlation_id: logEntry.correlationId
        });

      if (error) {
        console.warn('⚠️ Failed to store audit log in Supabase:', error.message);
      }
    } catch (err) {
      console.warn('⚠️ Supabase audit log storage error:', err.message);
    }
  }

  /**
   * Send batch to centralized admin dashboard
   */
  async flushBatch() {
    if (this.batchQueue.length === 0) return;

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': import.meta.env.VITE_AUDIT_API_KEY || 'development-key',
          'X-Application': 'MarketAccess',
          'X-Batch-Size': batch.length.toString()
        },
        body: JSON.stringify({
          batch,
          batchMetadata: {
            batchId: `batch-${Date.now()}`,
            batchSize: batch.length,
            event_time: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        console.error('❌ Failed to send audit logs:', response.statusText);
        // Re-queue failed logs
        this.batchQueue.push(...batch);
      } else {
        console.log(`✅ Sent ${batch.length} audit logs to ${this.endpoint}`);
      }
    } catch (err) {
      console.error('❌ Error sending audit logs:', err.message);
      // Re-queue failed logs
      this.batchQueue.push(...batch);
    }
  }

  /**
   * Start batch processor (sends logs every 5 seconds)
   */
  startBatchProcessor() {
    // Flush every 5s if there's anything in the queue (not just when full)
    setInterval(() => {
      if (this.batchQueue.length > 0) {
        this.flushBatch();
      }
    }, this.batchInterval);

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      this.flushBatch();
    });
  }

  /**
   * ISO 27001 - Authentication Events
   */
  async logAuthentication({ action, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.AUTHENTICATION,
      level: result === 'SUCCESS' ? AuditLogLevel.INFO : AuditLogLevel.HIGH,
      action,
      resource: 'Authentication System',
      result,
      frameworks: [ComplianceFramework.ISO27001, ComplianceFramework.NIST_800_53],
      metadata: {
        ...metadata,
        iso27001Control: 'A.9.4.1', // Information Access Management
        nistControl: 'IA-2' // Identification and Authentication
      }
    });
  }

  /**
   * NIST AI RMF - AI Operations
   */
  async logAIOperation({ action, model, tokensUsed, cost, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.AI_OPERATION,
      level: AuditLogLevel.INFO,
      action,
      resource: `AI Model: ${model}`,
      result,
      frameworks: [ComplianceFramework.NIST_AI_RMF, ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        model,
        tokensUsed,
        cost,
        costCurrency: 'USD',
        nistAIFunction: metadata.nistAIFunction || 'MEASURE',
        iso27001Control: 'A.12.1.3' // Capacity Management
      }
    });
  }

  /**
   * OWASP - Rate Limit Violations
   */
  async logRateLimit({ endpoint, limit, current, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.RATE_LIMIT,
      level: AuditLogLevel.MEDIUM,
      action: 'Rate Limit Exceeded',
      resource: endpoint,
      result,
      frameworks: [ComplianceFramework.OWASP_API, ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        limit,
        current,
        owaspCategory: 'API4:2023 - Unrestricted Resource Consumption',
        iso27001Control: 'A.12.1.3' // Capacity Management
      }
    });
  }

  /**
   * GDPR/POPIA - PII Access
   */
  async logPIIAccess({ action, dataType, purpose, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.PII_ACCESS,
      level: AuditLogLevel.HIGH,
      action,
      resource: `PII: ${dataType}`,
      result,
      frameworks: [ComplianceFramework.GDPR, ComplianceFramework.POPIA, ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        dataType,
        purpose,
        legalBasis: metadata.legalBasis || 'Legitimate Interest',
        gdprArticle: 'Article 30', // Records of Processing Activities
        popiaSection: 'Section 51', // Security Measures
        iso27001Control: 'A.18.1.4' // Privacy and Protection of PII
      },
      sensitiveData: true
    });
  }

  /**
   * System Error Logging
   */
  async logError({ error, component, severity, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.SYSTEM_ERROR,
      level: severity || AuditLogLevel.MEDIUM,
      action: 'System Error',
      resource: component,
      result: 'FAILURE',
      frameworks: [ComplianceFramework.ISO27001, ComplianceFramework.NIST_800_53],
      metadata: {
        ...metadata,
        errorMessage: error.message,
        errorStack: error.stack,
        errorType: error.name,
        iso27001Control: 'A.12.4.1', // Event Logging
        nistControl: 'SI-4' // System Monitoring
      }
    });
  }

  /**
   * Tender Access Logging (Business Activity)
   */
  async logTenderAccess({ tenderId, tenderTitle, action, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.TENDER_ACCESS,
      level: AuditLogLevel.INFO,
      action,
      resource: `Tender: ${tenderId}`,
      result,
      frameworks: [ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        tenderId,
        tenderTitle,
        iso27001Control: 'A.12.4.1' // Event Logging
      }
    });
  }

  /**
   * Data Export Logging (GDPR Article 20 - Data Portability)
   */
  async logDataExport({ exportType, recordCount, format, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.DATA_EXPORT,
      level: AuditLogLevel.HIGH,
      action: 'Data Export',
      resource: `Export: ${exportType}`,
      result,
      frameworks: [ComplianceFramework.GDPR, ComplianceFramework.POPIA, ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        exportType,
        recordCount,
        format,
        gdprArticle: 'Article 20', // Right to Data Portability
        popiaSection: 'Section 24', // Right to Access
        iso27001Control: 'A.18.1.4' // Privacy and Protection of PII
      },
      sensitiveData: true
    });
  }

  /**
   * Performance Monitoring
   */
  async logPerformance({ operation, duration, result, metadata = {} }) {
    return this.createLogEntry({
      category: AuditEventCategory.PERFORMANCE,
      level: AuditLogLevel.INFO,
      action: operation,
      resource: 'Application Performance',
      result,
      frameworks: [ComplianceFramework.ISO27001],
      metadata: {
        ...metadata,
        duration,
        durationUnit: 'ms',
        iso27001Control: 'A.12.1.3' // Capacity Management
      }
    });
  }
}

// Export singleton instance
export const auditLogger = new AuditLogger();

// Export helper functions for common operations
export const logAuthSuccess = (metadata) => 
  auditLogger.logAuthentication({ action: 'Login', result: 'SUCCESS', metadata });

export const logAuthFailure = (metadata) => 
  auditLogger.logAuthentication({ action: 'Login', result: 'FAILURE', metadata });

export const logAICall = (model, tokensUsed, cost, metadata) => 
  auditLogger.logAIOperation({ 
    action: 'AI API Call', 
    model, 
    tokensUsed, 
    cost, 
    result: 'SUCCESS', 
    metadata 
  });

export const logRateLimitViolation = (endpoint, limit, current, metadata) => 
  auditLogger.logRateLimit({ 
    endpoint, 
    limit, 
    current, 
    result: 'BLOCKED', 
    metadata 
  });

export const logPIIView = (dataType, purpose, metadata) => 
  auditLogger.logPIIAccess({ 
    action: 'View PII', 
    dataType, 
    purpose, 
    result: 'SUCCESS', 
    metadata 
  });

export const logSystemError = (error, component, severity, metadata) => 
  auditLogger.logError({ error, component, severity, metadata });

export const logTenderView = (tenderId, tenderTitle, metadata) => 
  auditLogger.logTenderAccess({ 
    tenderId, 
    tenderTitle, 
    action: 'View Tender', 
    result: 'SUCCESS', 
    metadata 
  });

export const logDataExportRequest = (exportType, recordCount, format, metadata) => 
  auditLogger.logDataExport({ 
    exportType, 
    recordCount, 
    format, 
    result: 'SUCCESS', 
    metadata 
  });

export default auditLogger;
