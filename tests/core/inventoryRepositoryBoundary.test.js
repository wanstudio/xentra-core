'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const InventoryRepository = require('../../core/data/repositories/InventoryRepository');

function makeDataAccess(calls) {
  return {
    queryOne(sql, params) {
      calls.one.push({ sql, params });
      return calls.oneResult;
    },
    queryMany(sql, params) {
      calls.many.push({ sql, params });
      return calls.manyResult || [];
    },
    execute(sql, params) {
      calls.execute.push({ sql, params });
      return calls.executeResult || { changes: 1 };
    },
    exec(sql) {
      calls.exec.push(sql);
      return undefined;
    }
  };
}

test('InventoryRepository exposes purchase-order persistence operations', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: null, manyResult: [] };
  const repo = new InventoryRepository(makeDataAccess(calls));

  repo.beginTransaction();
  repo.insertPurchaseOrder({
    id: 'po-1', poNumber: 'PO-1', brandId: 'brand-1', branchId: 'branch-1',
    supplierName: 'Supplier', createdBy: 'user-1', notes: 'note',
    orderedAt: '2026-09-10T00:00:00.000Z', createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.insertPurchaseOrderItem({
    id: 'poi-1', poId: 'po-1', productId: 'product-1', quantity: 5, unitCost: 10000
  });
  assert.equal(calls.exec[0], 'BEGIN IMMEDIATE;');
  assert.match(calls.execute[0].sql, /inventory_purchase_orders/);
  assert.match(calls.execute[1].sql, /inventory_po_items/);

  calls.oneResult = { id: 'po-1', status: 'pending' };
  assert.equal(repo.findPurchaseOrderById('po-1').id, 'po-1');
  calls.manyResult = [{ product_id: 'product-1', quantity: 5, received_quantity: 0 }];
  assert.equal(repo.findPurchaseOrderItems('po-1').length, 1);

  repo.updatePurchaseOrderItemReceivedQuantity({ poId: 'po-1', productId: 'product-1', receivedQuantity: 4 });
  repo.markPurchaseOrderReceived({
    poId: 'po-1', receivedBy: 'user-1',
    receivedAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.commitTransaction();

  assert.match(calls.execute[2].sql, /inventory_po_items/);
  assert.match(calls.execute[3].sql, /inventory_purchase_orders/);
  assert.equal(calls.exec.at(-1), 'COMMIT;');
});

test('InventoryRepository preserves branch stock mutation and ledger operations', () => {
  const calls = { one: [], many: [], execute: [], exec: [], oneResult: { stock: 10 } };
  const repo = new InventoryRepository(makeDataAccess(calls));

  assert.equal(repo.getStock('branch-1', 'product-1'), 10);
  repo.updateBranchProductStock({
    branchId: 'branch-1', productId: 'product-1', stock: 15,
    updatedAt: '2026-09-10T00:00:00.000Z'
  });
  repo.insertMovement({
    id: 'mov-1', branchId: 'branch-1', productId: 'product-1',
    movementType: 'purchase_in', quantity: 5, previousStock: 10, currentStock: 15,
    referenceId: 'PO-1', actorId: 'user-1', notes: 'received',
    createdAt: '2026-09-10T00:00:00.000Z'
  });

  assert.match(calls.execute[0].sql, /UPDATE branch_products/);
  assert.match(calls.execute[1].sql, /INSERT INTO inventory_movements/);
  assert.deepEqual(calls.execute[0].params, ['15', '2026-09-10T00:00:00.000Z', 'branch-1', 'product-1']);
});
