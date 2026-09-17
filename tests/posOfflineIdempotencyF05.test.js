'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const { OfflineReconciliationService, PosShiftService } = require('../domains/pos');
const { OrderPlacementService } = require('../domains/commerce');
const { OrderRepository } = require('../core/data/repositories');

const orderRepository = new OrderRepository();

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_f05', 'Holding F05', 'org-f05')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_f05', 'org_f05', 'Brand F05', 'brand-f05')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_f05_a', 'brand_f05', 'Cabang F05 A', 'cabang-f05-a', '62811111111', 'Jl. Cabang A', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_f05_b', 'brand_f05', 'Cabang F05 B', 'cabang-f05-b', '62822222222', 'Jl. Cabang B', -7.26, 112.76)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_f05', 'brand_f05', 'Kategori F05', 'kategori-f05')`).run();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active)
      VALUES 
        ('prod_f05_1', 'brand_f05', 'cat_f05', 'Menu F05 1', 'menu-f05-1', 25000, 'lock', 1),
        ('prod_f05_2', 'brand_f05', 'cat_f05', 'Menu F05 2', 'menu-f05-2', 15000, 'lock', 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_f05_a', 'prod_f05_1', NULL, 100, 1, 5),
        ('branch_f05_a', 'prod_f05_2', NULL, 100, 1, 5),
        ('branch_f05_b', 'prod_f05_1', NULL, 100, 1, 5),
        ('branch_f05_b', 'prod_f05_2', NULL, 100, 1, 5)
    `).run();
  } catch (e) {
    console.error('F05 Seed Error:', e.message);
  }
});

test.beforeEach(() => {
  try {
    db.prepare('UPDATE branch_products SET stock = 100 WHERE branch_id IN ("branch_f05_a", "branch_f05_b")').run();
  } catch (_) {}
});

test('F05-01: Same branch + same client_transaction_id repeated request results in exactly one order', async () => {
  const clientTxId = 'tx_f05_01_' + Date.now();
  const payload = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 1, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };

  const res1 = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(res1.status, 'PROCESSED');
  assert.ok(res1.order && res1.order.id);

  const res2 = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');
  assert.strictEqual(res2.order.id, res1.order.id);

  const orders = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').all('branch_f05_a', clientTxId);
  assert.strictEqual(orders.length, 1, 'Exactly one order must exist for the repeated request');
});

test('F05-02: Different branch + same client_transaction_id allows separate transactions (branch-scoped)', async () => {
  const clientTxId = 'tx_f05_02_cross_' + Date.now();

  const payloadBranchA = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 1, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };

  const payloadBranchB = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_b',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 1, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };

  const resA = await OfflineReconciliationService.reconcileOfflineTransaction(payloadBranchA);
  const resB = await OfflineReconciliationService.reconcileOfflineTransaction(payloadBranchB);

  assert.strictEqual(resA.status, 'PROCESSED');
  assert.strictEqual(resB.status, 'PROCESSED');
  assert.notStrictEqual(resA.order.id, resB.order.id, 'Orders across different branches must have distinct IDs');

  const orderA = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_f05_a', clientTxId);
  const orderB = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_f05_b', clientTxId);

  assert.ok(orderA && orderB);
  assert.strictEqual(orderA.branch_id, 'branch_f05_a');
  assert.strictEqual(orderB.branch_id, 'branch_f05_b');
  assert.strictEqual(orderA.client_transaction_id, clientTxId);
  assert.strictEqual(orderB.client_transaction_id, clientTxId);
});

test('F05-03: Two truly concurrent sync requests against same branch + same client_transaction_id yield exactly one order', async () => {
  const clientTxId = 'tx_f05_03_conc_' + Date.now();
  const payload = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_2', quantity: 1, expected_price: 15000 }],
    offline_created_at: new Date().toISOString()
  };

  const [res1, res2] = await Promise.all([
    OfflineReconciliationService.reconcileOfflineTransaction(payload),
    OfflineReconciliationService.reconcileOfflineTransaction(payload)
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepStrictEqual(statuses, ['DUPLICATE_IGNORED', 'PROCESSED'], 'One request processes and the concurrent duplicate is ignored');

  const orders = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').all('branch_f05_a', clientTxId);
  assert.strictEqual(orders.length, 1, 'Exactly one order must exist after concurrent sync');
});

test('F05-04: Concurrent duplicate sync produces exactly one stock deduction', async () => {
  db.prepare('UPDATE branch_products SET stock = 60 WHERE branch_id = ? AND product_id = ?').run('branch_f05_a', 'prod_f05_1');

  const clientTxId = 'tx_f05_04_stock_' + Date.now();
  const payload = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 3, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };

  const [res1, res2] = await Promise.all([
    OfflineReconciliationService.reconcileOfflineTransaction(payload),
    OfflineReconciliationService.reconcileOfflineTransaction(payload)
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepStrictEqual(statuses, ['DUPLICATE_IGNORED', 'PROCESSED']);

  // Stock must be deducted exactly once: 60 - 3 = 57 (not 54)
  const stockRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_f05_a', 'prod_f05_1');
  assert.strictEqual(stockRow.stock, 57, 'Stock must be deducted exactly once despite concurrent duplicate');

  // Verify inventory_movements has exactly one entry referencing this order
  const order = db.prepare('SELECT id, order_number FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_f05_a', clientTxId);
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE branch_id = ? AND reference_id = ?').all('branch_f05_a', order.order_number);
  assert.strictEqual(movements.length, 1, 'Only one stock deduction movement must be recorded');
  assert.strictEqual(Math.abs(movements[0].quantity), 3);
});

test('F05-05: Retry after failed/rolled-back first transaction can succeed', async () => {
  // Set stock to 0 to force an immediate stock shortage rollback on attempt 1
  db.prepare('UPDATE branch_products SET stock = 0 WHERE branch_id = ? AND product_id = ?').run('branch_f05_a', 'prod_f05_2');

  const clientTxId = 'tx_f05_05_retry_' + Date.now();
  const payload = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_2', quantity: 1, expected_price: 15000 }],
    offline_created_at: new Date().toISOString()
  };

  // Attempt 1: fails due to out of stock
  const failRes = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(failRes.status, 'ERROR');

  // Ensure no order was created during the failed transaction
  const countBefore = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_f05_a', clientTxId).cnt;
  assert.strictEqual(countBefore, 0, 'Rolled back transaction must leave 0 orders in database');

  // Restock and retry with the SAME client_transaction_id
  db.prepare('UPDATE branch_products SET stock = 10 WHERE branch_id = ? AND product_id = ?').run('branch_f05_a', 'prod_f05_2');

  const retryRes = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(retryRes.status, 'PROCESSED', 'Retry after rollback must be able to succeed');
  assert.ok(retryRes.order && retryRes.order.id);

  const countAfter = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_f05_a', clientTxId).cnt;
  assert.strictEqual(countAfter, 1, 'Exactly one order created after successful retry');
});

test('F05-06: Idempotency is based on real client_transaction_id column, not order_note text', async () => {
  const colTxId = 'tx_col_real_' + Date.now();

  // 1. Order with client_transaction_id column populated, but order_note has no TX_ID string
  const customNoteOrder = {
    client_transaction_id: colTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 1, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };
  const res1 = await OfflineReconciliationService.reconcileOfflineTransaction(customNoteOrder);
  assert.strictEqual(res1.status, 'PROCESSED');

  // Mutate order_note in DB to confirm text matching is not used
  db.prepare('UPDATE orders SET order_note = ? WHERE id = ?').run('Catatan bebas tanpa format TX', res1.order.id);

  // Syncing same client_transaction_id must still be recognized as duplicate based on the database column
  const res2 = await OfflineReconciliationService.reconcileOfflineTransaction(customNoteOrder);
  assert.strictEqual(res2.status, 'DUPLICATE_IGNORED', 'Must deduplicate via real column even when order_note has arbitrary text');
  assert.strictEqual(res2.order.id, res1.order.id);

  // 2. Order with fake [TX_ID:fake_123] inside order_note, but client_transaction_id is DIFFERENT
  const unrelatedTx = 'tx_unrelated_' + Date.now();
  const fakeNoteTx = 'tx_fake_in_note_' + Date.now();
  const fakeOrdId = 'ord_fake_note_' + Date.now();
  const fakeOrdNum = 'NUM-FAKE-' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, client_transaction_id, customer_name, customer_phone, order_type, subtotal, grand_total, status, order_note)
    VALUES (?, ?, 'brand_f05', 'branch_f05_a', ?, 'Customer', '0812', 'dine_in', 25000, 25000, 'pending', ?)
  `).run(fakeOrdId, fakeOrdNum, unrelatedTx, `POS Offline Sync [TX_ID:${fakeNoteTx}]`);

  // Querying by fakeNoteTx must NOT find the order because the column does not match
  const foundByFake = orderRepository.findByBranchTransactionId('branch_f05_a', fakeNoteTx);
  assert.strictEqual(foundByFake, undefined, 'Must not match on text inside order_note');
});

