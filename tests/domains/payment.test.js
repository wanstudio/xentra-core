'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../../server/database/db');
const { domain, events } = require('../../core');
const {
  PaymentModel,
  CashSettlementService,
  PaymentGatewayService,
  identity,
  capabilities
} = require('../../domains/payment');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_pay', 'Holding Payment', 'org-pay')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug, default_payment_config) VALUES ('brand_pay', 'org_pay', 'Brand Pay', 'brand-pay', '{"server_key":"SB-Mid-server-test12345","client_key":"SB-Mid-client-123","merchant_id":"M12345"}')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_pay', 'brand_pay', 'Cabang Pay', 'cabang-pay', '62812345678', 'Jl. Pay', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_pay_other', 'brand_pay', 'Cabang Lain', 'cabang-lain', '62812345679', 'Jl. Lain', -7.26, 112.76)`).run();

    db.prepare(`
      INSERT OR REPLACE INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, expected_cash, status)
      VALUES 
        ('shift_pay_open', 'branch_pay', 'cashier_pay', 100000, 0, 100000, 'open'),
        ('shift_pay_closed', 'branch_pay', 'cashier_pay', 100000, 0, 100000, 'closed'),
        ('shift_other_branch', 'branch_pay_other', 'cashier_other', 100000, 0, 100000, 'open')
    `).run();
  } catch (e) {
    console.error('Payment seed error:', e.message);
  }
});

// ==============================================================================
// Payment 1 — Domain Registration & Declaration
// ==============================================================================
test('Payment 1 — Domain Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'payment');
  assert.strictEqual(capabilities.events_produced.includes('payment.settled'), true);
  assert.strictEqual(capabilities.events_produced.includes('payment.failed'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('payment'), true);
});

// ==============================================================================
// Payment 2 — Cash Settlement & Event Emission
// ==============================================================================
test('Payment 2 — Cash Settlement: creates payment record and emits payment.settled', async () => {
  const orderId = `ord_test_cash_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-CASH-1', 'brand_pay', 'branch_pay', 'Budi Cash', '62812345678', 'dine_in', 'pos_cashier', 50000, 50000, 'cash', 'pending')
  `).run(orderId);

  let settledEvent = null;
  events.EventBus.subscribe('payment.settled', (evt) => {
    if (evt.payload.order_id === orderId) {
      settledEvent = evt;
    }
  });

  const result = CashSettlementService.settleCashPayment({
    order_id: orderId,
    amount: 50000,
    amount_tendered: 100000,
    cashier_id: 'cashier_pay',
    shift_id: 'shift_pay_open'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.payment_status, 'settlement');
  assert.strictEqual(result.change, 50000);

  // Check order_payments record
  const payRecord = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(orderId);
  assert.ok(payRecord);
  assert.strictEqual(payRecord.payment_status, 'settlement');
  assert.strictEqual(payRecord.provider, 'cash');

  // Check pos_shifts table: total_cash_sales and expected_cash incremented atomically
  const shiftRecord = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get('shift_pay_open');
  assert.strictEqual(shiftRecord.total_cash_sales, 50000);
  assert.strictEqual(shiftRecord.expected_cash, 150000);

  // Check order status
  const orderRecord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderRecord.status, 'confirmed');

  // Verify Event
  assert.ok(settledEvent);
  assert.strictEqual(settledEvent.payload.order_id, orderId);
  assert.strictEqual(settledEvent.payload.provider, 'cash');

  // Verify Amount-Bound Guard: strictly rejects mismatching amount
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: 1, // Mismatch against grand_total 50000
      amount_tendered: 1000
    });
  }, /tidak sesuai dengan total tagihan order/);

  // Verify Shift Boundary Guard: strictly rejects closed shift or other branch shift
  const newOrderId = `ord_test_cross_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-CASH-CROSS', 'brand_pay', 'branch_pay', 'Budi Cross', '62812345678', 'dine_in', 'pos_cashier', 25000, 25000, 'cash', 'pending')
  `).run(newOrderId);

  // 1. Closed shift rejected
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: newOrderId,
      amount: 25000,
      amount_tendered: 25000,
      shift_id: 'shift_pay_closed'
    });
  }, /sudah ditutup/);

  // 2. Cross-branch shift rejected
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: newOrderId,
      amount: 25000,
      amount_tendered: 25000,
      shift_id: 'shift_other_branch'
    });
  }, /tidak sesuai dengan cabang order/);

  // 3. Impersonating other cashier shift rejected
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: newOrderId,
      amount: 25000,
      amount_tendered: 25000,
      cashier_id: 'cashier_impostor',
      shift_id: 'shift_pay_open'
    });
  }, /bukan milik kasir yang sedang login/);

  // 4. Online Payment (Midtrans) Order Rejected for Cash Settlement (NEW-01)
  const onlineOrderId = `ord_test_online_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-ONLINE-1', 'brand_pay', 'branch_pay', 'Budi Online', '62812345678', 'delivery', 'customer_app', 60000, 60000, 'midtrans', 'pending')
  `).run(onlineOrderId);

  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: onlineOrderId,
      amount: 60000,
      amount_tendered: 60000
    });
  }, /menggunakan metode pembayaran online "midtrans"/);

  // 5. Cancelled Order Rejected for Cash Settlement (NEW-01)
  const cancelledOrderId = `ord_test_canc_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-CANC-1', 'brand_pay', 'branch_pay', 'Budi Batal', '62812345678', 'pickup', 'customer_app', 30000, 30000, 'cash', 'cancelled')
  `).run(cancelledOrderId);

  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: cancelledOrderId,
      amount: 30000,
      amount_tendered: 30000
    });
  }, /sudah dibatalkan\/kadaluarsa/);

  // Verify Idempotency Guard: second cash settlement returns idempotent: true without duplicate mutations
  const secondResult = CashSettlementService.settleCashPayment({
    order_id: orderId,
    amount: 50000,
    amount_tendered: 50000
  });
  assert.strictEqual(secondResult.success, true);
  assert.strictEqual(secondResult.idempotent, true);
});

