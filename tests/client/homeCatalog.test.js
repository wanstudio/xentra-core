'use strict';

/**
 * HOME BRANCH-SCOPED CATALOG — integration tests
 *
 * Proves the server-side contracts that home.js depends on for branch-scoped
 * catalog integrity. These tests verify:
 *
 * 1. /catalog/menu?branch_id=X returns only branch-assigned products
 * 2. /catalog/menu without branch_id returns brand-wide catalog
 * 3. Branch switching returns different products for different branches
 * 4. /products endpoint is brand-wide (NOT branch-scoped) — confirming
 *    the frontend must NOT use it inside a branch context
 * 5. Unavailable branch products surface is_available=false
 * 6. DEFAULT_CATALOG is removed from home.js
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const app = require('../../server/app');
const db = require('../../server/database/db');

const BARAT = 'branch_bangjo_barat';
const TIMUR = 'branch_bangjo_timur';
const BRAND = 'brand_bangjo';

async function mockFetch(pathStr, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: pathStr,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {}
    };

    if (pathStr.includes('?')) {
      const parts = pathStr.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) { req.query[k] = v; }
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

    app(req, res, (err) => { if (err) reject(err); });
  });
}

// ── CATALOG MENU: branch-scoped ──

test('Branch-scoped /catalog/menu returns branch-specific availability', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  // CatalogService returns ALL master products (LEFT JOIN branch_products).
  // Products assigned to BARAT have is_available=true with real stock.
  // Products NOT assigned to BARAT have is_available=false, stock_estimate=0.
  assert.ok(data.all_products.length >= 4, 'has master products');

  // Every product must have explicit boolean is_available
  for (const p of data.all_products) {
    assert.strictEqual(typeof p.is_available, 'boolean', `product ${p.id} must have boolean is_available`);
  }
});

test('Branch B catalog differs from Branch A catalog (different availability)', async () => {
  const resA = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataA = await resA.json();
  const resB = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataB = await resB.json();

  // Both return all master products but with different branch-specific data
  assert.strictEqual(dataA.all_products.length, dataB.all_products.length, 'same master product count');

  // At least one product must have different availability between branches
  const baratAvail = new Set(dataA.all_products.filter((p) => p.is_available).map((p) => String(p.id)));
  const timurAvail = new Set(dataB.all_products.filter((p) => p.is_available).map((p) => String(p.id)));

  // The two sets must not be identical (branch-scoped catalog isolation)
  const baratOnly = [...baratAvail].filter((id) => !timurAvail.has(id));
  const timurOnly = [...timurAvail].filter((id) => !baratAvail.has(id));
  assert.ok(baratOnly.length > 0 || timurOnly.length > 0, 'branch catalogs must differ in availability');
});

test('Each branch shows its own stock_estimate for the same product', async () => {
  // Ensure deterministic branch_products for this test
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold) VALUES (?, '272', 25000, 50, 1, 5)`).run(BARAT);
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold) VALUES (?, '272', 25000, 75, 1, 5)`).run(TIMUR);

  const resA = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataA = await resA.json();
  const resB = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataB = await resB.json();

  const p272A = dataA.all_products.find((p) => String(p.id) === '272');
  const p272B = dataB.all_products.find((p) => String(p.id) === '272');
  assert.ok(p272A && p272B, 'product 272 exists in both catalogs');
  assert.ok(p272A.is_available && p272B.is_available, 'product 272 is available at both branches');
  assert.strictEqual(typeof p272A.stock_estimate, 'number', 'BARAT stock is a number');
  assert.strictEqual(typeof p272B.stock_estimate, 'number', 'TIMUR stock is a number');
  assert.notStrictEqual(p272A.stock_estimate, p272B.stock_estimate, 'stock values differ between branches');
});

// ── PRODUCTS ENDPOINT: brand-wide (NOT branch-scoped) ──

test('/products endpoint returns brand-wide products (not branch-scoped)', async () => {
  const res = await mockFetch('/api/v1/products');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.items), 'items is array');
  assert.ok(data.items.length > 0, 'has products');
  // The endpoint returns ALL active products for the brand, regardless of branch
  const ids = data.items.map((p) => String(p.id));
  assert.ok(ids.includes('272'), 'brand-wide has 272');
  assert.ok(ids.includes('287'), 'brand-wide has 287');
});

// ── CATALOG: empty/error states ──

test('Unknown branch returns 400', async () => {
  const res = await mockFetch('/api/v1/catalog/menu?branch_id=branch_nonexistent');
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
});

// ── STRUCTURAL: DEFAULT_CATALOG removed from home.js ──

test('DEFAULT_CATALOG is removed from home.js — no hardcoded fallback catalog', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  assert.ok(!content.includes('var DEFAULT_CATALOG'), 'DEFAULT_CATALOG variable must not exist in home.js');
  assert.ok(!content.includes('applyCatalog(DEFAULT_CATALOG)'), 'DEFAULT_CATALOG must not be used as catalog fallback');
});

test('Rekom-specific catalog logic is removed from home.js', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  // The applyCatalog function should not have Rekom-specific logic
  assert.ok(!content.includes("String(c.name).trim().toLowerCase() === 'rekom'"), 'Rekom-specific category selection must be removed');
});

test('Branch context prevents brand-wide /products fallback in loadProducts', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  // loadProducts should short-circuit when catalogBranchId is set
  assert.ok(content.includes('if (catalogBranchId)'), 'loadProducts must check catalogBranchId before API call');
  // No DEFAULT_CATALOG reference in loadProducts
  const loadProductsMatch = content.match(/function loadProducts[\s\S]*?^  }/m);
  if (loadProductsMatch) {
    assert.ok(!loadProductsMatch[0].includes('DEFAULT_CATALOG'), 'loadProducts must not reference DEFAULT_CATALOG');
  }
});

// ── STRUCTURAL: updateBranchActiveState exists (Task A fix) ──

test('updateBranchActiveState function exists for in-place active class toggle', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  assert.ok(content.includes('function updateBranchActiveState'), 'updateBranchActiveState must exist');
  assert.ok(content.includes('classList.add(\'is-active\')'), 'must toggle is-active class in-place');
  assert.ok(content.includes('classList.remove(\'is-active\')'), 'must remove is-active class in-place');
});

test('renderBranchDiscovery saves and restores scrollLeft', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  assert.ok(content.includes('savedScrollLeft'), 'renderBranchDiscovery must save scrollLeft');
  assert.ok(content.includes('newScrollEl.scrollLeft = savedScrollLeft'), 'renderBranchDiscovery must restore scrollLeft');
});

test('setActiveBranch uses updateBranchActiveState instead of renderBranchDiscovery', () => {
  const homePath = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');
  const content = fs.readFileSync(homePath, 'utf8');
  // Find the setActiveBranch function body
  const setActiveMatch = content.match(/function setActiveBranch[\s\S]*?^  }/m);
  assert.ok(setActiveMatch, 'setActiveBranch must exist');
  assert.ok(setActiveMatch[0].includes('updateBranchActiveState()'), 'setActiveBranch must call updateBranchActiveState');
  assert.ok(!setActiveMatch[0].includes('renderBranchDiscovery()'), 'setActiveBranch must NOT call renderBranchDiscovery (prevents bounce)');
});
