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
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Cash', '62812345678', 'dine_in', 'pos_cashier', 50000, 50000, 'cash', 'confirmed')
  `).run(orderId, `ORD-CASH-${Date.now()}`);

  // R5/CHECK-2: cash settlement is a PAYMENT mutation only and requires an
  // ACCEPTED order ('confirmed'). A pending order (AWAITING_BRANCH_ACCEPTANCE)
  // must be branch-accepted before cash is collected.
  const pendingCashOrderId = `ord_test_cash_pending_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Cash Pending', '62812345678', 'dine_in', 'customer_app', 40000, 40000, 'cash', 'pending')
  `).run(pendingCashOrderId, `ORD-CASH-PENDING-${Date.now()}`);
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: pendingCashOrderId,
      amount: 40000,
      amount_tendered: 40000,
      cashier_id: 'cashier_pay',
      shift_id: 'shift_pay_open'
    });
  }, /ORDER_NOT_ACCEPTED/);
  assert.strictEqual(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(pendingCashOrderId).status,
    'pending',
    'unaccepted order cannot be cash-settled'
  );

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

  // Check order status: settlement does NOT regress/advance order state — the
  // order stays 'confirmed' (already accepted); settlement is payment-only.
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
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Cross', '62812345678', 'dine_in', 'pos_cashier', 25000, 25000, 'cash', 'confirmed')
  `).run(newOrderId, `ORD-CASH-CROSS-${Date.now()}`);

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

  // 3.1 Concurrency Race Guard (NEW-01): Settlement strictly fails if shift closed concurrently
  const raceOrderId = `ord_test_race_close_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Race Close', '62812345678', 'dine_in', 'pos_cashier', 15000, 15000, 'cash', 'confirmed')
  `).run(raceOrderId, `ORD-RACE-CLOSE-${Date.now()}`);

  // Create temporary shift and close it immediately
  const tempShiftId = `shift_temp_race_${Date.now()}`;
  db.prepare(`
    INSERT INTO pos_shifts (id, branch_id, cashier_id, starting_float, status)
    VALUES (?, 'branch_pay', 'cashier_pay_race', 50000, 'closed')
  `).run(tempShiftId);

  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: raceOrderId,
      amount: 15000,
      amount_tendered: 15000,
      cashier_id: 'cashier_pay_race',
      shift_id: tempShiftId
    });
  }, /SHIFT_ALREADY_CLOSED|sudah ditutup/);

  // Assert order remains confirmed (accepted) and NOT regressed by the failed settlement
  const raceOrderAfter = db.prepare('SELECT status FROM orders WHERE id = ?').get(raceOrderId);
  assert.strictEqual(raceOrderAfter.status, 'confirmed');

  // 4. Online Payment (Midtrans) Order Rejected for Cash Settlement (NEW-01)
  //    (seeded as accepted 'confirmed' so the provider-conflict guard fires;
  //    the separate pending-guard is asserted earlier as ORDER_NOT_ACCEPTED)
  const onlineOrderId = `ord_test_online_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Online', '62812345678', 'delivery', 'customer_app', 60000, 60000, 'midtrans', 'confirmed')
  `).run(onlineOrderId, `ORD-ONLINE-${Date.now()}`);

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
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Batal', '62812345678', 'pickup', 'customer_app', 30000, 30000, 'cash', 'cancelled')
  `).run(cancelledOrderId, `ORD-CANC-${Date.now()}`);

  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: cancelledOrderId,
      amount: 30000,
      amount_tendered: 30000
    });
  }, /status terminal "cancelled"|sudah dibatalkan/);

  // 6. Missing / Invalid amount_tendered Rejected (NEW-01)
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: newOrderId,
      amount: 25000
      // amount_tendered omitted
    });
  }, /Nominal uang yang diterima \(amount_tendered\) wajib diisi/);

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
    VALUES (?, ?, 'prod_mid_1', 'Nasi Goreng Midtrans', 75000, 2, 75000)
  `).run(`item_mid_${Date.now()}`, orderId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_token_123', 'pending', 75000)
  `).run(`pay_mid_${Date.now()}`, orderId);

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
  // R5/CHECK-2: settlement NEVER transitions pending → confirmed; Branch ACCEPT
  // is the only acceptance path. The order stays AWAITING_BRANCH_ACCEPTANCE.
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'pending', 'payment settlement must not bypass Branch ACCEPT');
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
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Hacker', '62812345678', 'delivery', 'customer_app', 10000, 10000, 'qris', 'pending')
  `).run(orderId, `ORD-FAKE-${Date.now()}`);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_token_fake', 'pending', 10000)
  `).run(`pay_fake_${Date.now()}`, orderId);

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
    VALUES (?, ?, 'prod_race_1', 'Bebek Goreng Langka', 50000, 3, 150000)
  `).run(`item_race_${Date.now()}`, orderId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_token_race', 'pending', 150000)
  `).run(`pay_race_${Date.now()}`, orderId);

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
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_token_revive', 'pending', 50000)
  `).run(`pay_revive_${Date.now()}`, orderId);

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

