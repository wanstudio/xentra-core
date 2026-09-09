'use strict';

/**
 * Xentra Core Data Access Boundary.
 *
 * Runtime/domain code should depend on this interface rather than importing
 * the concrete database implementation directly. The concrete provider stays
 * behind the boundary so a future client-resident connector can satisfy the
 * same domain-oriented data access contract without leaking SQL/storage
 * details into business logic.
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

  queryOne(sql, params = []) {
    assertSql(sql);
    const statement = db.prepare(sql);
    return statement.get(...normalizeParams(params));
  },

  queryMany(sql, params = []) {
    assertSql(sql);
    const statement = db.prepare(sql);
    return statement.all(...normalizeParams(params));
  },

  execute(sql, params = []) {
    assertSql(sql);
    const statement = db.prepare(sql);
    return statement.run(...normalizeParams(params));
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
