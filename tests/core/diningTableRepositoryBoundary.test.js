'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('DiningTableRepository exposes semantic layout/state lookups', () => {
  const calls = {
    one: [], many: [], execute: [], exec: [],
    oneResult: { id: 'layout-1' },
    manyResult: [{ id: 'table-1', operational_state: 'available' }]
  };
  const repo = new DiningTableRepository(makeDataAccess(calls));

  assert.equal(repo.findBranchLayout('branch-1').id, 'layout-1');
  assert.equal(repo.findActiveTables('branch-1').length, 1);
  assert.equal(repo.findTableForBranch('table-1', 'branch-1').id, 'layout-1');
  assert.equal(calls.one.length, 2);
  assert.equal(calls.many.length, 1);
});

test('DiningTableRepository exposes semantic hold and session persistence operations', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: { current_session_id: 'sess-1', operational_state: 'held' }, executeResult: { changes: 1 } };
  const repo = new DiningTableRepository(makeDataAccess(calls));

  repo.upsertBranchLayout({
    layoutId: 'layout-1', branchId: 'branch-1', canvasConfig: '{}', sectionsConfig: '[]',
    nonTableObjectsConfig: '[]', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.upsertBranchTable({
    tableId: 'table-1', branchId: 'branch-1', tableNumber: '1', label: '1', capacity: 4,
    sectionId: null, x: 0, y: 0, width: 80, height: 80, shape: 'rect', orientation: 0,
    qrToken: 'qr-1', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.ensureTableState({ tableId: 'table-1', operationalState: 'available', updatedAt: '2026-09-10T00:00:00.000Z' });
  repo.updateTableState({ tableId: 'table-1', operationalState: 'held', currentSessionId: null, notes: 'Payment hold', updatedAt: '2026-09-10T00:00:00.000Z' });
  repo.insertHold({
    holdId: 'hold-1', branchId: 'branch-1', tableId: 'table-1', customerPhone: '0812',
    holdReferenceId: 'ord-1', expiresAt: '2026-09-10T00:15:00.000Z',
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.updateHoldStatus({ holdId: 'hold-1', status: 'converted', updatedAt: '2026-09-10T00:01:00.000Z' });
  repo.createDiningSession({
    sessionId: 'sess-1', branchId: 'branch-1', customerName: 'Tamu', customerPhone: '0812',
    guestCount: 2, openedAt: '2026-09-10T00:01:00.000Z', updatedAt: '2026-09-10T00:01:00.000Z'
  });
  repo.attachDiningSessionTable({ mappingId: 'map-1', sessionId: 'sess-1', tableId: 'table-1', attachedAt: '2026-09-10T00:01:00.000Z' });
  repo.associateOrderToDiningSession({ orderId: 'ord-1', sessionId: 'sess-1', updatedAt: '2026-09-10T00:01:00.000Z' });
  repo.completeDiningSession({ sessionId: 'sess-1', closedAt: '2026-09-10T00:02:00.000Z', updatedAt: '2026-09-10T00:02:00.000Z' });
  repo.deleteDiningSessionTables('sess-1');
  repo.resolveQr('qr-1');
  repo.regenerateQrToken({ tableId: 'table-1', qrToken: 'qr-2', updatedAt: '2026-09-10T00:03:00.000Z' });

  assert.equal(calls.execute.length, 12);
  assert.match(calls.execute[0].sql, /branch_dining_layouts/);
  assert.match(calls.execute[1].sql, /branch_tables/);
  assert.match(calls.execute[4].sql, /branch_table_holds/);
  assert.match(calls.execute[5].sql, /branch_table_holds/);
  assert.match(calls.execute[6].sql, /dining_sessions/);
  assert.match(calls.execute[7].sql, /dining_session_tables/);
  assert.match(calls.execute[8].sql, /UPDATE orders/);
  assert.match(calls.execute[9].sql, /UPDATE dining_sessions/);
  assert.match(calls.execute[10].sql, /DELETE FROM dining_session_tables/);
  assert.match(calls.execute[11].sql, /UPDATE branch_tables/);
});

test('DiningTableRepository owns transaction primitives used by the service boundary', () => {
  const calls = { one: [], many: [], execute: [], exec: [] };
  const repo = new DiningTableRepository(makeDataAccess(calls));

  repo.beginTransaction();
  repo.commitTransaction();
  repo.rollbackTransaction();

  assert.deepEqual(calls.exec, ['BEGIN IMMEDIATE;', 'COMMIT;', 'ROLLBACK;']);
});
