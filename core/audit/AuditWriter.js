const AuditEventModel = require('./AuditEventModel');
const AuditLogRecord = require('./AuditLogRecord');
const AuditRetentionBoundary = require('./AuditRetentionBoundary');

class AuditWriter {
  constructor(storageAdapter = null) {
    this.storageAdapter = storageAdapter;
    this._inMemoryStore = [];
  }

  /**
   * Appends an audit event or audit process log record to the append-only trail.
   * @param {Object} eventParams - AuditLogRecord, AuditEventModel, or plain object
   * @returns {Promise<Object>}
   */
  async append(eventParams) {
    let record;
    if (eventParams instanceof AuditLogRecord || eventParams instanceof AuditEventModel) {
      record = eventParams;
    } else if (eventParams.audit_type) {
      record = new AuditLogRecord(eventParams);
    } else {
      record = new AuditEventModel(eventParams);
    }

    this._inMemoryStore.push(record);

    if (this.storageAdapter && typeof this.storageAdapter.saveAudit === 'function') {
      await this.storageAdapter.saveAudit(typeof record.toJSON === 'function' ? record.toJSON() : record);
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
