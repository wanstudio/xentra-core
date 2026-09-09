'use strict';

/**
 * Brand persistence adapter.
 *
 * Exposes tenant-resolution reads while keeping persistence details behind
 * the data boundary. Tenant authority and request security remain in the
 * resolver/control-plane layer.
 */
const DataAccess = require('../DataAccess');

class BrandRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findByCustomDomain(hostname) {
    return this.db.queryOne(`
      SELECT *
      FROM brands
      WHERE lower(trim(custom_domain)) = ?
      LIMIT 1
    `, [hostname]);
  }

  findFirstForLocalDevelopment() {
    return this.db.queryOne(
      'SELECT * FROM brands ORDER BY created_at ASC LIMIT 1'
    );
  }
}

module.exports = BrandRepository;
