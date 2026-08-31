/**
 * Xentra Core Audit Retention Boundary (E5)
 * Enforces strict append-only immutability and time-based retention pruning.
 */
class AuditRetentionBoundary {
  /**
   * Asserts that an audit record cannot be modified or updated.
   */
  static assertImmutable() {
    throw new Error('[AuditRetentionBoundary] Mutation forbidden: Audit records are strictly append-only and cannot be modified or updated.');
  }

  /**
   * Prunes audit records older than the specified retention days.
   * @param {Array<Object>} records - Audit records list
   * @param {number} retentionDays - Retention window in days
   * @returns {Array<Object>} Retained audit records
   */
  static prune(records, retentionDays = 90) {
    if (!Array.isArray(records)) return [];

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return records.filter(record => record.timestamp >= cutoff);
  }
}

module.exports = AuditRetentionBoundary;