// ==============================================================================
// Payment 7 — Midtrans Webhook: Strictly rejects amount mismatch (Finding 1 / Business Integrity)
// ==============================================================================
test('Payment 7 — Midtrans Webhook: strictly rejects amount mismatch even with valid cryptographic signature', () => {
  const orderId = `ord_test_mismatch_${Date.now()}`;
  const orderNumber = `XN-MISMATCH-${Date.now()}`;

  // Actual internal order is Rp 100.000
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Mismatch', '62812345678', 'delivery', 'customer_app', 100000, 100000, 'midtrans', 'pending')
  `).run(orderId, orderNumber);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_token_mismatch', 'pending', 100000)
  `).run(`pay_mismatch_${Date.now()}`, orderId);

  const serverKey = 'SB-Mid-server-test12345';
  const statusCode = '200';
  const spoofedGrossAmount = '50000.00'; // Only paid 50k instead of 100k

  // Valid cryptographic signature for the spoofed 50k amount
  const rawSig = `${orderId}${statusCode}${spoofedGrossAmount}${serverKey}`;
  const validCryptoSig = crypto.createHash('sha512').update(rawSig).digest('hex');

  // Attempt settlement with mismatched amount -> STRICTLY REJECTED by Business Integrity Guard
  assert.throws(() => {
    PaymentGatewayService.handleWebhook({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: spoofedGrossAmount,
      signature_key: validCryptoSig,
      transaction_status: 'settlement',
      payment_type: 'qris'
    });
  }, /PAYMENT_AMOUNT_MISMATCH/);

  // Assert order & payment remain pending and NOT confirmed
  const pendingOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  const pendingPayment = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(pendingOrder.status, 'pending');
  assert.strictEqual(pendingPayment.payment_status, 'pending');
});

