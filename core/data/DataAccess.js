'use strict';

/**
 * Xentra Core Data Access Boundary.
 *
 * Runtime/domain code should depend on this interface rather than importing
 * the concrete database implementation directly. The concrete provider stays
 * behind the boundary so a future client-resident connector can satisfy
 * the same domain-oriented data access contract without leaking SQL/storage
 * details into business logic.
 *
 * NOTE: `prepare` is intentionally retained as an internal transitional seam
 * for existing Core SQL-backed services. It is not part of the external
 * Core ↔ Connector API and must not be exposed as arbitrary SQL over that API.
 */
const db = require('../../server/database/db');

function assertSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new TypeError('[DataAccess] sql must be a non-empty string.');
  }
}

function normalizeParams(params) {
  return Array.isArray(params) ? params : [];
}

const DataAccess = {
  get readyPromise() {
    return db.readyPromise || Promise.resolve();
  },

  async ready() {
    await this.readyPromise;
    return this;
  },

  prepare(sql) {
    assertSql(sql);
    if (!db || typeof db.prepare !== 'function') {
      throw new Error('[DataAccess] Prepared statements are unavailable from this provider.');
    }
    return db.prepare(sql);
  },

  queryOne(sql, params = []) {
    return this.prepare(sql).get(...normalizeParams(params));
  },

  queryMany(sql, params = []) {
    return this.prepare(sql).all(...normalizeParams(params));
  },

  execute(sql, params = []) {
    return this.prepare(sql).run(...normalizeParams(params));
  },

  exec(sql) {
    assertSql(sql);
    if (!db || typeof db.exec !== 'function') {
      throw new Error('[DataAccess] Raw schema execution is unavailable from this provider.');
    }
    return db.exec(sql);
  }
};

module.exports = DataAccess;
