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
    shift_id: 'shift_123'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.payment_status, 'settlement');
  assert.strictEqual(result.change, 50000);

  // Check order_payments record
  const payRecord = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(orderId);
  assert.ok(payRecord);
  assert.strictEqual(payRecord.payment_status, 'settlement');
  assert.strictEqual(payRecord.provider, 'cash');

  // Check order status
  const orderRecord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderRecord.status, 'confirmed');

  // Verify Event
  assert.ok(settledEvent);
  assert.strictEqual(settledEvent.payload.order_id, orderId);
  assert.strictEqual(settledEvent.payload.provider, 'cash');
});

// ==============================================================================
// Payment 3 — Midtrans Webhook Signature Verification & Idempotency
// ==============================================================================
test('Payment 3 — Midtrans Webhook: verifies SHA512 signature, advances status & drops duplicate', async () => {
  const orderId = `ord_test_mid_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-MID-1', 'brand_pay', 'branch_pay', 'Siti Online', '62812345678', 'delivery', 'customer_app', 75000, 75000, 'qris', 'pending')
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

  const payRecord = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(payRecord.payment_status, 'settlement');
  assert.strictEqual(payRecord.payment_method, 'qris');

  // 3. Idempotent Test: Same webhook again
  const duplicateResult = PaymentGatewayService.handleWebhook(webhookPayload);
  assert.strictEqual(duplicateResult.success, true);
  assert.strictEqual(duplicateResult.idempotent, true);
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
