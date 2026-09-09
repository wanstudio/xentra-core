'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PosOrderRepository = require('../../core/data/repositories/PosOrderRepository');

function makeDataAccess(expected) {
  return {
    queryOne(sql, params) {
      expected.one.push({ sql, params });
      return expected.oneResult;
    },
    execute(sql, params) {
      expected.execute.push({ sql, params });
      return expected.executeResult || { changes: 1 };
    }
  };
}

test('PosOrderRepository exposes held-order lookups through the data boundary', () => {
  const calls = { one: [], execute: [], oneResult: { id: 'held-1', status: 'held' } };
  const repo = new PosOrderRepository(makeDataAccess(calls));

  assert.equal(repo.findHeldById('held-1').id, 'held-1');
  assert.deepEqual(calls.one[0].params, ['held-1']);

  calls.oneResult = { id: 'held-2', table_number: 'A1' };
  assert.equal(repo.findActiveHeldByTable({ branchId: 'branch-1', tableNumber: 'A1' }).id, 'held-2');
  assert.deepEqual(calls.one[1].params, ['branch-1', 'A1']);
});

test('PosOrderRepository exposes semantic held-order mutations', () => {
  const calls = { one: [], execute: [], executeResult: { changes: 1 } };
  const repo = new PosOrderRepository(makeDataAccess(calls));

  repo.insertHeldOrder({
    id: 'held-1',
    branchId: 'branch-1',
    tableNumber: 'A1',
    customerName: 'Tamu',
    itemsPayload: '[]',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.updateHeldItems({ heldOrderId: 'held-1', itemsPayload: '[1]', updatedAt: '2026-09-10T00:01:00.000Z' });
  repo.cancelHeldOrder({ heldOrderId: 'held-1', updatedAt: '2026-09-10T00:02:00.000Z' });

  assert.equal(calls.execute.length, 3);
  assert.match(calls.execute[0].sql, /INSERT INTO pos_held_orders/);
  assert.match(calls.execute[1].sql, /UPDATE pos_held_orders/);
  assert.match(calls.execute[2].sql, /SET status =/);
});