// ==============================================================================
// Payment 3 — Midtrans Webhook Signature Verification & Idempotency
// ==============================================================================
test('Payment 3 — Midtrans Webhook: verifies SHA512 signature, advances status & drops duplicate', async () => {
  const orderId = `ord_test_mid_${Date.now()}`;
  const orderNumber = `XN-MID-${Date.now()}`;

  // Seed product and branch stock
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, name, slug, price)
    VALUES ('prod_mid_1', 'brand_pay', 'Nasi Goreng Midtrans', 'nasgor-mid', 75000)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available)
    VALUES ('branch_pay', 'prod_mid_1', 10, 1)
  `).run();

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Siti Online', '62812345678', 'delivery', 'customer_app', 75000, 75000, 'midtrans', 'pending')
  `).run(orderId, orderNumber);

  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES ('item_mid_1', ?, 'prod_mid_1', 'Nasi Goreng Midtrans', 75000, 2, 75000)
  `).run(orderId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES ('pay_mid_123', ?, 'midtrans', 'M12345', 'snap_token_123', 'pending', 75000)
  `).run(orderId);

  // 1. Calculate valid SHA512 signature
  const serverKey = 'SB-Mid-server-test12345';
  const statusCode = '200';
  const grossAmount = '75000.00';
  const rawSignature = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const validSignature = crypto.createHash('sha512').update(rawSignature).digest('hex');

  const webhookPayload = {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: validSignature,
    transaction_status: 'settlement',
    payment_type: 'qris'
  };

  // 2. Process valid Webhook
  const result = PaymentGatewayService.handleWebhook(webhookPayload);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.payment_status, 'settlement');

  // Verify order and payment status
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'confirmed');
  assert.strictEqual(order.payment_method, 'midtrans');

  const payRecord = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(payRecord.payment_status, 'settlement');
  assert.strictEqual(payRecord.payment_method, 'midtrans');

  // Verify Atomic Stock Deduction: 10 - 2 = 8
  const stockRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pay', 'prod_mid_1');
  assert.strictEqual(stockRow.stock, 8, 'Stock must be decremented from 10 to 8 on settlement');

  // Verify Inventory Movement Ledger
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').all(orderNumber);
  assert.strictEqual(movements.length, 1, 'Exactly one inventory ledger record must be written');
  assert.strictEqual(movements[0].quantity, -2);
  assert.strictEqual(movements[0].movement_type, 'sale_deduction');

  // 3. Idempotent Test: Same webhook sent a second time -> DROPPED (No duplicate deduction)
  const duplicateResult = PaymentGatewayService.handleWebhook(webhookPayload);
  assert.strictEqual(duplicateResult.success, true);
  assert.strictEqual(duplicateResult.idempotent, true);

  // Verify Stock is STILL 8 (Zero double-deduction)
  const stockRowAfterDup = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pay', 'prod_mid_1');
  assert.strictEqual(stockRowAfterDup.stock, 8, 'Duplicate webhook must not decrement stock twice');

  const movementsAfterDup = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').all(orderNumber);
  assert.strictEqual(movementsAfterDup.length, 1, 'Duplicate webhook must not write duplicate ledger rows');
});

