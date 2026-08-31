/**
 * Xentra Core Audit Log Record Model (Milestone E — Updated Contract)
 * Represents a discrete record of an audit/investigation process performed on evidence.
 */
const crypto = require('crypto');
const { SecretBoundary } = require('../integration');

class AuditLogRecord {
  /**
   * Minimal required audit context per locked Notion decisions:
   * - audit_id: unique audit process identifier
   * - audit_type: e.g. 'revenue_reconciliation', 'inventory_discrepancy', 'fraud_investigation'
   * - auditor: { auditor_id, name, role }
   * - audit_period: { start_time, end_time }
   * - target: { branch_id, organization_id, branch_manager_in_charge }
   * - inspected_area: area or entities examined
   * - evidence_references: array of log/transaction IDs or evidence descriptors
   * - status: 'completed' | 'discrepancy_found' | 'in_progress' | 'action_required'
   * - findings: summary of discrepancies or notes
   * - audited_at: timestamp when audit process was performed
   */
  constructor({
    audit_id = null,
    audit_type,
    auditor,
    audit_period = {},
    target = {},
    inspected_area,
    evidence_references = [],
    status = 'completed',
    findings = '',
    metadata = {},
    audited_at = null
  }) {
    if (!audit_type || typeof audit_type !== 'string' || !audit_type.trim()) {
      throw new Error('[AuditLogRecord] "audit_type" is required.');
    }

    if (!auditor || typeof auditor !== 'object' || !auditor.auditor_id) {
      throw new Error('[AuditLogRecord] "auditor" context with auditor_id is required.');
    }

    if (!inspected_area || typeof inspected_area !== 'string') {
      throw new Error('[AuditLogRecord] "inspected_area" is required.');
    }

    this.audit_id = audit_id || `aud_${crypto.randomUUID()}`;
    this.audit_type = audit_type.trim();
    this.auditor = Object.freeze({
      auditor_id: String(auditor.auditor_id).trim(),
      name: auditor.name ? String(auditor.name).trim() : 'Auditor',
      role: auditor.role ? String(auditor.role).trim() : 'auditor'
    });
    this.audit_period = Object.freeze({
      start_time: audit_period.start_time || null,
      end_time: audit_period.end_time || null
    });
    this.target = Object.freeze({
      organization_id: target.organization_id ? String(target.organization_id).trim() : null,
      branch_id: target.branch_id ? String(target.branch_id).trim() : null,
      branch_manager_in_charge: target.branch_manager_in_charge ? String(target.branch_manager_in_charge).trim() : null
    });
    this.inspected_area = inspected_area.trim();
    this.evidence_references = Object.freeze([...(Array.isArray(evidence_references) ? evidence_references : [])]);
    this.status = status;
    this.findings = findings ? String(findings).trim() : '';
    this.metadata = Object.freeze(SecretBoundary.redact(metadata));
    this.audited_at = audited_at || new Date().toISOString();

    Object.freeze(this);
  }

  toJSON() {
    return {
      audit_id: this.audit_id,
      audit_type: this.audit_type,
      auditor: this.auditor,
      audit_period: this.audit_period,
      target: this.target,
      inspected_area: this.inspected_area,
      evidence_references: this.evidence_references,
      status: this.status,
      findings: this.findings,
      metadata: this.metadata,
      audited_at: this.audited_at
    };
  }
}

module.exports = AuditLogRecord;
