'use strict';

/**
 * Demo fixtures for suites that assert against demo data.
 *
 * Schema initialization deliberately provisions ONLY the essential tenant
 * (organization + brand): demo branches, products and promotions are never
 * auto-seeded. Suites that exercise demo branches (`branch_bangjo_barat` /
 * `branch_bangjo_timur`) opt in explicitly by requiring this module.
 *
 * Suites that verify the empty-state contract (e.g. dbSeedIsolation,
 * databaseSafetyGuard) must NOT require this.
 */

const db = require('../../server/database/db');

function seedDemoFixtures() {
  let count = 0;
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM branches').get();
    count = row ? Number(row.n) : 0;
  } catch (_) {
    count = 0;
  }

  if (count === 0) {
    db.seedData(db);
  }

  return db;
}

module.exports = seedDemoFixtures;