// ==============================================================================
// Payment 8 — Cash Settlement: Payment ID Consistency & State Regression Guard
// ==============================================================================
test('Payment 8 — Cash Settlement: Preserves existing payment_id in events, prevents state regression, and rejects amount mismatch', async () => {
  const orderId = `ord_test_preserve_${Date.now()}`;
  const existingPayId = `pay_orig_${Date.now()}`;

  // 1. Order in 'preparing' state (in-flight kitchen order)
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Preparing', '62812345678', 'dine_in', 'pos_cashier', 80000, 80000, 'cash', 'preparing')
  `).run(orderId, `ORD-PREP-${Date.now()}`);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
    VALUES (?, ?, 'cash', 'cash', 'pending', 80000)
  `).run(existingPayId, orderId);

  let capturedEvent = null;
  events.EventBus.subscribe('payment.settled', (evt) => {
    if (evt.payload.order_id === orderId) {
      capturedEvent = evt;
    }
  });

  // 2. Settlement with amount mismatch -> REJECTED
  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: 50000, // Mismatched
      amount_tendered: 50000
    });
  }, /SETTLEMENT_AMOUNT_MISMATCH/);

  // 3. Settle with exact amount
  const result = CashSettlementService.settleCashPayment({
    order_id: orderId,
    amount: 80000,
    amount_tendered: 100000
  });

  assert.strictEqual(result.success, true);
  // Authoritative Payment ID Consistency
  assert.strictEqual(result.payment_id, existingPayId, 'Result must use existing payment_id');
  assert.ok(capturedEvent);
  assert.strictEqual(capturedEvent.payload.payment_id, existingPayId, 'Event must carry authoritative existing payment_id');

  // Authoritative State Regression Guard: Status must remain 'preparing' (not regressed to confirmed)
  const finalOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(finalOrder.status, 'preparing', 'Order status must NOT regress from preparing to confirmed');

  // 4. Terminal State Guard (X-01): Settlement on completed order strictly rejected
  const completedOrderId = `ord_test_compl_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Budi Done', '62812345678', 'dine_in', 'pos_cashier', 50000, 50000, 'cash', 'completed')
  `).run(completedOrderId, `ORD-DONE-${Date.now()}`);

  assert.throws(() => {
    CashSettlementService.settleCashPayment({
      order_id: completedOrderId,
      amount: 50000,
      amount_tendered: 50000
    });
  }, /status terminal "completed"/);
});

