'use strict';

/**
 * P3 PRODUCT/CATALOG — GET /catalog/menu?branch_id=
 *
 * The brand-wide /catalog/menu route stays the legacy fast path. When a branch
 * context is explicitly requested the route must delegate to the canonical
 * commerce CatalogService (branch price override, C1 operational availability,
 * branch stock estimate) AND fail closed (400) for an unknown/inactive branch
 * instead of silently re-scoping the menu.
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');

const BARAT = 'branch_bangjo_barat';
const BRAND = 'brand_bangjo';

// Helper to make mock requests to Express app (same harness as apiEndpoints.test.js)
async function mockFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

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

    let statusCode = 200;
    let responseData = null;

    const res = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        this.headers[k] = v;
      },
      getHeader(k) {
        return this.headers[k];
      },
      writeHead(code, headers) {
        this.statusCode = code;
        if (headers) Object.assign(this.headers, headers);
      },
      json(data) {
        resolve({ status: this.statusCode, json: async () => data });
      },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch (_) {}
        }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch (_) {}
        }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    app(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

function findProduct(brandProducts, id) {
  return brandProducts.find((p) => String(p.id) === String(id));
}

test('P3-01 GET /catalog/menu?branch_id=<active branch>: returns branch-scoped menu with explicit server availability & stock', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.categories.length > 0, 'categories present');
  assert.ok(data.all_products.length >= 7, 'all seeded branch products present');

  for (const p of data.all_products) {
    // The branch-scoped projection carries the server-computed flags; the client
    // may only display them.
    assert.strictEqual(typeof p.is_available, 'boolean', `is_available must be explicit for ${p.id}`);
    assert.strictEqual(p.stock_estimate, 100, `seeded branch stock for ${p.id}`);
    assert.strictEqual(p.is_available, true, `seeded products are available at ${BARAT}`);
    assert.ok(p.image_url !== undefined, 'image kept in projection');
    assert.ok(p.regular_price > 0 && p.sale_price > 0, 'pricing projected');
  }

  // Category tree also carries the branch-scoped products.
  const rekom = data.categories.find((c) => String(c.name).toLowerCase() === 'rekom');
  assert.ok(rekom && rekom.products.length > 0, 'Rekom category still populated in branch scope');
});

test('P3-02 branch price override is honored and is_available reflects the flag', async () => {
  // Master product 272 is LOCK by default (branch can't change price). Switch it
  // to RANGE with an in-range override to prove branch pricing resolves.
  db.prepare(`UPDATE products SET pricing_mode = 'range', min_price = 20000, max_price = 40000 WHERE id = '272' AND brand_id = ?`).run(BRAND);
  db.prepare(`UPDATE branch_products SET price = 20000, stock = 7, is_available = 0 WHERE branch_id = ? AND product_id = '272'`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'product 272 present');
  assert.strictEqual(p272.sale_price, 20000, 'branch override resolved as effective price');
  assert.strictEqual(p272.price, 20000, 'effective price field');
  assert.strictEqual(p272.regular_price, 35000, 'owner base price preserved separately');
  assert.strictEqual(p272.is_overridden, true, 'range override flagged');
  assert.strictEqual(p272.is_available, false, 'is_available=0 at branch must surface to the client');
  assert.strictEqual(p272.stock_estimate, 7, 'branch stock surfaces');

  const p345 = findProduct(data.all_products, '345');
  assert.ok(p345);
  assert.strictEqual(p345.is_available, true, 'unmodified product stays available');
  assert.strictEqual(p345.stock_estimate, 100);
});

test('P3-03 master product without a branch_products row is listed but unavailable at that branch', async () => {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order) VALUES ('prod_p3_unassigned', ?, '34', 'Menu Tanpa Cabang', 'menu-tanpa-cabang', 'Tidak dialokasikan ke cabang manapun.', 25000, 1, 99)`).run(BRAND);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const unassigned = findProduct(data.all_products, 'prod_p3_unassigned');
  assert.ok(unassigned, 'product listed in branch menu');
  assert.strictEqual(unassigned.is_available, false, 'unassigned (missing branch row) is NOT available');
  assert.strictEqual(unassigned.stock_estimate, 0, 'unassigned stock resolves to 0, never a fake number');
});

test('P3-04 unknown branch id fails closed (400) instead of silently re-scoping', async () => {
  const res = await mockFetch('/api/v1/catalog/menu?branch_id=branch_no_such_branch');
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'branch not found');
});

test('P3-05 inactive branch fails closed (400) even when it belongs to the brand', async () => {
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_p3_inactive', ?, 'Nonaktif', 'nonaktif', 'Jl. Contoh No.1', 0, 0, 0)`).run(BRAND);

  const res = await mockFetch('/api/v1/catalog/menu?branch_id=branch_p3_inactive');
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'branch is inactive');
});

test('P3-06 brand-wide /catalog/menu (no branch context) keeps the legacy shape untouched', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.all_products.length >= 7);
  // Legacy brand-wide projection must NOT gain the branch-scoped flags.
  assert.strictEqual(data.all_products[0].is_available, undefined, 'no availability flag appears without a branch scope');
  assert.strictEqual(data.all_products[0].stock_estimate, undefined, 'no stock estimate appears without a branch scope');
});