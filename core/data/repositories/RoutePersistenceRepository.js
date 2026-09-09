'use strict';

/**
 * Transitional persistence adapter for the legacy HTTP route composition layer.
 *
 * Routes may depend on this adapter for existing SQL-backed endpoint flows,
 * while actual database ownership remains behind DataAccess. This adapter is
 * internal to Xentra Core and is NOT part of the Core <-> Connector API.
 */
const DataAccess = require('../DataAccess');

class RoutePersistenceRepository {
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

module.exports = RoutePersistenceRepository;
