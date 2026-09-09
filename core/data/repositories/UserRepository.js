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
}

module.exports = UserRepository;
