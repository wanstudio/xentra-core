'use strict';

/**
 * Workforce persistence adapter.
 *
 * Keeps user, credential, reset-token, and security-log persistence behind the
 * Core data boundary so WorkforceService owns authentication/authorization
 * behavior rather than direct database ownership. This adapter is internal to
 * Core and is NOT the external Core <-> Connector API.
 */
const DataAccess = require('../DataAccess');

class WorkforceRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    return this.db.exec(sql);
  }
}

module.exports = WorkforceRepository;
