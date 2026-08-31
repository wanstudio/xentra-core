/**
 * Xentra Core Audit & Investigation Module (Milestone E)
 * Purely exposes AuditLogRecord, AuditProcessEngine, Writer, Query, and Retention Boundary.
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