test('F05-07: Normal orders with NULL client_transaction_id remain valid and do not collide', () => {
  const insertStmt = db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, client_transaction_id, customer_name, customer_phone, order_type, subtotal, grand_total, status)
    VALUES (?, ?, 'brand_f05', 'branch_f05_a', NULL, 'Customer Null', '0812999', 'delivery', 10000, 10000, 'pending')
  `);

  const id1 = 'ord_null_' + Date.now() + '_1';
  const id2 = 'ord_null_' + Date.now() + '_2';
  const num1 = 'NUM-NULL-1-' + Date.now();
  const num2 = 'NUM-NULL-2-' + Date.now();

  assert.doesNotThrow(() => {
    insertStmt.run(id1, num1);
    insertStmt.run(id2, num2);
  }, 'Multiple rows with NULL client_transaction_id must not violate unique index');

  const o1 = db.prepare('SELECT id, client_transaction_id FROM orders WHERE id = ?').get(id1);
  const o2 = db.prepare('SELECT id, client_transaction_id FROM orders WHERE id = ?').get(id2);
  assert.strictEqual(o1.client_transaction_id, null);
  assert.strictEqual(o2.client_transaction_id, null);
});

test('F05-08: Database uniqueness constraint actively rejects duplicate (branch_id, client_transaction_id)', () => {
  const clientTxId = 'tx_f05_08_raw_' + Date.now();

  const insertStmt = db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, client_transaction_id, customer_name, customer_phone, order_type, subtotal, grand_total, status)
    VALUES (?, ?, 'brand_f05', 'branch_f05_a', ?, 'Customer Raw', '0812888', 'dine_in', 20000, 20000, 'pending')
  `);

  insertStmt.run('ord_raw_1_' + Date.now(), 'NUM-RAW-1-' + Date.now(), clientTxId);

  // Attempting second insert with exact same branch_id and client_transaction_id must throw UNIQUE constraint failure
  assert.throws(() => {
    insertStmt.run('ord_raw_2_' + Date.now(), 'NUM-RAW-2-' + Date.now(), clientTxId);
  }, (err) => {
    return err.message && (
      err.message.includes('UNIQUE constraint failed') ||
      err.message.includes('idx_orders_branch_client_tx')
    );
  }, 'Raw SQL insert with duplicate (branch_id, client_transaction_id) must be rejected by database');
});

