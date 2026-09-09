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
    },
    exec(sql) {
      expected.exec.push(sql);
      return undefined;
    }
  };
}

test('OrderRepository exposes semantic order persistence operations', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: { id: 'ord-1' } };
  const repo = new OrderRepository(makeDataAccess(calls));

  assert.equal(repo.findByBranchTransactionId('branch-1', 'tx-1').id, 'ord-1');
  assert.deepEqual(calls.one[0].params, ['branch-1', 'tx-1']);

  calls.oneResult = { count: 4 };
  assert.equal(repo.countActiveReservations({ branchId: 'branch-1', reservationDate: '2026-09-11' }), 4);
});

test('PaymentRepository keeps gateway configuration persistence behind a semantic boundary', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: { default_payment_config: '{"server_key":"test"}' } };
  const repo = new PaymentRepository(makeDataAccess(calls));

  const config = repo.findBrandPaymentConfig('brand-1');
  assert.equal(config.default_payment_config, '{"server_key":"test"}');
  assert.deepEqual(calls.one[0].params, ['brand-1']);
});

test('PaymentRepository exposes settlement persistence and transaction operations', () => {
  const calls = {
    one: [], many: [], execute: [], exec: [],
    oneResult: { status: 'pending' },
    manyResult: [{ order_id: 'ord-1' }],
    executeResult: { changes: 1 }
  };
  const repo = new PaymentRepository(makeDataAccess(calls));

  repo.beginTransaction();
  repo.updatePaymentWebhook({
    orderId: 'ord-1', paymentStatus: 'settlement', webhookResponse: '{}',
    settledAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.markFulfillmentException({ orderId: 'ord-1', note: 'refund', updatedAt: '2026-09-10T00:00:00.000Z' });
  repo.cancelPendingOrder({ orderId: 'ord-1', updatedAt: '2026-09-10T00:00:00.000Z' });
  assert.equal(repo.findPendingReconciliationPayments().length, 1);
  repo.commitTransaction();

  assert.deepEqual(calls.exec, ['BEGIN IMMEDIATE;', 'COMMIT;']);
  assert.equal(calls.execute.length, 3);
  assert.match(calls.execute[0].sql, /order_payments/);
  assert.match(calls.execute[1].sql, /fulfillment_exception/);
  assert.match(calls.execute[2].sql, /UPDATE orders/);
});

test('DiningTableRepository exposes table state and hold lookups semantically', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: { operational_state: 'available' }, manyResult: [] };
  const repo = new DiningTableRepository(makeDataAccess(calls));

  assert.equal(repo.findTableForBranch('table-1', 'branch-1').operational_state, 'available');
  assert.equal(repo.findActiveTables('branch-1').length, 0);
  assert.equal(calls.one.length, 1);
  assert.equal(calls.many.length, 1);
});
