'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../server/database/db');
const ChannelOrderService = require('../domains/commerce/services/ChannelOrderService');
const registerChannelIntegrationRoutes = require('../server/routes/channel-integrations');
const express = require('express');

test('ChannelOrderService: Ingests GoFood, GrabFood, and ShopeeFood with correct financial breakdown', async (t) => {
  const brandId = 'brand_bangjo';
  const branchId = 'branch_1789606246242_08knv';

  // Seed required parent foreign key rows in isolated test database
  db.prepare(`
    INSERT OR IGNORE INTO brands (id, name, slug)
    VALUES (?, ?, ?)
  `).run(brandId, 'MyBangjo', 'mybangjo');

  db.prepare(`
    INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)
  `).run(branchId, brandId, 'MyBangjo Pringsewu', 'mybangjo-pringsewu', 'Jl. KH Gholib');

  // Clean up any previous test orders for clean idempotency
  db.prepare("DELETE FROM external_channel_orders WHERE external_order_id LIKE '%TEST%'").run();
  db.prepare("DELETE FROM orders WHERE external_order_id LIKE '%TEST%'").run();

  const service = new ChannelOrderService(db);

  await t.test('1. Ingests GoFood order correctly with 20% commission + 1000 platform fee', () => {
    const gross = 50000;
    const res = service.ingestChannelOrder({
      channel: 'gofood',
      external_order_id: 'GF-TEST-001',
      brand_id: brandId,
      branch_id: branchId,
      customer_name: 'Budi Santoso',
      driver_name: 'Pak Ojol Gojek',
      gross_amount: gross,
      items: [
        { product_id: '287', name: 'Kopi Jo', price: 18000, quantity: 2 },
        { product_id: '346', name: 'Mie Bang Jo', price: 14000, quantity: 1 }
      ]
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.is_duplicate, false);
    assert.strictEqual(res.channel, 'gofood');
    assert.strictEqual(res.gross_amount, 50000);
    assert.strictEqual(res.commission_amount, 10000); // 20% of 50.000
    assert.strictEqual(res.platform_fee, 1000);
    assert.strictEqual(res.net_revenue, 39000); // 50.000 - 10.000 - 1.000

    // Verify database record in orders
    const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.order_id);
    assert.ok(ord);
    assert.strictEqual(ord.order_channel, 'gofood');
    assert.strictEqual(ord.channel_fee, 11000);
    assert.strictEqual(ord.net_revenue, 39000);
    assert.strictEqual(ord.status, 'confirmed');

    // Verify order_items
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(res.order_id);
    assert.strictEqual(items.length, 2);
  });

  await t.test('2. Idempotency: Reject duplicate external_order_id gracefully', () => {
    const res = service.ingestChannelOrder({
      channel: 'gofood',
      external_order_id: 'GF-TEST-001',
      brand_id: brandId,
      branch_id: branchId,
      gross_amount: 50000
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.is_duplicate, true);
  });

  await t.test('3. Ingests GrabFood order correctly', () => {
    const gross = 100000;
    const res = service.ingestChannelOrder({
      channel: 'grabfood',
      external_order_id: 'GRB-TEST-002',
      brand_id: brandId,
      branch_id: branchId,
      customer_name: 'Siti Rahma',
      driver_name: 'Driver Grab Bike',
      gross_amount: gross
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.channel, 'grabfood');
    assert.strictEqual(res.gross_amount, 100000);
    assert.strictEqual(res.commission_amount, 20000);
    assert.strictEqual(res.platform_fee, 1000);
    assert.strictEqual(res.net_revenue, 79000);
  });

  await t.test('4. Ingests ShopeeFood order correctly', () => {
    const gross = 40000;
    const res = service.ingestChannelOrder({
      channel: 'shopeefood',
      external_order_id: 'SPF-TEST-003',
      brand_id: brandId,
      branch_id: branchId,
      gross_amount: gross
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.channel, 'shopeefood');
    assert.strictEqual(res.gross_amount, 40000);
    assert.strictEqual(res.commission_amount, 8000);
    assert.strictEqual(res.platform_fee, 1000);
    assert.strictEqual(res.net_revenue, 31000);
  });

  await t.test('5. Aggregates channel financial summary for bookkeeping', () => {
    const summary = service.getChannelFinancialSummary({
      brand_id: brandId,
      branch_id: branchId
    });

    assert.ok(Array.isArray(summary));
    const gofoodSum = summary.find(s => s.channel === 'gofood');
    const grabSum = summary.find(s => s.channel === 'grabfood');
    const shopeeSum = summary.find(s => s.channel === 'shopeefood');

    assert.ok(gofoodSum);
    assert.strictEqual(gofoodSum.total_gross, 50000);
    assert.strictEqual(gofoodSum.total_commission_fee, 11000);
    assert.strictEqual(gofoodSum.total_net_payout, 39000);

    assert.ok(grabSum);
    assert.strictEqual(grabSum.total_gross, 100000);
    assert.strictEqual(grabSum.total_net_payout, 79000);

    assert.ok(shopeeSum);
    assert.strictEqual(shopeeSum.total_gross, 40000);
    assert.strictEqual(shopeeSum.total_net_payout, 31000);
  });
});

test('HTTP API: /api/v1/integrations/channel-order and /channel-summary via native mock dispatch', async (t) => {
  const app = express();
  app.use(express.json());

  // Mock authenticated middleware
  const mockAuth = () => (req, res, next) => {
    req.user = {
      id: 'usr_mock_manager',
      role: 'branch_manager',
      brand_id: 'brand_bangjo',
      branchId: 'branch_1789606246242_08knv'
    };
    req.brand_id = 'brand_bangjo';
    next();
  };

  const router = express.Router();
  registerChannelIntegrationRoutes(router, {
    db,
    requireAuth: mockAuth
  });
  app.use('/api/v1', router);

  function dispatch(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const req = {
        method,
        url: path,
        headers: { host: 'm.mybangjo.com', 'content-type': 'application/json' },
        body,
        query: {},
        params: {}
      };

      if (path.includes('?')) {
        const parts = path.split('?');
        req.url = parts[0];
        const params = new URLSearchParams(parts[1]);
        for (const [k, v] of params.entries()) req.query[k] = v;
      }

      const res = {
        statusCode: 200,
        _headers: {},
        setHeader(k, v) { this._headers[k] = v; },
        getHeader(k) { return this._headers[k]; },
        status(code) { this.statusCode = code; return this; },
        json(data) { resolve({ status: this.statusCode, body: data }); },
        send(data) { resolve({ status: this.statusCode, body: data }); },
        end() { resolve({ status: this.statusCode }); }
      };

      app(req, res, (err) => { if (err) reject(err); });
    });
  }

  await t.test('POST /api/v1/integrations/channel-order succeeds', async () => {
    const res = await dispatch('POST', '/api/v1/integrations/channel-order', {
      channel: 'gofood',
      external_order_id: 'GF-HTTP-999',
      gross_amount: 75000,
      customer_name: 'Ahmad Dani',
      driver_name: 'Driver Gojek'
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.gross_amount, 75000);
    assert.strictEqual(res.body.commission_amount, 15000);
    assert.strictEqual(res.body.net_revenue, 59000);
  });

  await t.test('GET /api/v1/integrations/channel-summary returns channels', async () => {
    const res = await dispatch('GET', '/api/v1/integrations/channel-summary');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.some(d => d.channel === 'gofood'));
  });

  await t.test('POST /api/v1/integrations/channel-settings saves custom commission rates', async () => {
    const res = await dispatch('POST', '/api/v1/integrations/channel-settings', {
      branch_id: 'branch_1789606246242_08knv',
      settings: [
        { channel: 'gofood', is_active: true, commission_percent: 18, platform_fee: 1000 },
        { channel: 'grabfood', is_active: true, commission_percent: 22, platform_fee: 1500 },
        { channel: 'shopeefood', is_active: false, commission_percent: 20, platform_fee: 1000 }
      ]
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    const gf = res.body.data.find(d => d.channel === 'gofood');
    assert.strictEqual(gf.commission_percent, 18);
    const spf = res.body.data.find(d => d.channel === 'shopeefood');
    assert.strictEqual(spf.is_active, false);
  });

  await t.test('GET /api/v1/integrations/channel-settings returns saved config', async () => {
    const res = await dispatch('GET', '/api/v1/integrations/channel-settings?branch_id=branch_1789606246242_08knv');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const grab = res.body.data.find(d => d.channel === 'grabfood');
    assert.strictEqual(grab.commission_percent, 22);
    assert.strictEqual(grab.platform_fee, 1500);
  });

  await t.test('GET /api/v1/integrations/channel-orders returns transaction ledger', async () => {
    const res = await dispatch('GET', '/api/v1/integrations/channel-orders?branch_id=branch_1789606246242_08knv');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.data[0].external_order_id);
    assert.ok(res.body.data[0].gross_amount > 0);
  });
});