test('Payment 9 — Webhook Concurrency Race & Idempotent Retry: First settlement wins, second handles promo exception', () => {
  const brandId = 'brand_pay';
  const branchId = 'branch_pay';
  const customerPhone = '081299990099';
  const promoId = 'prm_race_limit_1';

  // 1. Create promo with max 1 claim per customer and ensure stock
  db.prepare(`
    INSERT OR REPLACE INTO promotions (id, brand_id, name, capability_type, stacking_policy, max_redemptions_per_customer, is_active)
    VALUES (?, ?, 'Promo 1x Only', 'install_incentive', 'exclusive', 1, 1)
  `).run(promoId, brandId);

  db.prepare(`
    INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_pay', 'brand_pay', 'Cat Pay', 'cat-pay')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES ('prod_pay_1', 'brand_pay', 'cat_pay', 'Bebek Goreng', 'bebek-goreng-pay', 25000, 1)
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES ('branch_pay', 'prod_pay_1', 25000, 100, 1)
  `).run();

  // 2. Create Order A and Order B (both pending with promo applied)
  const orderIdA = `ord_race_A_${Date.now()}`;
  const orderIdB = `ord_race_B_${Date.now()}`;

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-RACE-A', ?, ?, 'Customer Race', ?, 'delivery', 25000, 25000, 'midtrans', 'pending'),
           (?, 'ORD-RACE-B', ?, ?, 'Customer Race', ?, 'delivery', 25000, 25000, 'midtrans', 'pending')
  `).run(orderIdA, brandId, branchId, customerPhone, orderIdB, brandId, branchId, customerPhone);

  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note)
    VALUES ('it_A1', ?, 'prod_pay_1', 'Bebek Goreng', 25000, 1, 25000, ''),
           ('it_A2', ?, ?, 'Hadiah Es Teh', 0, 1, 0, 'Bonus Promo PWA'),
           ('it_B1', ?, 'prod_pay_1', 'Bebek Goreng', 25000, 1, 25000, ''),
           ('it_B2', ?, ?, 'Hadiah Es Teh', 0, 1, 0, 'Bonus Promo PWA')
  `).run(orderIdA, orderIdA, promoId, orderIdB, orderIdB, promoId);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, merchant_id, snap_token, payment_status, amount)
    VALUES ('pay_A', ?, 'midtrans', 'midtrans', 'midtrans_default', 'snap_A', 'pending', 25000),
           ('pay_B', ?, 'midtrans', 'midtrans', 'midtrans_default', 'snap_B', 'pending', 25000)
  `).run(orderIdA, orderIdB);

  // 3. Webhook settlement for Order A (Wins)
  const webhookPayloadA = {
    order_id: orderIdA,
    transaction_status: 'settlement',
    gross_amount: '25000'
  };

  const resA = PaymentGatewayService.handleWebhook(webhookPayloadA, { skipSignatureCheck: true });
  assert.strictEqual(resA.payment_status, 'settlement');
  const orderAInDb = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderIdA);
  assert.strictEqual(orderAInDb.status, 'pending', 'money settled but order still AWAITING_BRANCH_ACCEPTANCE (R5 check-2)');

  // Verify redemption recorded for Order A
  const rdmA = db.prepare("SELECT * FROM promotion_redemptions WHERE order_id = ? AND status = 'active'").get(orderIdA);
  assert.ok(rdmA);

  // 4. Webhook settlement for Order B (Race: Customer already consumed limit)
  const webhookPayloadB = {
    order_id: orderIdB,
    transaction_status: 'settlement',
    gross_amount: '25000'
  };

  const resB = PaymentGatewayService.handleWebhook(webhookPayloadB, { skipSignatureCheck: true });
  assert.strictEqual(resB.payment_status, 'settlement');
  assert.strictEqual(resB.order_status, 'fulfillment_exception');

  const orderBInDb = db.prepare('SELECT status, order_note FROM orders WHERE id = ?').get(orderIdB);
  assert.strictEqual(orderBInDb.status, 'fulfillment_exception');
  assert.ok(orderBInDb.order_note.includes('PROMO_LIMIT_EXCEEDED_RACE'));

  // 5. Idempotent Retry: Re-sending webhook for Order A returns idempotent success without duplicate rows
  const retryA = PaymentGatewayService.handleWebhook(webhookPayloadA, { skipSignatureCheck: true });
  assert.strictEqual(retryA.idempotent, true);
  assert.strictEqual(retryA.payment_status, 'settlement');

  const totalRdm = db.prepare('SELECT COUNT(*) as count FROM promotion_redemptions WHERE promotion_id = ? AND customer_phone = ?').get(promoId, customerPhone);
  assert.strictEqual(totalRdm.count, 1);
});

// ==============================================================================
// Payment R11 — Late settlement must never revive a rejected/timed-out order
// ==============================================================================
test('Payment R11 — settlement after branch REJECT/BRANCH_TIMEOUT routes to fulfillment_exception (refund) with ZERO stock mutation', () => {
  const ts = Date.now();

  for (const [label, terminalStatus] of [['timeout', 'timeout'], ['rejected', 'rejected']]) {
    const orderId = `ord_r11_${label}_${ts}`;
    const orderNumber = `XN-R11-${label}-${ts}`;
    const productId = `prod_r11_${label}_${ts}`;

    db.prepare(`INSERT INTO products (id, brand_id, name, slug, price)
      VALUES (?, 'brand_pay', 'Produk R11 ' + ?, 'prod-r11-' + ?, 60000)`).run(productId, label, label);
    db.prepare(`INSERT INTO branch_products (branch_id, product_id, stock, is_available)
      VALUES ('branch_pay', ?, 10, 1)`).run(productId);
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, 'brand_pay', 'branch_pay', 'Customer R11', '62812345678', 'delivery', 'customer_app', 60000, 60000, 'midtrans', ?)
    `).run(orderId, orderNumber, terminalStatus);
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
      VALUES (?, ?, ?, 'Produk R11', 60000, 1, 60000)
    `).run(`item_r11_${label}_${ts}`, orderId, productId);
    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
      VALUES (?, ?, 'midtrans', 'M12345', 'snap_r11', 'pending', 60000)
    `).run(`pay_r11_${label}_${ts}`, orderId);

    // Settlement webhook arrives AFTER the branch decision already committed.
    const result = PaymentGatewayService.handleWebhook({
      order_id: orderId,
      status_code: '200',
      gross_amount: '60000.00',
      transaction_status: 'settlement',
      payment_type: 'qris'
    }, { skipSignatureCheck: true });

    assert.strictEqual(result.success, true, label);
    assert.strictEqual(result.payment_status, 'settlement', 'money IS settled');
    assert.strictEqual(result.order_status, 'fulfillment_exception', label + ': order must NOT be force-confirmed');

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    assert.strictEqual(order.status, 'fulfillment_exception', label + ' order routed to the refund queue');
    assert.ok((order.order_note || '').includes('[Perlu Refund]'), 'structured refund reason recorded');
    assert.ok((order.order_note || '').includes(terminalStatus), 'note names the terminal status that won the race');

    const stock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pay', productId);
    assert.strictEqual(stock.stock, 10, label + ': NO stock deduction for a non-fulfilled order');
    const movements = db.prepare('SELECT COUNT(*) AS c FROM inventory_movements WHERE reference_id = ?').get(orderNumber);
    assert.strictEqual(movements.c, 0, label + ': no inventory ledger rows');
  }
});

