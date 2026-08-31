/**
 * Xentra Core Audit Query Foundation (E4)
 * Provides filtering and retrieval capabilities for audit logs across actors, targets, and trace IDs.
 */
class AuditQueryFoundation {
  constructor(auditWriter) {
    this.auditWriter = auditWriter;
  }

  /**
   * Queries audit records using matching criteria.
   * 
   * @param {Object} filters
   * @param {string} [filters.actor_id]
   * @param {string} [filters.action]
   * @param {string} [filters.entity_type]
   * @param {string} [filters.entity_id]
   * @param {string} [filters.branch_id]
   * @param {string} [filters.correlation_id]
   * @param {string} [filters.start_time] - ISO string
   * @param {string} [filters.end_time] - ISO string
   * @param {number} [filters.limit=100]
   * @returns {Array<Object>}
   */
  query(filters = {}) {
    const all = this.auditWriter.getRecords();

    const filtered = all.filter(record => {
      if (filters.actor_id && (!record.actor || record.actor.actor_id !== filters.actor_id)) {
        return false;
      }
      if (filters.action && record.action !== filters.action) {
        return false;
      }
      if (filters.entity_type && (!record.target || record.target.entity_type !== filters.entity_type)) {
        return false;
      }
      if (filters.entity_id && (!record.target || record.target.entity_id !== filters.entity_id)) {
        return false;
      }
      if (filters.branch_id && (!record.target || record.target.branch_id !== filters.branch_id)) {
        return false;
      }
      if (filters.correlation_id && record.correlation_id !== filters.correlation_id) {
        return false;
      }
      if (filters.start_time && record.timestamp < filters.start_time) {
        return false;
      }
      if (filters.end_time && record.timestamp > filters.end_time) {
        return false;
      }
      return true;
    });

    const limit = filters.limit || 100;
    return filtered.slice(0, limit);
  }
}

module.exports = AuditQueryFoundation;
