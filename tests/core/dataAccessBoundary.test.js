'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DataAccess = require('../../core/data/DataAccess');

test('DataAccess boundary exposes the shared provider through the approved facade', async () => {
  await DataAccess.ready();

  const row = DataAccess.queryOne('SELECT 1 AS alive');
  assert.equal(row.alive, 1);
});

test('DataAccess boundary rejects empty SQL', () => {
  assert.throws(() => DataAccess.queryOne(''), /sql must be a non-empty string/);
  assert.throws(() => DataAccess.execute('   '), /sql must be a non-empty string/);
});
