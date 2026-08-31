/**
 * Xentra Core Audit & Activity Module (Milestone E)
 * Unified exports for Audit Event Model, Contexts, Writer, Query, and Retention Boundary.
 */
const AuditEventModel = require('./AuditEventModel');
const ActorTargetContext = require('./ActorTargetContext');
const AuditWriter = require('./AuditWriter');
const AuditQueryFoundation = require('./AuditQueryFoundation');
const AuditRetentionBoundary = require('./AuditRetentionBoundary');

module.exports = {
  AuditEventModel,
  ActorTargetContext,
  AuditWriter,
  AuditQueryFoundation,
  AuditRetentionBoundary,

  // Factory Helpers
  createAuditWriter: (storageAdapter) => new AuditWriter(storageAdapter),
  createAuditQuery: (auditWriter) => new AuditQueryFoundation(auditWriter)
};
