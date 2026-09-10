'use strict';

/**
 * P3 PRODUCT/CATALOG — GET /catalog/menu?branch_id=
 *
 * Branch-scoped catalog via Connector. When a branch context is explicitly
 * requested the route delegates to XentraConnectorClient.getCatalog() and
 * maps the connector response to the existing Public API response shape.
 * Branch validation (exists, belongs to brand, is active) stays in Core.
 *
 * Brand-wide catalog (no branch_id) still reads from Core DB via CatalogService.
 *
 * BRANCH CATALOG MODEL: Connector is the source of truth for branch context.
 * Core must NOT fall back to Core DB for branch catalog data.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const { installConnectorMock, restoreConnectorMock, setConnectorHandler, makeConnectorNotFound } = require('./helpers/connectorMock');

const BARAT = 'branch_bangjo_barat';
const TIMUR = 'branch_bangjo_timur';
const BRAND = 'brand_bangjo';

// We need to re-require the app AFTER installing the mock so the route picks it up.
const APP_PATH = require.resolve('../server/app');
function getFreshApp() {
  delete require.cache[APP_PATH];
  return require('../server/app');
}

async function mockFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;
  const targetApp = getFreshApp();

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {}
    };

    if (path.includes('?')) {
      const parts = path.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) {
        req.query[k] = v;
      }
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); },
      json(data) { resolve({ status: this.statusCode, json: async () => data }); },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    targetApp(req, res, (err) => { if (err) reject(err); });
  });
}

function findProduct(brandProducts, id) {
  return brandProducts.find((p) => String(p.id) === String(id));
}

// --- Connector mock response data ---
const BARAT_CATEGORIES = [
  { id: 'bc_barat_favorit', name: 'Menu Favorit', image_url: 'favorit.jpg', sort_order: 1 },
  { id: 'bc_barat_minuman', name: 'Minuman Segar', image_url: null, sort_order: 2 }
];

const BARAT_ITEMS = [
  { product_id: '272', branch_id: BARAT, category_id: 'bc_barat_favorit', name: 'Nasi Goreng', slug: 'nasi-goreng', description: 'Nasi goreng spesial', image_url: 'nasi-goreng.jpg', price: 25000, is_available: 1, stock: 50, low_stock_threshold: 5, category_name: 'Menu Favorit' },
  { product_id: '285', branch_id: BARAT, category_id: 'bc_barat_favorit', name: 'Ayam Geprek', slug: 'ayam-geprek', description: 'Ayam geprek pedas', image_url: 'ayam-geprek.jpg', price: 22000, is_available: 0, stock: 30, low_stock_threshold: 5, category_name: 'Menu Favorit' },
  { product_id: '345', branch_id: BARAT, category_id: 'bc_barat_minuman', name: 'Es Teh', slug: 'es-teh', description: 'Es teh manis', image_url: 'es-teh.jpg', price: 8000, is_available: 1, stock: 40, low_stock_threshold: 5, category_name: 'Minuman Segar' },
  { product_id: '288', branch_id: BARAT, category_id: 'bc_barat_minuman', name: 'Es Jeruk', slug: 'es-jeruk', description: 'Es jeruk segar', image_url: 'es-jeruk.jpg', price: 10000, is_available: 1, stock: 25, low_stock_threshold: 5, category_name: 'Minuman Segar' }
];

const TIMUR_CATEGORIES = [
  { id: 'bc_timur_paket', name: 'Paket Hemat', image_url: null, sort_order: 1 },
  { id: 'bc_timur_kopi', name: 'Kopi & Teh', image_url: 'kopi.jpg', sort_order: 2 }
];

const TIMUR_ITEMS = [
  { product_id: '272', branch_id: TIMUR, category_id: 'bc_timur_paket', name: 'Nasi Goreng', slug: 'nasi-goreng', description: 'Nasi goreng spesial', image_url: 'nasi-goreng.jpg', price: 20000, is_available: 1, stock: 75, low_stock_threshold: 5, category_name: 'Paket Hemat' },
  { product_id: '345', branch_id: TIMUR, category_id: 'bc_timur_paket', name: 'Paket Nasi + Teh', slug: 'paket-nasi-teh', description: 'Paket hemat', image_url: 'paket.jpg', price: 25000, is_available: 1, stock: 60, low_stock_threshold: 5, category_name: 'Paket Hemat' },
  { product_id: '287', branch_id: TIMUR, category_id: 'bc_timur_kopi', name: 'Kopi Susu', slug: 'kopi-susu', description: 'Kopi susu kekinian', image_url: 'kopi-susu.jpg', price: 18000, is_available: 1, stock: 35, low_stock_threshold: 5, category_name: 'Kopi & Teh' }
];

function branchCatalogHandler(op, branchId) {
  if (branchId === BARAT) return { branch_id: BARAT, categories: BARAT_CATEGORIES, items: BARAT_ITEMS };
  if (branchId === TIMUR) return { branch_id: TIMUR, categories: TIMUR_CATEGORIES, items: TIMUR_ITEMS };
  return { branch_id: branchId, categories: [], items: [] };
}

// --- Tests ---

test('P3-01 branch-scoped catalog returns connector-sourced products with correct fields', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.categories.length > 0, 'branch categories present');
  assert.ok(data.all_products.length >= 4, 'branch-adopted products present');

  for (const p of data.all_products) {
    assert.strictEqual(typeof p.is_available, 'boolean', `is_available must be boolean for ${p.id}`);
  }

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'Nasi Goreng present at BARAT');
  assert.strictEqual(p272.is_available, true, 'assigned product is available');
  assert.strictEqual(p272.price, 25000, 'connector price surfaces');
  assert.strictEqual(p272.stock_estimate, 50, 'connector stock surfaces');

  const favorit = data.categories.find((c) => String(c.name).toLowerCase() === 'menu favorit');
  assert.ok(favorit && favorit.products.length > 0, 'Menu Favorit category populated in branch scope');

  restoreConnectorMock();
});

test('P3-02 branch-scoped catalog maps connector items into correct categories', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();

  const favorit = data.categories.find(c => String(c.id) === 'bc_barat_favorit');
  assert.ok(favorit, 'BARAT Menu Favorit category exists');
  assert.strictEqual(favorit.products.length, 2, 'Menu Favorit has 2 products');
  const favoritIds = favorit.products.map(p => String(p.id));
  assert.ok(favoritIds.includes('272'), 'Nasi Goreng in Menu Favorit');
  assert.ok(favoritIds.includes('285'), 'Ayam Geprek in Menu Favorit');

  const minuman = data.categories.find(c => String(c.id) === 'bc_barat_minuman');
  assert.ok(minuman, 'BARAT Minuman Segar category exists');
  assert.strictEqual(minuman.products.length, 2, 'Minuman Segar has 2 products');
  const minumanIds = minuman.products.map(p => String(p.id));
  assert.ok(minumanIds.includes('345'), 'Es Teh in Minuman Segar');
  assert.ok(minumanIds.includes('288'), 'Es Jeruk in Minuman Segar');

  restoreConnectorMock();
});

test('P3-03 unavailable branch product (is_available=0) is not treated as available', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();

  const p285 = findProduct(data.all_products, '285');
  assert.ok(p285, 'Ayam Geprek listed');
  assert.strictEqual(p285.is_available, false, 'is_available=0 surfaces as unavailable');
  assert.strictEqual(p285.stock_estimate, 30, 'stock still shown even though unavailable');

  restoreConnectorMock();
});

test('P3-04 unknown branch id fails closed (400) instead of calling connector', async () => {
  installConnectorMock();
  makeConnectorNotFound();

  const res = await mockFetch('/api/v1/catalog/menu?branch_id=branch_no_such_branch');
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'branch not found');

  restoreConnectorMock();
});

test('P3-05 inactive branch fails closed (400) even when it belongs to the brand', async () => {
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_p3_inactive', ?, 'Nonaktif', 'nonaktif', 'Jl. Contoh No.1', 0, 0, 0)`).run(BRAND);

  installConnectorMock();
  makeConnectorNotFound();

  const res = await mockFetch('/api/v1/catalog/menu?branch_id=branch_p3_inactive');
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'branch is inactive');

  restoreConnectorMock();
});

test('P3-06 brand-wide catalog uses CatalogService (Core DB) — no connector', async () => {
  installConnectorMock();
  makeConnectorNotFound();

  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.all_products.length >= 5, 'all active brand products present');
  assert.strictEqual(data.all_products[0].is_available, true, 'brand-wide products are marked available');
  assert.strictEqual(data.all_products[0].stock_estimate, null, 'brand-wide stock_estimate is null');

  restoreConnectorMock();
});

test('P3-07 branch categories do not leak across branches', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();

  const baratCatNames = dataBarat.categories.map(c => c.name);
  const timurCatNames = dataTimur.categories.map(c => c.name);

  assert.ok(baratCatNames.includes('Menu Favorit'), 'BARAT has Menu Favorit');
  assert.ok(baratCatNames.includes('Minuman Segar'), 'BARAT has Minuman Segar');
  assert.ok(!baratCatNames.includes('Paket Hemat'), 'BARAT does NOT have TIMUR category');

  assert.ok(timurCatNames.includes('Paket Hemat'), 'TIMUR has Paket Hemat');
  assert.ok(timurCatNames.includes('Kopi & Teh'), 'TIMUR has Kopi & Teh');
  assert.ok(!timurCatNames.includes('Menu Favorit'), 'TIMUR does NOT have BARAT category');

  restoreConnectorMock();
});

test('P3-08 same product in different branch categories: each branch sees its own placement', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();
  const p272Barat = findProduct(dataBarat.all_products, '272');
  assert.ok(p272Barat, 'BARAT has Nasi Goreng');
  assert.strictEqual(String(p272Barat.category_id), 'bc_barat_favorit', 'BARAT places Nasi Goreng in Menu Favorit');

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();
  const p272Timur = findProduct(dataTimur.all_products, '272');
  assert.ok(p272Timur, 'TIMUR has Nasi Goreng');
  assert.strictEqual(String(p272Timur.category_id), 'bc_timur_paket', 'TIMUR places Nasi Goreng in Paket Hemat');

  const baratFavorit = dataBarat.categories.find(c => String(c.id) === 'bc_barat_favorit');
  assert.ok(baratFavorit, 'BARAT Menu Favorit category exists');
  const baratNasiGoreng = baratFavorit.products.find(p => String(p.id) === '272');
  assert.ok(baratNasiGoreng, 'Nasi Goreng is in BARAT Menu Favorit');

  const timurPaket = dataTimur.categories.find(c => String(c.id) === 'bc_timur_paket');
  assert.ok(timurPaket, 'TIMUR Paket Hemat category exists');
  const timurNasiGoreng = timurPaket.products.find(p => String(p.id) === '272');
  assert.ok(timurNasiGoreng, 'Nasi Goreng is in TIMUR Paket Hemat');

  restoreConnectorMock();
});

test('P3-09 same product assigned to two branches: each branch sees its own stock', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();
  const p272Barat = findProduct(dataBarat.all_products, '272');
  assert.strictEqual(p272Barat.stock_estimate, 50, 'BARAT sees its own stock');

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();
  const p272Timur = findProduct(dataTimur.all_products, '272');
  assert.strictEqual(p272Timur.stock_estimate, 75, 'TIMUR sees its own stock');

  restoreConnectorMock();
});

test('P3-10 brand-wide catalog does not leak branch stock or availability flags', async () => {
  installConnectorMock();
  makeConnectorNotFound();

  const res = await mockFetch('/api/v1/catalog/menu');
  const data = await res.json();
  for (const p of data.all_products) {
    assert.strictEqual(p.stock_estimate, null, `brand-wide ${p.id} has null stock_estimate`);
    assert.strictEqual(typeof p.is_available, 'boolean', `brand-wide ${p.id} has boolean is_available`);
  }

  restoreConnectorMock();
});

test('P3-11 Branch A has products Branch B does not (and vice versa)', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();

  const baratAvail = dataBarat.all_products.filter((p) => p.is_available).map((p) => String(p.id));
  const timurAvail = dataTimur.all_products.filter((p) => p.is_available).map((p) => String(p.id));

  assert.ok(baratAvail.includes('288'), 'BARAT has Es Jeruk');
  assert.ok(!timurAvail.includes('288'), 'TIMUR does not have Es Jeruk');

  assert.ok(timurAvail.includes('287'), 'TIMUR has Kopi Susu');
  assert.ok(!baratAvail.includes('287'), 'BARAT does not have Kopi Susu');

  restoreConnectorMock();
});

test('P3-12 connector failure returns 502', async () => {
  installConnectorMock();
  setConnectorHandler(() => { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); });

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 502);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'connector catalog unavailable');

  restoreConnectorMock();
});

test('P3-13 connector timeout returns 504', async () => {
  installConnectorMock();
  setConnectorHandler(() => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); });

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 504);
  const data = await res.json();
  assert.strictEqual(data.success, false);

  restoreConnectorMock();
});

test('P3-14 connector not configured returns 503', async () => {
  const MOCK_PATH = require.resolve('../core/integration/XentraConnectorClient');
  const MockClient = class {
    constructor() { throw new Error('Connector not configured'); }
    async getCatalog() {}
  };
  const { XentraConnectorError, SUPPORTED_OPERATIONS, signRequest } = require('../core/integration/XentraConnectorClient');
  require.cache[MOCK_PATH] = {
    id: MOCK_PATH, filename: MOCK_PATH, loaded: true,
    exports: { XentraConnectorClient: MockClient, XentraConnectorError, SUPPORTED_OPERATIONS, signRequest }
  };

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 503);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'branch catalog connector not configured');

  restoreConnectorMock();
});

test('P3-15 response shape matches Customer PWA contract', async () => {
  installConnectorMock();
  setConnectorHandler(branchCatalogHandler);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();

  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories), 'categories is array');
  assert.ok(Array.isArray(data.all_products), 'all_products is array');
  assert.ok(data.products && Array.isArray(data.products.items), 'products.items is array');
  assert.ok(data.promo, 'promo object present');

  for (const cat of data.categories) {
    assert.ok(cat.id, 'category has id');
    assert.ok(cat.name, 'category has name');
    assert.strictEqual(typeof cat.image_url, 'string', 'category has image_url string');
    assert.ok(Array.isArray(cat.products), 'category has products array');
  }

  for (const p of data.all_products) {
    assert.ok(p.id, 'product has id');
    assert.ok(p.name, 'product has name');
    assert.strictEqual(typeof p.is_available, 'boolean', 'product has boolean is_available');
    assert.strictEqual(typeof p.stock_estimate, 'number', 'product has number stock_estimate');
    assert.strictEqual(typeof p.image_url, 'string', 'product has image_url string');
  }

  restoreConnectorMock();
});
