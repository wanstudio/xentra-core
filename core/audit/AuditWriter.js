/**
 * Xentra Core Audit Writer (E3)
 * Strictly append-only persistence sink for AuditLogRecord instances.
 */
const AuditLogRecord = require('./AuditLogRecord');
const AuditRetentionBoundary = require('./AuditRetentionBoundary');

class AuditWriter {
  constructor(storageAdapter = null) {
    this.storageAdapter = storageAdapter;
    this._inMemoryStore = [];
  }

  /**
   * Appends an audit process log record to the append-only trail.
   * @param {AuditLogRecord|Object} recordParams - AuditLogRecord instance or parameters
   * @returns {Promise<AuditLogRecord>}
   */
  async append(recordParams) {
    const record = recordParams instanceof AuditLogRecord ? recordParams : new AuditLogRecord(recordParams);

    this._inMemoryStore.push(record);

    if (this.storageAdapter && typeof this.storageAdapter.saveAudit === 'function') {
      await this.storageAdapter.saveAudit(record.toJSON());
    }

    return record;
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