test('Payment R11 — gateway cancel/deny/expire never overwrites a terminal BRANCH_TIMEOUT order', () => {
  const ts = Date.now();
  const orderId = `ord_r11_expire_${ts}`;
  const orderNumber = `XN-R11-EXP-${ts}`;

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Customer R11 Exp', '62812345678', 'delivery', 'customer_app', 60000, 60000, 'midtrans', 'timeout')
  `).run(orderId, orderNumber);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_r11_exp', 'pending', 60000)
  `).run(`pay_r11_exp_${ts}`, orderId);

  const result = PaymentGatewayService.handleWebhook({
    order_id: orderId,
    status_code: '200',
    gross_amount: '60000.00',
    transaction_status: 'expire',
    payment_type: 'qris'
  }, { skipSignatureCheck: true });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.payment_status, 'expire', 'payment failure is recorded');
  assert.strictEqual(result.order_status, undefined, 'no order mutation claim for a terminal order');

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'timeout', 'BRANCH_TIMEOUT survives a later gateway expire');
  const payRecord = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(payRecord.payment_status, 'expire');
});

// ==============================================================================
// R5 CHECK-2 — payment settlement NEVER bypasses Branch ACCEPT; ACCEPT is the
// only transition out of AWAITING_BRANCH_ACCEPTANCE ('pending').
// ==============================================================================
test('R5 CHECK-2 — settlement keeps the order AWAITING; only Branch ACCEPT confirms; settlement AFTER ACCEPT leaves status untouched', () => {
  const ts = Date.now();
  const OrderStateMachine = require('../../server/services/OrderStateMachine');

  // --- Case A: settlement on a pending order -> money settled, order stays pending ---
  const orderIdA = `ord_chk2_A_${ts}`;
  const orderNumberA = `XN-CHK2-A-${ts}`;
  const productIdA = `prod_chk2_A_${ts}`;

  db.prepare(`INSERT INTO products (id, brand_id, name, slug, price)
    VALUES (?, 'brand_pay', 'Produk CHK2 A', 'prod-chk2-a', 45000)`).run(productIdA);
  db.prepare(`INSERT INTO branch_products (branch_id, product_id, stock, is_available)
    VALUES ('branch_pay', ?, 10, 1)`).run(productIdA);
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Customer CHK2 A', '62812345678', 'delivery', 'customer_app', 45000, 45000, 'midtrans', 'pending')
  `).run(orderIdA, orderNumberA);
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES (?, ?, ?, 'Produk CHK2 A', 45000, 1, 45000)
  `).run(`item_chk2_A_${ts}`, orderIdA, productIdA);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_chk2_a', 'pending', 45000)
  `).run(`pay_chk2_A_${ts}`, orderIdA);

  const resA = PaymentGatewayService.handleWebhook({
    order_id: orderIdA,
    status_code: '200',
    gross_amount: '45000.00',
    transaction_status: 'settlement',
    payment_type: 'qris'
  }, { skipSignatureCheck: true });

  assert.strictEqual(resA.success, true);
  assert.strictEqual(resA.payment_status, 'settlement');
  assert.strictEqual(resA.order_status, undefined, 'settlement does NOT claim an order-status change');

  let orderA = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderIdA);
  assert.strictEqual(orderA.status, 'pending', 'paid order stays AWAITING_BRANCH_ACCEPTANCE — payment is not acceptance');

  // --- Branch ACCEPT is the ONLY transition to 'confirmed' ---
  const acceptRes = OrderStateMachine.transition({
    order_id: orderIdA,
    target_status: 'confirmed',
    actor_type: 'branch_actor',
    actor_id: 'usr_bm_chk2',
    note: '[ACCEPT by branch_manager:usr_bm_chk2] OK'
  });
  assert.strictEqual(acceptRes.success, true);
  orderA = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderIdA);
  assert.strictEqual(orderA.status, 'confirmed');

  // --- Case B: settlement arriving AFTER ACCEPT is fine and leaves status alone ---
  const orderIdB = `ord_chk2_B_${ts}`;
  const orderNumberB = `XN-CHK2-B-${ts}`;
  const productIdB = `prod_chk2_B_${ts}`;

  db.prepare(`INSERT INTO products (id, brand_id, name, slug, price)
    VALUES (?, 'brand_pay', 'Produk CHK2 B', 'prod-chk2-b', 30000)`).run(productIdB);
  db.prepare(`INSERT INTO branch_products (branch_id, product_id, stock, is_available)
    VALUES ('branch_pay', ?, 10, 1)`).run(productIdB);
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Customer CHK2 B', '62812345678', 'delivery', 'customer_app', 30000, 30000, 'midtrans', 'confirmed')
  `).run(orderIdB, orderNumberB);
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES (?, ?, ?, 'Produk CHK2 B', 30000, 1, 30000)
  `).run(`item_chk2_B_${ts}`, orderIdB, productIdB);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_chk2_b', 'pending', 30000)
  `).run(`pay_chk2_B_${ts}`, orderIdB);

  const resB = PaymentGatewayService.handleWebhook({
    order_id: orderIdB,
    status_code: '200',
    gross_amount: '30000.00',
    transaction_status: 'settlement',
    payment_type: 'qris'
  }, { skipSignatureCheck: true });
  assert.strictEqual(resB.success, true);
  assert.strictEqual(resB.payment_status, 'settlement');
  const orderB = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderIdB);
  assert.strictEqual(orderB.status, 'confirmed', 'accepted order stays accepted; settlement is payment-only');

  // --- Case C: gateway cancel/expire still cancels a PENDING (unpaid) order only ---
  const orderIdC = `ord_chk2_C_${ts}`;
  const orderNumberC = `XN-CHK2-C-${ts}`;

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_pay', 'branch_pay', 'Customer CHK2 C', '62812345678', 'delivery', 'customer_app', 20000, 20000, 'midtrans', 'pending')
  `).run(orderIdC, orderNumberC);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'M12345', 'snap_chk2_c', 'pending', 20000)
  `).run(`pay_chk2_C_${ts}`, orderIdC);

  PaymentGatewayService.handleWebhook({
    order_id: orderIdC,
    status_code: '200',
    gross_amount: '20000.00',
    transaction_status: 'expire',
    payment_type: 'qris'
  }, { skipSignatureCheck: true });
  assert.strictEqual(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(orderIdC).status,
    'cancelled',
    'payment failure still cancels an unpaid pending order (PAYMENT_FAILURE class)'
  );
});
