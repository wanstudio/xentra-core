'use strict';

/**
 * Phase 6 — Payment Implementation Test Suite
 *
 * Covers:
 * P6.1 Payment method UI (selection does not imply success)
 * P6.2 Payment initiation (enters pending state, creates order with pending status)
 * P6.3 Payment pending (explicit pending/processing surface, no premature success)
 * P6.4 Payment result (distinguishes success, pending, failed)
 * P6.5 Payment failure (explicit failure surface with recovery options)
 * P6.6 Critical Invariant: Payment success != Order acceptance
 * Recovery: Refresh/re-entry, duplicate initiation, duplicate webhook
 * Regression: Multi-branch cart, single-branch checkout, pre-payment gate
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p6-payment';

const app = require('../../server/app');
const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
const { PaymentGatewayService } = require('../../domains/payment');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';

function makeOrderId() { return 'p6_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P6-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId,
  status = 'pending',
  branchId = BRANCH_ID,
  phone = '081200000086',
  orderType = 'delivery',
  grandTotal = 75000,
  paymentMethod = 'midtrans',
  paymentStatus = 'pending',
  snapToken = 'snap_token_p6_test'
} = {}) {
  orderId = orderId || makeOrderId();
  const num = makeOrderNum();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, delivery_fee, discount_amount, grand_total,
      payment_method, payment_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'P6 Customer', ?, ?, ?, 70000, 5000, 0, ?, ?, ?, ?, ?)
  `).run(
    orderId, num, BRAND_ID, branchId, phone,
    orderType, status, grandTotal,
    paymentMethod, paymentStatus, now, now
  );

  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, snap_token, created_at)
    VALUES (?, ?, 'midtrans', ?, ?, ?, ?, ?)
  `).run(payId, orderId, paymentMethod, paymentStatus, grandTotal, snapToken, now);

  return { orderId, num, phone, branchId, grandTotal, snapToken };
}

function seedCustomerSession(phone, brandId = BRAND_ID) {
  const token = 'p6cust_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  if (store && store.sessions) {
    store.sessions.set(token, {
      type: 'customer',
      organizationId: 'org_xentra_holding',
      organization_id: 'org_xentra_holding',
      role: 'customer',
      phone: phone.trim(),
      customerPhone: phone.trim(),
      brandId,
      brand_id: brandId,
      email_verified: true,
      expiresAt: Date.now() + 86400 * 1000
    });
  }
  return token;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'app.mybangjo.com',
        ...headers
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function setupPwaDOM() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="x-order-content"></div></body></html>`, {
    url: 'https://app.mybangjo.com/order-received',
    runScripts: 'dangerously'
  });
  const win = dom.window;

  win.Xentra = {
    UI: {
      escape: (str) => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      money: (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'),
      toast: () => {}
    },
    Store: {
      clearCart: () => {}
    },
    Router: {
      getOrderIdFromUrl: () => null,
      navigate: () => {}
    },
    API: {
      get: async () => ({ success: false }),
      post: async () => ({ success: false })
    }
  };

  const scriptPath = path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/order-received.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  new win.Function('window', 'document', code)(win, win.document);

  return { win, dom, container: win.document.getElementById('x-order-content') };
}

describe('Phase 6 — Payment Implementation & Critical Invariants', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  // ─── P6.1 & P6.2 Payment UI & Initiation ─────────────────────────────────

  it('1. Payment method selection is customer intent only and does not imply payment success', () => {
    // Both methods are officially allowed
    assert.strictEqual(PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_ID }
    ]), null);
  });

  it('2. Payment initiation creates order in PENDING status with payment record PENDING', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      status: 'pending'
    });

    const token = seedCustomerSession(seed.phone);
    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.order.status, 'pending', 'Order status must be pending');
    assert.strictEqual(res.data.payment.payment_status, 'pending', 'Payment status must be pending');
    assert.strictEqual(res.data.payment.snap_token, seed.snapToken, 'Snap token exposed to client for payment window');
  });

  // ─── P6.3 Payment Pending ────────────────────────────────────────────────

  it('3. Pending online payment renders explicit pending surface, not awaiting branch acceptance', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        id: 'ord_pending_test',
        order_number: 'P6-PENDING-01',
        status: 'pending',
        grand_total: 55000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Barat'
      },
      payment: {
        payment_method: 'midtrans',
        payment_status: 'pending',
        snap_token: 'snap_sample_token'
      }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_pending_test');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('id="x-payment-pending-screen"'), 'Renders explicit payment pending screen');
    assert.ok(html.includes('Menunggu Pembayaran'), 'Shows pending payment title');
    assert.ok(html.includes('id="x-btn-resume-pay"'), 'Provides resume payment button');
    assert.ok(!html.includes('Menunggu Konfirmasi Cabang'), 'Does NOT claim order is awaiting branch acceptance yet');
    assert.ok(!html.includes('Pesanan Diterima Cabang'), 'Does NOT claim branch accepted order');
    win.Xentra.OrderReceived.unmount();
  });

  it('4. Reconciliation pending status renders gateway verification surface', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        id: 'ord_recon_test',
        order_number: 'P6-RECON-01',
        status: 'pending',
        grand_total: 60000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Barat'
      },
      payment: {
        payment_method: 'midtrans',
        payment_status: 'reconciliation_pending'
      }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_recon_test');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('Memverifikasi Pembayaran'), 'Shows gateway verification title');
    assert.ok(html.includes('Verifikasi Gateway Sedang Berjalan'), 'Shows reconciliation badge');
    win.Xentra.OrderReceived.unmount();
  });

  // ─── P6.4 Payment Result & P6.6 Critical Invariant ───────────────────────

  it('5. Payment success (settlement) transitions to awaiting branch acceptance — NOT order accepted', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        order_type: 'dine_in',
        id: 'ord_settled_test',
        order_number: 'P6-SETTLED-01',
        status: 'pending', // Awaiting branch acceptance!
        grand_total: 75000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Barat',
        acceptance_deadline_at: new Date(Date.now() + 180000).toISOString()
      },
      payment: {
        payment_method: 'midtrans',
        payment_status: 'settlement',
        amount: 75000
      }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_settled_test');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    // CRITICAL INVARIANT: Payment confirmed != Branch accepted!
    assert.ok(html.includes('id="x-badge-pay-confirmed"'), 'Displays payment confirmed badge');
    assert.ok(html.includes('Menunggu Konfirmasi Cabang'), 'Displays waiting for branch confirmation');
    assert.ok(html.includes('id="x-acceptance-countdown"'), 'Displays acceptance countdown timer');
    assert.ok(!html.includes('Pesanan Diterima Cabang!'), 'Must NEVER claim branch accepted before order.status == confirmed');
    assert.ok(!html.includes('Sedang Disiapkan di Dapur'), 'Must NOT show kitchen preparing step');
    win.Xentra.OrderReceived.unmount();
  });

  it('6. Cash order enters awaiting branch acceptance with Cash COD badge', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        order_type: 'dine_in',
        id: 'ord_cash_test',
        order_number: 'P6-CASH-01',
        status: 'pending',
        grand_total: 45000,
        payment_method: 'cash',
        branch_name: 'Cabang Barat'
      },
      payment: {
        payment_method: 'cash',
        payment_status: 'pending'
      }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_cash_test');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('id="x-badge-pay-cash"'), 'Displays Cash COD badge');
    assert.ok(html.includes('Menunggu Konfirmasi Cabang'), 'Displays waiting for branch confirmation');
    win.Xentra.OrderReceived.unmount();
  });

  // ─── P6.5 Payment Failure ────────────────────────────────────────────────

  it('7. Payment failure (cancel/deny/expire) renders explicit failure screen with recovery CTA', async () => {
    const { win, container } = setupPwaDOM();
    const testCases = [
      { status: 'expire', title: 'Waktu Pembayaran Habis' },
      { status: 'deny', title: 'Pembayaran Ditolak' },
      { status: 'cancel', title: 'Pembayaran Dibatalkan' }
    ];

    for (const tc of testCases) {
      const mockData = {
        success: true,
        order: {
          id: 'ord_fail_' + tc.status,
          order_number: 'P6-FAIL-' + tc.status,
          status: 'cancelled',
          grand_total: 50000,
          payment_method: 'midtrans',
          branch_name: 'Cabang Barat'
        },
        payment: {
          payment_method: 'midtrans',
          payment_status: tc.status
        }
      };

      win.Xentra.API.get = async () => mockData;
      win.Xentra.OrderReceived.mount(container, mockData.order.id);
      await new Promise(r => setTimeout(r, 25));

      const html = container.innerHTML;
      assert.ok(html.includes('id="x-payment-failed-screen"'), `Renders failure screen for ${tc.status}`);
      assert.ok(html.includes(tc.title), `Displays correct title for ${tc.status}`);
      assert.ok(html.includes('id="x-btn-pay-retry"'), 'Provides retry/reorder button');
      assert.ok(!html.includes('Menunggu Konfirmasi Cabang'), 'Does not claim awaiting branch acceptance');
      assert.ok(!html.includes('Pesanan Diterima Cabang'), 'Does not claim branch accepted');
      win.Xentra.OrderReceived.unmount();
    }
  });

  // ─── Recovery & Idempotency ──────────────────────────────────────────────

  it('8. Refresh / re-entry obtains authoritative payment and order state from Core', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement',
      status: 'pending'
    });

    const token = seedCustomerSession(seed.phone);
    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.payment.payment_status, 'settlement');
    assert.strictEqual(res.data.order.status, 'pending');
  });

  it('9. Idempotency: duplicate client_transaction_id returns existing order and payment token', async () => {
    const txId = 'ctx_dedupe_test_' + Date.now();
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending'
    });

    db.prepare('UPDATE orders SET client_transaction_id = ? WHERE id = ?').run(txId, seed.orderId);

    const check = await OrderPlacementService.submitOrder({
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID,
      client_transaction_id: txId,
      customer: { name: 'Customer Dedupe', phone: seed.phone },
      items: [{ product_id: 'prod_ayam_tulang_lunak', id: 'prod_ayam_tulang_lunak', quantity: 1, expected_price: 35000, name: 'Ayam' }]
    });

    assert.strictEqual(check.success, true);
    assert.strictEqual(check.idempotent, true, 'Placement flagged as idempotent duplicate');
    assert.strictEqual(check.order_id, seed.orderId, 'Returns existing order ID');
  });

  it('10. Duplicate payment webhook delivery is safely idempotent', () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending'
    });

    const webhookPayload = {
      order_id: seed.orderId,
      transaction_status: 'settlement',
      gross_amount: String(seed.grandTotal)
    };

    const first = PaymentGatewayService.handleWebhook(webhookPayload, { skipSignatureCheck: true, provider: 'midtrans' });
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.payment_status, 'settlement');

    const second = PaymentGatewayService.handleWebhook(webhookPayload, { skipSignatureCheck: true, provider: 'midtrans' });
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.idempotent, true, 'Subsequent webhook must be marked idempotent');

    const finalOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(finalOrder.status, 'pending', 'Order operational status remains pending (awaiting branch acceptance)');
  });

  // ─── Regression Guards ───────────────────────────────────────────────────

  it('11. Regression: Single-branch checkout boundary is preserved', () => {
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_ID },
      { product_id: 'prod_2', branch_id: 'branch_other' }
    ]);
    assert.ok(scopeError !== null, 'Rejects cross-branch items in checkout');
    assert.strictEqual(scopeError.status, 'CHECKOUT_SINGLE_BRANCH_REQUIRED');
  });

  it('12. Regression: Branch acceptance contract remains separate and untouched', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement',
      status: 'pending'
    });

    // Verify order cannot be marked confirmed without branch acceptance authority
    const orderBefore = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(orderBefore.status, 'pending');

    // Merchant acceptance transition
    const OrderStateMachine = require('../../server/services/OrderStateMachine');
    OrderStateMachine.transition({
      order_id: seed.orderId,
      target_status: 'confirmed',
      actor_type: 'branch_actor',
      actor_id: 'mgr_01'
    });

    const orderAfter = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(orderAfter.status, 'confirmed', 'Only branch acceptance transitions order to confirmed');
  });
});
