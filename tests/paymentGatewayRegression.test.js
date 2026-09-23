'use strict';

/**
 * Regression Test Suite: Payment Gateway (Provider Isolation, DOKU Checkout,
 * Check Status, Webhook Security & Idempotency, and Credential Leak Prevention).
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const http = require('node:http');

const db = require('../server/database/db');
require('./helpers/demoFixtures.js')();
const app = require('../server/app');
const DokuGateway = require('../domains/payment/gateways/DokuGateway');
const PaymentGatewayService = require('../domains/payment/services/PaymentGatewayService');

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_pusat';

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

test('PAYMENT GATEWAY AUDIT & REGRESSION SUITE', async (t) => {
  let server;
  let originalBrandConfig;
  const _origAxiosGet = axios.get;
  const _origAxiosPost = axios.post;

  await t.test('Setup test server and store initial config', async () => {
    const row = db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID);
    originalBrandConfig = row ? row.default_payment_config : null;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
  });

  t.after(() => {
    axios.get = _origAxiosGet;
    axios.post = _origAxiosPost;
    if (server) server.close();
    if (originalBrandConfig === null) {
      db.prepare('UPDATE brands SET default_payment_config = NULL WHERE id = ?').run(BRAND_ID);
    } else {
      db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?').run(originalBrandConfig, BRAND_ID);
    }
  });

  // ── 1. DOKU aktif + Midtrans kosong → tetap bisa bayar ──
  await t.test('REG-01: DOKU aktif + Midtrans kosong → tetap bisa bayar', async () => {
    const dokuConfig = {
      provider: 'doku',
      client_id: 'BRN-DOKU-001',
      secret_key: 'doku-secret-key-001',
      doku_is_production: false,
      server_key: '',
      client_key: ''
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(dokuConfig), BRAND_ID);

    let capturedPost = null;
    axios.post = async function (url, body, opts) {
      capturedPost = { url, body, opts };
      return {
        data: {
          response: {
            payment: {
              token_id: 'doku_tok_123',
              url: 'https://pay-sandbox.doku.com/checkout/doku_tok_123'
            },
            order: {
              session_id: 'sess_123'
            }
          }
        }
      };
    };

    const order = {
      id: `ord_reg01_${Date.now()}`,
      grand_total: 75000,
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID
    };

    const result = await PaymentGatewayService.createSnapTransaction(order, [
      { id: '1', name: 'Nasi Ayam', price: 75000, quantity: 1 }
    ], { name: 'Customer Doku', phone: '08123456789' });

    assert.ok(result);
    assert.equal(result.redirect_url, 'https://pay-sandbox.doku.com/checkout/doku_tok_123');
    assert.equal(result.merchant_id, 'BRN-DOKU-001');
    assert.ok(capturedPost.url.includes('/checkout/v1/payment'));
  });

  // ── 2. DOKU aktif + credential invalid → error DOKU, TIDAK fallback Midtrans ──
  await t.test('REG-02: DOKU aktif + credential invalid → error DOKU, TIDAK fallback Midtrans', async () => {
    const brokenDokuConfig = {
      provider: 'doku',
      client_id: '', // Missing
      secret_key: '', // Missing
      server_key: 'SB-Mid-server-should-not-be-used',
      client_key: 'SB-Mid-client-should-not-be-used'
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(brokenDokuConfig), BRAND_ID);

    const order = {
      id: `ord_reg02_${Date.now()}`,
      grand_total: 50000,
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID
    };

    await assert.rejects(
      async () => {
        await PaymentGatewayService.createSnapTransaction(order, [], {});
      },
      (err) => {
        assert.ok(err.message.includes('DokuGateway') || err.message.includes('DOKU'), 'Error harus spesifik DOKU');
        assert.ok(!err.message.includes('Midtrans'), 'Tidak boleh fallback ke Midtrans');
        return true;
      }
    );
  });

  // ── 3. Midtrans aktif + DOKU kosong → tetap bisa bayar ──
  await t.test('REG-03: Midtrans aktif + DOKU kosong → tetap bisa bayar', async () => {
    const midtransConfig = {
      provider: 'midtrans',
      server_key: 'SB-Mid-server-valid',
      client_key: 'SB-Mid-client-valid',
      client_id: '',
      secret_key: ''
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(midtransConfig), BRAND_ID);

    const order = {
      id: `ord_reg03_${Date.now()}`,
      grand_total: 50000,
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID
    };

    axios.post = async function (url, body, opts) {
      return {
        data: {
          token: 'snap-tok-midtrans-123',
          redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/snap-tok-midtrans-123'
        }
      };
    };

    const result = await PaymentGatewayService.createSnapTransaction(order, [
      { id: '1', name: 'Item', price: 50000, quantity: 1 }
    ], { name: 'Customer Midtrans', phone: '08123456789' });

    assert.ok(result);
    assert.ok(result.snap_token);
  });

  // ── 4. Config gagal dibaca → tidak default ke Midtrans (fail-closed) ──
  await t.test('REG-04: Config gagal dibaca → tidak default ke Midtrans', async () => {
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run('CORRUPTED_JSON_{{{', BRAND_ID);

    assert.throws(
      () => {
        PaymentGatewayService.resolvePaymentConfig(BRANCH_ID, BRAND_ID);
      },
      /format JSON tidak valid/
    );

    const res = await makeRequest(server, { path: '/api/v1/payment/config' });
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'CONFIG_PARSE_ERROR');
    assert.ok(res.body.payment_gateway === undefined, 'Tidak boleh mengembalikan default payment_gateway');
  });

  // ── 5. DOKU → payment.url → redirect ──
  await t.test('REG-05: DOKU → payment.url → redirect langsung', async () => {
    const dokuGw = new DokuGateway({
      client_id: 'BRN-001',
      secret_key: 'sec-001',
      is_production: false
    });

    axios.post = async function () {
      return {
        data: {
          response: {
            payment: {
              token_id: 'tok_abc',
              url: 'https://pay.doku.com/checkout/target-url-123'
            },
            order: { session_id: 's_1' }
          }
        }
      };
    };

    const res = await dokuGw.createTransaction({ id: 'ord_123', grand_total: 50000 }, [], {});
    assert.equal(res.redirect_url, 'https://pay.doku.com/checkout/target-url-123');
  });

  // ── 6. DOKU → tidak load Snap.js ──
  await t.test('REG-06: DOKU → tidak load Snap.js dan tidak menyentuh window.snap', async () => {
    const MODULE_PATH = path.resolve(__dirname, '../apps/customer-pwa/assets/js/core/payment-gateway.js');
    const scripts = [];
    const doc = {
      head: { appendChild: (s) => scripts.push(s) },
      getElementById: () => null,
      createElement: () => ({ id: '', src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } })
    };
    const win = {
      Xentra: {
        API: {
          get: () => Promise.resolve({
            success: true,
            payment_gateway: {
              active_provider: 'doku',
              active_provider_configured: true,
              midtrans_client_key: ''
            }
          })
        }
      },
      location: { href: '' },
      document: doc
    };

    globalThis.window = win;
    globalThis.document = doc;
    delete require.cache[MODULE_PATH];
    require(MODULE_PATH);

    const gateway = win.Xentra.PaymentGateway;
    await gateway.pay({ redirectUrl: 'https://pay.doku.com/x', handlers: {} });

    assert.equal(scripts.length, 0, 'Snap.js tidak boleh dimuat');
    assert.equal(win.snap, undefined, 'window.snap tidak boleh disentuh');
    assert.equal(win.location.href, 'https://pay.doku.com/x', 'Langsung redirect ke payment.url');
  });

  // ── 7. Check Status memakai endpoint resmi (/orders/v1/status/{orderId}) ──
  await t.test('REG-07: Check Status memakai endpoint resmi DOKU (/orders/v1/status/{orderId})', async () => {
    const dokuGw = new DokuGateway({
      client_id: 'BRN-DOKU-STATUS',
      secret_key: 'sec-status-key',
      is_production: false
    });

    let capturedUrl = null;
    let capturedHeaders = null;
    axios.get = async function (url, opts) {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return {
        data: {
          order: { invoice_number: 'ORD-INV-999', amount: 50000, status: 'ORDER_GENERATED' },
          transaction: { status: 'SUCCESS' }
        }
      };
    };

    const statusRes = await dokuGw.checkTransactionStatus('ORD-INV-999');
    assert.ok(capturedUrl.includes('/orders/v1/status/ORD-INV-999'),
      `Target URL harus /orders/v1/status/ORD-INV-999, aktual: ${capturedUrl}`);
    assert.ok(!capturedUrl.includes('/checkout/v1/payment'), 'Bukan endpoint lama /checkout/v1/payment/...');
    assert.equal(capturedHeaders['Client-Id'], 'BRN-DOKU-STATUS');
    assert.ok(capturedHeaders['Signature'].startsWith('HMACSHA256='));
    assert.equal(statusRes.transaction.status, 'SUCCESS');
  });

  // ── 8. Webhook DOKU signature valid/invalid + FAILED retryable handling ──
  await t.test('REG-08: Webhook DOKU signature valid/invalid dan status FAILED tidak membatalkan order', async () => {
    const dokuConfig = {
      provider: 'doku',
      client_id: 'BRN-DOKU-WH',
      secret_key: 'my-doku-secret',
      doku_is_production: false
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(dokuConfig), BRAND_ID);

    const dokuGw = new DokuGateway(dokuConfig);

    const orderId = `ord_doku_wh_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Customer WH', '08123', 'delivery', 'customer_app', 65000, 65000, 'doku', 'pending')
    `).run(orderId, `XN-${orderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
      VALUES (?, ?, 'doku', 'BRN-DOKU-WH', 'tok_wh', 'pending', 65000)
    `).run(`pay_${orderId}`, orderId);

    const webhookBody = {
      order: { invoice_number: orderId, amount: 65000 },
      transaction: { status: 'FAILED' }
    };
    const target = '/api/v1/webhooks/doku';
    const requestId = 'req-wh-1';
    const timestamp = '2026-09-23T12:00:00Z';
    const validDigest = crypto.createHash('sha256').update(JSON.stringify(webhookBody)).digest('base64');
    const sigComponents = [
      `Client-Id:${dokuConfig.client_id}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${timestamp}`,
      `Request-Target:${target}`,
      `Digest:${validDigest}`
    ].join('\n');
    const validSignature = 'HMACSHA256=' + crypto.createHmac('sha256', dokuConfig.secret_key).update(sigComponents).digest('base64');

    // 8.1 Invalid signature rejected
    assert.throws(
      () => {
        PaymentGatewayService.handleWebhook(webhookBody, {
          provider: 'doku',
          headers: {
            'client-id': dokuConfig.client_id,
            'request-id': requestId,
            'request-timestamp': timestamp,
            'signature': 'HMACSHA256=invalidSignature123',
            'digest': validDigest
          },
          notificationPath: target
        });
      },
      /Signature webhook DOKU tidak valid/
    );

    // 8.2 Valid signature with FAILED status: customer can retry, order remains PENDING (NOT cancelled)
    const failedResult = PaymentGatewayService.handleWebhook(webhookBody, {
      provider: 'doku',
      headers: {
        'client-id': dokuConfig.client_id,
        'request-id': requestId,
        'request-timestamp': timestamp,
        'signature': validSignature,
        'digest': validDigest
      },
      notificationPath: target
    });
    assert.equal(failedResult.payment_status, 'pending');
    const orderAfterFailed = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    assert.equal(orderAfterFailed.status, 'pending', 'FAILED transaksi tidak boleh membatalkan pesanan (bisa retry)');

    // 8.3 Customer retries and SUCCESS notification arrives: transitions to settlement
    const successBody = {
      order: { invoice_number: orderId, amount: 65000 },
      transaction: { status: 'SUCCESS' }
    };
    const successDigest = crypto.createHash('sha256').update(JSON.stringify(successBody)).digest('base64');
    const successSigComponents = [
      `Client-Id:${dokuConfig.client_id}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${timestamp}`,
      `Request-Target:${target}`,
      `Digest:${successDigest}`
    ].join('\n');
    const successSignature = 'HMACSHA256=' + crypto.createHmac('sha256', dokuConfig.secret_key).update(successSigComponents).digest('base64');

    const successResult = PaymentGatewayService.handleWebhook(successBody, {
      provider: 'doku',
      headers: {
        'client-id': dokuConfig.client_id,
        'request-id': requestId,
        'request-timestamp': timestamp,
        'signature': successSignature,
        'digest': successDigest
      },
      notificationPath: target
    });
    assert.equal(successResult.payment_status, 'settlement');
    const payRecord = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
    assert.equal(payRecord.payment_status, 'settlement');
  });

  // ── 9. Duplicate webhook tidak memproses settlement dua kali ──
  await t.test('REG-09: Duplicate webhook tidak memproses settlement dua kali', async () => {
    const orderId = `ord_doku_dup_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Customer Dup', '08123', 'delivery', 'customer_app', 40000, 40000, 'doku', 'pending')
    `).run(orderId, `XN-${orderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
      VALUES (?, ?, 'doku', 'BRN-DOKU-WH', 'tok_dup', 'pending', 40000)
    `).run(`pay_${orderId}`, orderId);

    const dokuData = {
      order: { invoice_number: orderId, amount: 40000 },
      transaction: { status: 'SUCCESS' }
    };

    // First delivery
    const firstRes = PaymentGatewayService.handleWebhook(dokuData, { skipSignatureCheck: true, provider: 'doku' });
    assert.equal(firstRes.payment_status, 'settlement');
    assert.equal(firstRes.idempotent, undefined);

    // Duplicate delivery
    const dupRes = PaymentGatewayService.handleWebhook(dokuData, { skipSignatureCheck: true, provider: 'doku' });
    assert.equal(dupRes.payment_status, 'settlement');
    assert.equal(dupRes.idempotent, true, 'Duplicate webhook harus didrop idempotent');
  });

  // ── 10. Secret Key tidak pernah masuk browser ──
  await t.test('REG-10: Secret Key & Server Key tidak pernah masuk browser', async () => {
    const res = await makeRequest(server, { path: '/api/v1/payment/config' });
    assert.equal(res.status, 200);
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('server_key'), 'server_key tidak boleh ada di respons');
    assert.ok(!bodyStr.includes('secret_key'), 'secret_key tidak boleh ada di respons');
    assert.ok(!bodyStr.includes('doku-secret'), 'nilai secret_key tidak boleh bocor');
  });

  // ── 11. Callback URL + Auto Redirect Audit ──
  await t.test('REG-11: Callback URL tidak dikirim auto_redirect: true saat callback kosong', async () => {
    const dokuGwNoCallback = new DokuGateway({
      client_id: 'BRN-CB-TEST',
      secret_key: 'sec-cb-test',
      callback_url: '' // Empty
    });

    let sentBody = null;
    axios.post = async function (url, body) {
      sentBody = body;
      return {
        data: {
          response: {
            payment: { token_id: 'tok_cb', url: 'https://pay.doku.com/cb' },
            order: { session_id: 'sess_cb' }
          }
        }
      };
    };

    await dokuGwNoCallback.createTransaction({ id: 'ord_cb_empty', grand_total: 10000 }, [], {});
    assert.equal(sentBody.order.auto_redirect, false, 'auto_redirect harus false saat callback_url kosong');
    assert.equal(sentBody.order.callback_url, undefined, 'callback_url kosong tidak boleh disertakan');

    // With explicit callback URL
    const dokuGwWithCallback = new DokuGateway({
      client_id: 'BRN-CB-TEST',
      secret_key: 'sec-cb-test',
      callback_url: 'https://app.mybangjo.com/order-received/123'
    });

    await dokuGwWithCallback.createTransaction({ id: 'ord_cb_filled', grand_total: 10000 }, [], {});
    assert.equal(sentBody.order.auto_redirect, true, 'auto_redirect harus true saat callback_url terisi');
    assert.equal(sentBody.order.callback_url, 'https://app.mybangjo.com/order-received/123');
  });

  // ── 12. Active provider "doku" → order payment provider = "doku" ──
  await t.test('REG-12: Active provider "doku" → order payment provider = "doku"', async () => {
    const dokuConfig = {
      provider: 'doku',
      client_id: 'BRN-DOKU-REG12',
      secret_key: 'sec-reg12',
      doku_is_production: false
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(dokuConfig), BRAND_ID);

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, is_available, stock)
      VALUES (?, '287', 18000, 1, 100)
    `).run(BRANCH_ID);

    const OrderPlacementService = require('../domains/commerce/services/OrderPlacementService');
    const placement = await OrderPlacementService.submitOrder({
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID,
      customer: { name: 'Doku Customer', phone: '081299990001' },
      items: [{ product_id: '287', quantity: 1, expected_price: 18000 }],
      payment_method: 'doku',
      order_type: 'takeaway',
      order_channel: 'customer_app'
    });

    assert.equal(placement.success, true, `Submit order gagal: ${JSON.stringify(placement.errors)}`);
    const orderId = placement.order.id;

    const paymentRow = db.prepare('SELECT provider, payment_method, merchant_id FROM order_payments WHERE order_id = ?').get(orderId);
    assert.ok(paymentRow, 'order_payments row harus dibuat');
    assert.equal(paymentRow.provider, 'doku', 'order_payments.provider harus "doku" (BUKAN midtrans)');
    assert.equal(paymentRow.payment_method, 'doku', 'order_payments.payment_method harus "doku"');
    assert.equal(paymentRow.merchant_id, 'BRN-DOKU-REG12');

    const orderRow = db.prepare('SELECT payment_method FROM orders WHERE id = ?').get(orderId);
    assert.equal(orderRow.payment_method, 'doku');
  });

  // ── 13. Active provider "doku" → DokuGateway called, MidtransGateway NOT called ──
  await t.test('REG-13: Active provider "doku" → DokuGateway called, MidtransGateway NOT called', async () => {
    const dokuConfig = {
      provider: 'doku',
      client_id: 'BRN-DOKU-REG13',
      secret_key: 'sec-reg13',
      doku_is_production: false
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(dokuConfig), BRAND_ID);

    let dokuCalled = false;
    let midtransCalled = false;

    axios.post = async function (url, body, opts) {
      if (url.includes('doku.com')) {
        dokuCalled = true;
        return {
          data: {
            response: {
              payment: { token_id: 'doku_13', url: 'https://pay.doku.com/pay13' },
              order: { session_id: 's_13' }
            }
          }
        };
      }
      if (url.includes('midtrans.com')) {
        midtransCalled = true;
        return {
          data: { token: 'mid_13', redirect_url: 'https://app.midtrans.com/pay13' }
        };
      }
      return { data: {} };
    };

    const order = {
      id: `ord_reg13_${Date.now()}`,
      grand_total: 18000,
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID,
      payment_method: 'doku'
    };

    const res = await PaymentGatewayService.createSnapTransaction(order, [
      { id: '287', name: 'Kopi Jo', price: 18000, quantity: 1 }
    ], { name: 'Customer 13', phone: '081299990002' });

    assert.equal(dokuCalled, true, 'DokuGateway harus dipanggil');
    assert.equal(midtransCalled, false, 'MidtransGateway TIDAK BOLEH dipanggil saat DOKU aktif');
    assert.equal(res.redirect_url, 'https://pay.doku.com/pay13');
  });

  // ── 14. Active provider "midtrans" → MidtransGateway called, DokuGateway NOT called ──
  await t.test('REG-14: Active provider "midtrans" → MidtransGateway called, DokuGateway NOT called', async () => {
    const midtransConfig = {
      provider: 'midtrans',
      server_key: 'SB-Mid-server-reg14',
      client_key: 'SB-Mid-client-reg14'
    };
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify(midtransConfig), BRAND_ID);

    let dokuCalled = false;
    let midtransCalled = false;

    axios.post = async function (url, body, opts) {
      if (url.includes('doku.com')) {
        dokuCalled = true;
        return {
          data: {
            response: { payment: { token_id: 'doku_14', url: 'https://pay.doku.com/pay14' }, order: {} }
          }
        };
      }
      if (url.includes('midtrans.com')) {
        midtransCalled = true;
        return {
          data: { token: 'mid_tok_14', redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/mid_tok_14' }
        };
      }
      return { data: {} };
    };

    const order = {
      id: `ord_reg14_${Date.now()}`,
      grand_total: 18000,
      branch_id: BRANCH_ID,
      brand_id: BRAND_ID,
      payment_method: 'midtrans'
    };

    const res = await PaymentGatewayService.createSnapTransaction(order, [
      { id: '287', name: 'Kopi Jo', price: 18000, quantity: 1 }
    ], { name: 'Customer 14', phone: '081299990003' });

    assert.equal(midtransCalled, true, 'MidtransGateway harus dipanggil');
    assert.equal(dokuCalled, false, 'DokuGateway TIDAK BOLEH dipanggil saat Midtrans aktif');
    assert.equal(res.snap_token, 'mid_tok_14');
  });

  // ── 15. Unknown & Missing provider → request rejected (INVALID_PAYMENT_PROVIDER) ──
  await t.test('REG-15: Unknown & Missing provider → request rejected (INVALID_PAYMENT_PROVIDER)', async () => {
    const OrderPlacementService = require('../domains/commerce/services/OrderPlacementService');

    // Missing payment_method
    const missingRes = await OrderPlacementService.submitOrder({
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID,
      customer: { name: 'No Pay Method', phone: '081299990004' },
      items: [{ product_id: '287', quantity: 1, expected_price: 18000 }],
      payment_method: '',
      order_type: 'takeaway',
      order_channel: 'customer_app'
    });
    assert.equal(missingRes.success, false);
    assert.equal(missingRes.status, 'INVALID_PAYMENT_PROVIDER');

    // Unknown payment_method
    const unknownRes = await OrderPlacementService.submitOrder({
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID,
      customer: { name: 'Bad Pay Method', phone: '081299990005' },
      items: [{ product_id: '287', quantity: 1, expected_price: 18000 }],
      payment_method: 'bitcoin_unknown',
      order_type: 'takeaway',
      order_channel: 'customer_app'
    });
    assert.equal(unknownRes.success, false);
    assert.equal(unknownRes.status, 'INVALID_PAYMENT_PROVIDER');

    // Unknown payment_method via API route /checkout/create-order
    const apiRes = await makeRequest(server, {
      path: '/api/v1/checkout/create-order',
      method: 'POST',
      headers: { 'x-auth-token': 'mock-invalid-token' }
    }, {
      payment_method: 'unknown_provider_xyz',
      items: [{ id: '287', quantity: 1 }]
    });
    assert.equal(apiRes.status, 400);
    assert.equal(apiRes.body.status, 'INVALID_PAYMENT_PROVIDER');
  });

  // ── 16. /payment/config failure & empty config → no fallback to Midtrans ──
  await t.test('REG-16: /payment/config when no provider configured → no fallback to Midtrans', async () => {
    // Empty config without provider
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify({}), BRAND_ID);

    const res = await makeRequest(server, { path: '/api/v1/payment/config' });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment_gateway.active_provider, '', 'active_provider harus empty string jika tidak ada provider');
    assert.equal(res.body.payment_gateway.active_provider_configured, false);
    assert.equal(res.body.payment_gateway.snap_script_url, null, 'snap_script_url harus null jika bukan Midtrans');
  });

  // ── 17. Midtrans still uses Snap.js, DOKU never loads Snap.js in customer PWA ──
  await t.test('REG-17: Customer PWA: Midtrans loads Snap.js, DOKU never loads Snap.js', async () => {
    const MODULE_PATH = path.resolve(__dirname, '../apps/customer-pwa/assets/js/core/payment-gateway.js');

    // 17.1 Test Midtrans
    const midtransScripts = [];
    const midtransWin = {
      Xentra: {
        API: {
          get: () => Promise.resolve({
            success: true,
            payment_gateway: {
              active_provider: 'midtrans',
              active_provider_configured: true,
              midtrans_client_key: 'SB-Client-17',
              snap_script_url: 'https://app.sandbox.midtrans.com/snap/snap.js'
            }
          })
        }
      },
      document: {
        head: {
          appendChild: (s) => {
            midtransScripts.push(s);
            // Simulate script load
            midtransWin.snap = { pay: (tok, handlers) => { handlers.onSuccess && handlers.onSuccess({ status: 'settlement' }); } };
            s.onload && s.onload();
          }
        },
        getElementById: () => null,
        createElement: () => ({ id: '', src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } })
      }
    };
    globalThis.window = midtransWin;
    globalThis.document = midtransWin.document;
    delete require.cache[MODULE_PATH];
    require(MODULE_PATH);

    let midtransSuccess = false;
    await midtransWin.Xentra.PaymentGateway.pay({
      snapToken: 'snap_tok_17',
      handlers: { onSuccess: () => { midtransSuccess = true; } }
    });
    assert.equal(midtransScripts.length, 1, 'Snap.js harus dimuat untuk Midtrans');
    assert.equal(midtransScripts[0].attrs['data-client-key'], 'SB-Client-17');
    assert.equal(midtransSuccess, true);

    // 17.2 Test DOKU
    const dokuScripts = [];
    const dokuWin = {
      Xentra: {
        API: {
          get: () => Promise.resolve({
            success: true,
            payment_gateway: {
              active_provider: 'doku',
              active_provider_configured: true,
              midtrans_client_key: ''
            }
          })
        }
      },
      location: { href: '' },
      document: {
        head: { appendChild: (s) => dokuScripts.push(s) },
        getElementById: () => null,
        createElement: () => ({ id: '', src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } })
      }
    };
    globalThis.window = dokuWin;
    globalThis.document = dokuWin.document;
    delete require.cache[MODULE_PATH];
    require(MODULE_PATH);

    await dokuWin.Xentra.PaymentGateway.pay({
      redirectUrl: 'https://pay.doku.com/redirect17'
    });
    assert.equal(dokuScripts.length, 0, 'DOKU tidak boleh memuat Snap.js');
    assert.equal(dokuWin.snap, undefined, 'DOKU tidak boleh menyentuh window.snap');
    assert.equal(dokuWin.location.href, 'https://pay.doku.com/redirect17');
  });

  // ── 18. Webhooks process as respective providers ──
  await t.test('REG-18: Webhook DOKU processes as "doku" and Midtrans as "midtrans"', async () => {
    // 18.1 DOKU webhook
    const dokuOrderId = `ord_doku_wh_iso_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Doku WH Cust', '08123', 'delivery', 'customer_app', 25000, 25000, 'doku', 'pending')
    `).run(dokuOrderId, `XN-${dokuOrderId}`, BRAND_ID, BRANCH_ID);

    PaymentGatewayService.handleWebhook({
      order: { invoice_number: dokuOrderId, amount: 25000 },
      transaction: { status: 'SUCCESS' }
    }, { skipSignatureCheck: true, provider: 'doku' });

    const dokuPayment = db.prepare('SELECT provider, payment_method, payment_status FROM order_payments WHERE order_id = ?').get(dokuOrderId);
    assert.equal(dokuPayment.provider, 'doku', 'Webhook DOKU harus mencatat provider = "doku"');
    assert.equal(dokuPayment.payment_method, 'doku');
    assert.equal(dokuPayment.payment_status, 'settlement');

    // 18.2 Midtrans webhook
    const midtransOrderId = `ord_mid_wh_iso_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Midtrans WH Cust', '08123', 'delivery', 'customer_app', 30000, 30000, 'midtrans', 'pending')
    `).run(midtransOrderId, `XN-${midtransOrderId}`, BRAND_ID, BRANCH_ID);

    PaymentGatewayService.handleWebhook({
      order_id: midtransOrderId,
      transaction_status: 'settlement',
      gross_amount: '30000.00',
      payment_type: 'qris',
      fraud_status: 'accept',
      status_code: '200'
    }, { skipSignatureCheck: true, provider: 'midtrans' });

    const midtransPayment = db.prepare('SELECT provider, payment_method, payment_status FROM order_payments WHERE order_id = ?').get(midtransOrderId);
    assert.equal(midtransPayment.provider, 'midtrans', 'Webhook Midtrans harus mencatat provider = "midtrans"');
    assert.equal(midtransPayment.payment_method, 'midtrans');
    assert.equal(midtransPayment.payment_status, 'settlement');
  });

  // ── 19. Reporting distinguishes provider DOKU and Midtrans ──
  await t.test('REG-19: PaymentReportService & overview report distinguishes DOKU and Midtrans', async () => {
    const { ReportingEngine } = require('../domains/reporting');
    const report = ReportingEngine.generateReport('payment', {
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID
    });

    assert.ok(report.summary, 'Report summary harus ada');
    assert.ok('doku_settled' in report.summary, 'doku_settled harus ada di report summary');
    assert.ok('midtrans_settled' in report.summary, 'midtrans_settled harus ada di report summary');
    assert.ok(report.summary.doku_settled >= 25000, 'doku_settled harus mencakup transaksi DOKU yang settlement');
    assert.ok(report.summary.midtrans_settled >= 30000, 'midtrans_settled harus mencakup transaksi Midtrans yang settlement');
  });
});

