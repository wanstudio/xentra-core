'use strict';

/**
 * User persistence adapter.
 *
 * Persistence-only boundary for identity reads used by domain services.
 * Authentication, authorization, and actor policy remain outside the repository.
 */
const DataAccess = require('../DataAccess');

class UserRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findById(userId) {
    return this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  }

  findAuditLogsForBrand(brandId, limit = 20) {
    return this.db.queryMany(`
      SELECT id, actor_id, actor_role, action, target_user_id, target_role, result, created_at
      FROM security_audit_log
      WHERE brand_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [brandId, limit]);
  }
}

module.exports = UserRepository;
