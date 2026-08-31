/**
 * Xentra Core Audit Process Engine (Milestone E — Updated Contract)
 * Performs purposeful investigation on evidence (Business Log, System Log, Transaction Records)
 * and produces formal AuditLogRecords.
 */
const AuditLogRecord = require('./AuditLogRecord');

class AuditProcessEngine {
  constructor(auditWriter) {
    this.auditWriter = auditWriter;
  }

  /**
   * Executes an audit process examining provided evidence records.
   * 
   * @param {Object} params
   * @param {string} params.audit_type - e.g. 'revenue_reconciliation', 'inventory_stock_audit'
   * @param {Object} params.auditor - { auditor_id, name, role }
   * @param {Object} params.audit_period - { start_time, end_time }
   * @param {Object} params.target - { branch_id, organization_id, branch_manager_in_charge }
   * @param {string} params.inspected_area - Description of audited area
   * @param {Array<Object>} params.evidence_pool - Array of evidence records (Business Logs, System Logs, Transactions)
   * @param {Function} [params.inspector_fn] - Custom inspection rule (evidence_pool => { status, findings })
   * @returns {Promise<AuditLogRecord>}
   */
  async performAudit({
    audit_type,
    auditor,
    audit_period,
    target,
    inspected_area,
    evidence_pool = [],
    inspector_fn = null
  }) {
    const evidenceReferences = evidence_pool.map(item => item.id || item.event_id || item.transaction_id || 'unlabeled_evidence');

    let status = 'completed';
    let findings = 'Audit process completed with no discrepancies detected.';

    if (typeof inspector_fn === 'function') {
      const result = await inspector_fn(evidence_pool);
      if (result) {
        status = result.status || status;
        findings = result.findings || findings;
      }
    }

    const auditRecord = new AuditLogRecord({
      audit_type,
      auditor,
      audit_period,
      target,
      inspected_area,
      evidence_references: evidenceReferences,
      status,
      findings
    });

    await this.auditWriter.append(auditRecord);
    return auditRecord;
  }
}

module.exports = AuditProcessEngine;