test('F05-09: Duplicate request returns the original authoritative order and attributes', async () => {
  const clientTxId = 'tx_f05_09_orig_' + Date.now();
  const payload = {
    client_transaction_id: clientTxId,
    brand_id: 'brand_f05',
    branch_id: 'branch_f05_a',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_f05_1', quantity: 2, expected_price: 25000 }],
    offline_created_at: new Date().toISOString()
  };

  const originalRes = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(originalRes.status, 'PROCESSED', `Expected PROCESSED but got ${originalRes.status}: ${JSON.stringify(originalRes)}`);
  const originalOrder = originalRes.order;

  // Duplicate request
  const dupRes = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(dupRes.status, 'DUPLICATE_IGNORED');
  assert.strictEqual(dupRes.order.id, originalOrder.id);
  assert.strictEqual(dupRes.order.order_number, originalOrder.order_number);
  assert.strictEqual(dupRes.order.grand_total, originalOrder.grand_total);
  assert.strictEqual(dupRes.order.branch_id, 'branch_f05_a');
});

test('F05-10: Authorized branch scope cannot be bypassed by changing client-supplied branch_id', async () => {
  const clientTxId = 'tx_f05_10_scope_' + Date.now();

  // In batch sync, branch_id parameter to processBatchSync authoritatively binds all transactions
  const batchResult = await OfflineReconciliationService.processBatchSync({
    branch_id: 'branch_f05_a',
    transactions: [
      {
        client_transaction_id: clientTxId,
        brand_id: 'brand_f05',
        branch_id: 'branch_f05_b', // Client tries to claim branch_b inside payload
        order_type: 'dine_in',
        payment_method: 'cash',
        items: [{ product_id: 'prod_f05_1', quantity: 1, expected_price: 25000 }],
        offline_created_at: new Date().toISOString()
      }
    ]
  });

  assert.strictEqual(batchResult.processed, 1);
  const createdOrder = db.prepare('SELECT branch_id FROM orders WHERE client_transaction_id = ?').get(clientTxId);
  assert.strictEqual(createdOrder.branch_id, 'branch_f05_a', 'Transaction must be scoped to authoritative branch_f05_a, not client spoofed branch_f05_b');

  // Direct reconcileOfflineTransaction without valid branch_id must be rejected
  await assert.rejects(async () => {
    await OfflineReconciliationService.reconcileOfflineTransaction({
      client_transaction_id: 'tx_invalid_branch_' + Date.now(),
      brand_id: 'brand_f05',
      branch_id: '', // empty/invalid
      items: [{ product_id: 'prod_f05_1', quantity: 1 }]
    });
  }, /branch_id/i);
});
