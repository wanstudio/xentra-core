/**
 * Xentra Core Audit & Investigation Module (Milestone E — Updated Contract)
 * Unified exports for Audit Log Records, Audit Process Engine, Writer, Query, and Retention Boundary.
 */
const AuditLogRecord = require('./AuditLogRecord');
const AuditProcessEngine = require('./AuditProcessEngine');
const AuditWriter = require('./AuditWriter');
const AuditQueryFoundation = require('./AuditQueryFoundation');
const AuditRetentionBoundary = require('./AuditRetentionBoundary');

module.exports = {
  AuditLogRecord,
  AuditProcessEngine,
  AuditWriter,
  AuditQueryFoundation,
  AuditRetentionBoundary,

  // Factory Helpers
  createAuditWriter: (storageAdapter) => new AuditWriter(storageAdapter),
  createAuditEngine: (auditWriter) => new AuditProcessEngine(auditWriter),
  createAuditQuery: (auditWriter) => new AuditQueryFoundation(auditWriter)
};
