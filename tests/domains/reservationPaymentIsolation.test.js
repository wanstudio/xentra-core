'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const PaymentGatewayService = require('../../domains/payment/services/PaymentGatewayService');
const PaymentRepository = require('../../core/data/repositories/PaymentRepository');

const ORG_ID = 'org_res_payment_iso';
const BRAND_ID = 'brand_res_payment_iso';
const BRANCH_ID = 'branch_res_payment_iso';

function seedReservation(id) {
  db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, slug)
    VALUES (?, 'Reservation Payment Isolation Org', 'reservation-payment-iso')
  `).run(ORG_ID);
  db.prepare(`
    INSERT OR REPLACE INTO brands (id, organization_id, name, slug)
    VALUES (?, ?, 'Reservation Payment Isolation Brand', 'reservation-payment-iso')
  `).run(BRAND_ID, ORG_ID);
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude)
    VALUES (?, ?, 'Reservation Payment Isolation Branch', 'reservation-payment-iso', 'Jl. Test', -5, 105)
  `).run(BRANCH_ID, BRAND_ID);
  db.prepare(`
    INSERT OR REPLACE INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, order_channel, subtotal, grand_total, payment_method, status
    )
    VALUES (?, ?, ?, ?, 'Reservation Customer', '08190000009',
            'reservation', 'customer_app', 0, 0, 'cash', 'confirmed')
  `).run(id, 'RES-ISO-' + id, BRAND_ID, BRANCH_ID);
}

test.before(() => seedReservation('ord_res_payment_iso'));

test.after(() => {
  db.prepare('DELETE FROM order_payments WHERE order_id = ?').run('ord_res_payment_iso');
  db.prepare('DELETE FROM orders WHERE id = ?').run('ord_res_payment_iso');
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH_ID);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND_ID);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG_ID);
});

test('reservation cannot create an online payment transaction', async () => {
  await assert.rejects(
    () => PaymentGatewayService.createSnapTransaction({
      id: 'ord_res_payment_iso',
      order_id: 'ord_res_payment_iso',
      order_type: 'reservation',
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID,
      grand_total: 0,
      payment_method: 'doku'
    }, [], { name: 'Reservation Customer', phone: '08190000009' }),
    /PAYMENT_NOT_APPLICABLE/
  );

  const paymentRow = db.prepare('SELECT COUNT(*) AS count FROM order_payments WHERE order_id = ?').get('ord_res_payment_iso');
  assert.equal(paymentRow.count, 0, 'Reservation must not create an order_payments row.');
});

test('reservation cannot be reconciled through gateway status checks', async () => {
  await assert.rejects(
    () => PaymentGatewayService.checkTransactionStatus('ord_res_payment_iso'),
    /PAYMENT_NOT_APPLICABLE/
  );
});

test('reservation webhook cannot create or settle a payment', () => {
  assert.throws(
    () => PaymentGatewayService.handleWebhook({
      order_id: 'ord_res_payment_iso',
      transaction_status: 'settlement',
      gross_amount: '0.00',
      status_code: '200',
      signature_key: 'not-used-in-this-guard-test'
    }, { skipSignatureCheck: true, provider: 'midtrans' }),
    /PAYMENT_NOT_APPLICABLE/
  );

  const paymentRow = db.prepare('SELECT COUNT(*) AS count FROM order_payments WHERE order_id = ?').get('ord_res_payment_iso');
  assert.equal(paymentRow.count, 0, 'Reservation webhook must not heal/create a payment record.');
});

test('payment reconciliation queue ignores reservation orders', () => {
  db.prepare(`
    INSERT OR REPLACE INTO order_payments (
      id, order_id, provider, payment_method, merchant_id,
      payment_status, amount, created_at, updated_at
    )
    VALUES ('pay_res_payment_iso', 'ord_res_payment_iso', 'doku', 'doku', 'doku_test',
            'reconciliation_pending', 0, datetime('now'), datetime('now'))
  `).run();

  const paymentRepository = new PaymentRepository();
  const rows = paymentRepository.findPendingReconciliationPayments();
  assert.equal(rows.some(row => row.order_id === 'ord_res_payment_iso'), false);
});