// ==============================================================================
// Payment 4 — Invalid Webhook Signature Rejection
// ==============================================================================
test('Payment 4 — Midtrans Webhook: strictly rejects invalid SHA512 signature key', () => {
  const orderId = `ord_test_fake_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-FAKE-1', 'brand_pay', 'branch_pay', 'Hacker', '62812345678', 'delivery', 'customer_app', 10000, 10000, 'qris', 'pending')
  `).run(orderId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES ('pay_fake_123', ?, 'midtrans', 'M12345', 'snap_token_fake', 'pending', 10000)
  `).run(orderId);

  const fakeWebhookPayload = {
    order_id: orderId,
    status_code: '200',
    gross_amount: '10000.00',
    signature_key: 'fake_invalid_sha512_hash',
    transaction_status: 'settlement',
    payment_type: 'qris'
  };

  assert.throws(() => {
    PaymentGatewayService.handleWebhook(fakeWebhookPayload);
  }, /Signature webhook Midtrans tidak valid/);
});

// ==============================================================================
// Payment 5 — Concurrency Race: Stock Depleted on Settlement -> fulfillment_exception
// ==============================================================================
test('Payment 5 — Concurrency Race: Stock Depleted on Settlement marks fulfillment_exception without ledger corruption', () => {
  const orderId = `ord_test_race_${Date.now()}`;
  const orderNumber = `XN-RACE-${Date.now()}`;

  // Seed product and branch stock to ONLY 1
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, name, slug, price)
    VALUES ('prod_race_1', 'brand_pay', 'Bebek Goreng Langka', 'bebek-langka', 50000)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available)
    VALUES ('branch_pay', 'prod_race_1', 1, 1)
  `).run();

  // Order demands 3 items (stock is only 1)
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Race', '62812345678', 'delivery', 'customer_app', 150000, 150000, 'midtrans', 'pending')
  `).run(orderId, orderNumber);

  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES ('item_race_1', ?, 'prod_race_1', 'Bebek Goreng Langka', 50000, 3, 150000)
  `).run(orderId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES ('pay_race_123', ?, 'midtrans', 'M12345', 'snap_token_race', 'pending', 150000)
  `).run(orderId);

  const serverKey = 'SB-Mid-server-test12345';
  const statusCode = '200';
  const grossAmount = '150000.00';
  const rawSignature = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const validSignature = crypto.createHash('sha512').update(rawSignature).digest('hex');

  const webhookPayload = {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: validSignature,
    transaction_status: 'settlement',
    payment_type: 'qris'
  };

  const result = PaymentGatewayService.handleWebhook(webhookPayload);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.payment_status, 'settlement');
  assert.strictEqual(result.order_status, 'fulfillment_exception');

  // Verify DB state: order is fulfillment_exception, payment is settlement
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'fulfillment_exception');
  assert.ok(order.order_note.includes('[Kendala Stok / Perlu Refund]'));

  // Verify stock was NOT corrupted (remains 1)
  const stockRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pay', 'prod_race_1');
  assert.strictEqual(stockRow.stock, 1, 'Stock must not be subtracted or set to 0 when race condition occurs');

  // Verify NO invalid inventory ledger entry was created
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').all(orderNumber);
  assert.strictEqual(movements.length, 0, 'No false sale_deduction ledger entry allowed on out-of-stock race');
});

// ==============================================================================
// Payment 6 — Terminal State Invariant: Cannot revive cancelled / expired order
// ==============================================================================
test('Payment 6 — Terminal State Invariant: rejects settlement on cancelled / expired order', () => {
  const orderId = `ord_test_revive_${Date.now()}`;
  const orderNumber = `XN-REVIVE-${Date.now()}`;

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Expired', '62812345678', 'delivery', 'customer_app', 50000, 50000, 'midtrans', 'pending')
  `).run(orderId, orderNumber);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES ('pay_revive_123', ?, 'midtrans', 'M12345', 'snap_token_revive', 'pending', 50000)
  `).run(orderId);

  const serverKey = 'SB-Mid-server-test12345';
  const statusCode = '200';
  const grossAmount = '50000.00';

  // 1. First webhook: Expire payment
  const rawExpireSig = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const expireSig = crypto.createHash('sha512').update(rawExpireSig).digest('hex');

  PaymentGatewayService.handleWebhook({
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: expireSig,
    transaction_status: 'expire',
    payment_type: 'qris'
  });

  const expiredOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  const expiredPayment = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(expiredOrder.status, 'cancelled');
  assert.strictEqual(expiredPayment.payment_status, 'expire');

  // 2. Second webhook: Attempt settlement on expired/cancelled order -> STRICTLY REJECTED
  const rawSettleSig = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const settleSig = crypto.createHash('sha512').update(rawSettleSig).digest('hex');

  assert.throws(() => {
    PaymentGatewayService.handleWebhook({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: settleSig,
      transaction_status: 'settlement',
      payment_type: 'qris'
    });
  }, /Transisi status pembayaran tidak valid/);

  // Verify order remains cancelled
  const finalOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(finalOrder.status, 'cancelled');
});
