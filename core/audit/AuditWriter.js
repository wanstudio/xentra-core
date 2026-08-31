/**
 * Xentra Core Audit Writer (E3)
 * Append-only writer persisting sanitized audit events.
 */
const AuditEventModel = require('./AuditEventModel');
const AuditRetentionBoundary = require('./AuditRetentionBoundary');

class AuditWriter {
  constructor(storageAdapter = null) {
    this.storageAdapter = storageAdapter;
    this._inMemoryStore = [];
  }

  /**
   * Appends an audit event to the audit trail.
   * @param {Object} eventParams - AuditEventModel parameters or instance
   * @returns {Promise<AuditEventModel>}
   */
  async append(eventParams) {
    const event = eventParams instanceof AuditEventModel ? eventParams : new AuditEventModel(eventParams);

    this._inMemoryStore.push(event);

    if (this.storageAdapter && typeof this.storageAdapter.saveAudit === 'function') {
      await this.storageAdapter.saveAudit(event.toJSON());
    }

    return event;
  }

  /**
   * Explicit rejection of update/mutation attempts.
   */
  update() {
    AuditRetentionBoundary.assertImmutable();
  }

  delete() {
    AuditRetentionBoundary.assertImmutable();
  }

  getRecords() {
    return [...this._inMemoryStore];
  }

  clear() {
    this._inMemoryStore = [];
  }
}

module.exports = AuditWriter;
