'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OrderRepository = require('../../core/data/repositories/OrderRepository');
const PaymentRepository = require('../../core/data/repositories/PaymentRepository');
const DiningTableRepository = require('../../core/data/repositories/DiningTableRepository');

function makeDataAccess(expected) {
  return {
    queryOne(sql, params) {
      expected.one.push({ sql, params });
      return expected.oneResult;
    },
    queryMany(sql, params) {
      expected.many.push({ sql, params });
      return expected.manyResult || [];
    },
    execute(sql, params) {
      expected.execute.push({ sql, params });
      return expected.executeResult || { changes: 1 };
    }
  };
}

test('OrderRepository exposes semantic order persistence operations', () => {
  const calls = { one: [], many: [], execute: [], oneResult: { id: 'ord-1' } };
  const repo = new OrderRepository(makeDataAccess(calls));

  assert.equal(repo.findByBranchTransactionId('branch-1', 'tx-1').id, 'ord-1');
  assert.deepEqual(calls.one[0].params, ['branch-1', 'tx-1']);

  calls.oneResult = { count: 4 };
  assert.equal(repo.countActiveReservations({ branchId: 'branch-1', reservationDate: '2026-09-11' }), 4);
});

test('PaymentRepository keeps gateway configuration persistence behind a semantic boundary', () => {
  const calls = { one: [], many: [], execute: [], oneResult: { default_payment_config: '{"server_key":"test"}' } };
  const repo = new PaymentRepository(makeDataAccess(calls));

  const config = repo.findBrandPaymentConfig('brand-1');
  assert.equal(config.default_payment_config, '{"server_key":"test"}');
  assert.deepEqual(calls.one[0].params, ['brand-1']);
});

test('DiningTableRepository exposes table state and hold lookups semantically', () => {
  const calls = { one: [], many: [], execute: [], oneResult: { operational_state: 'available' }, manyResult: [] };
  const repo = new DiningTableRepository(makeDataAccess(calls));

  assert.equal(repo.findTableForBranch('table-1', 'branch-1').operational_state, 'available');
  assert.equal(repo.findActiveTables('branch-1').length, 0);
  assert.equal(calls.one.length, 1);
  assert.equal(calls.many.length, 1);
});
