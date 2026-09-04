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
  // Ensure a known baseline for seeded products
  db.prepare(`UPDATE branch_products SET stock = 100, is_available = 1 WHERE branch_id = ? AND product_id IN ('272', '285', '345')`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.categories.length > 0, 'categories present');
  assert.ok(data.all_products.length >= 7, 'all seeded branch products present');

  for (const p of data.all_products) {
    assert.strictEqual(typeof p.is_available, 'boolean', `is_available must be explicit for ${p.id}`);
    assert.ok(p.image_url !== undefined, 'image kept in projection');
    assert.ok(p.regular_price > 0 && p.sale_price > 0, 'pricing projected');
  }

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'seeded product 272 present');
  assert.strictEqual(p272.stock_estimate, 100, 'seeded branch stock for 272');
  assert.strictEqual(p272.is_available, true, 'seeded product 272 is available');

  const rekom = data.categories.find((c) => String(c.name).toLowerCase() === 'rekom');
  assert.ok(rekom && rekom.products.length > 0, 'Rekom category still populated in branch scope');
});

test('P3-02 branch price override is honored and is_available reflects the flag', async () => {
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

  db.prepare(`UPDATE products SET pricing_mode = 'lock', min_price = NULL, max_price = NULL WHERE id = '272' AND brand_id = ?`).run(BRAND);
  db.prepare(`UPDATE branch_products SET price = 35000, stock = 100, is_available = 1 WHERE branch_id = ? AND product_id = '272'`).run(BARAT);
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

test('P3-06 brand-wide /catalog/menu (no branch context) uses CatalogService and returns coherent projection', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.all_products.length >= 7);
  // Brand-wide CatalogService projection: all active master products are listed
  // as available (no branch availability filter) with stock_estimate null
  // (no branch scope).
  assert.strictEqual(data.all_products[0].is_available, true, 'brand-wide products are marked available (no branch filter)');
  assert.strictEqual(data.all_products[0].stock_estimate, null, 'brand-wide stock_estimate is null (no branch scope)');
});

test('P3-07 product assigned to branch is visible in branch-scoped catalog', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'product 272 assigned to BARAT is visible');
  assert.strictEqual(p272.is_available, true, 'assigned product is available');
  assert.strictEqual(p272.stock_estimate, 100, 'seeded branch stock');
});

test('P3-08 product not assigned to branch shows as unavailable with stock 0', async () => {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order) VALUES ('prod_p3_only_other', ?, '34', 'Produk Lain', 'produk-lain', 'Hanya di cabang lain', 10000, 1, 98)`).run(BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_p3_other', ?, 'Cabang Lain', 'cabang-lain', 'Jl. Timur', -7.28, 112.75, 1)`).run(BRAND);
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES ('branch_p3_other', 'prod_p3_only_other', 10000, 50, 1)`).run();

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const unassigned = findProduct(data.all_products, 'prod_p3_only_other');
  assert.ok(unassigned, 'product exists in master catalog and is listed');
  assert.strictEqual(unassigned.is_available, false, 'not assigned to BARAT → unavailable');
  assert.strictEqual(unassigned.stock_estimate, 0, 'no branch row → stock resolves to 0');
});

test('P3-09 unavailable branch product (is_available=0) is not treated as available', async () => {
  db.prepare(`UPDATE branch_products SET is_available = 0 WHERE branch_id = ? AND product_id = '285'`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const p285 = findProduct(data.all_products, '285');
  assert.ok(p285, 'product 285 still listed');
  assert.strictEqual(p285.is_available, false, 'is_available=0 surfaces as unavailable');

  db.prepare(`UPDATE branch_products SET is_available = 1 WHERE branch_id = ? AND product_id = '285'`).run(BARAT);
});

test('P3-10 branch-specific stock is surfaced correctly', async () => {
  db.prepare(`UPDATE branch_products SET stock = 3 WHERE branch_id = ? AND product_id = '345'`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();
  const p345 = findProduct(data.all_products, '345');
  assert.strictEqual(p345.stock_estimate, 3, 'branch stock override surfaces');

  db.prepare(`UPDATE branch_products SET stock = 100 WHERE branch_id = ? AND product_id = '345'`).run(BARAT);
});

test('P3-11 empty category does not cause cross-branch product leakage (no Rekom fallback)', async () => {
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, sort_order) VALUES (99901, ?, 'Kosong', 'kosong', 99)`).run(BRAND);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const empty = data.categories.find((c) => String(c.id) === '99901');
  assert.ok(empty, 'empty category present');
  assert.strictEqual(empty.products.length, 0, 'empty category has zero products — no brand-wide injection');
});

test('P3-12 Rekom category shows only its own category products, not products from other categories', async () => {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order) VALUES ('prod_p3_minuman_only', ?, '22', 'Minuman Khusus', 'minuman-khusus', 'Produk kategori Minuman', 10000, 1, 97)`).run(BRAND);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();
  const rekom = data.categories.find((c) => String(c.name).toLowerCase() === 'rekom');
  assert.ok(rekom, 'Rekom category exists');

  const minumanProduct = rekom.products.find((p) => String(p.id) === 'prod_p3_minuman_only');
  assert.ok(!minumanProduct, 'Rekom does NOT inject products from other categories (Minuman)');
});

test('P3-13 same product assigned to two branches: each branch sees its own stock/availability', async () => {
  db.prepare(`UPDATE branch_products SET stock = 100, is_available = 1 WHERE branch_id = ? AND product_id = '272'`).run(BARAT);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_p3_dual', ?, 'Dual Branch', 'dual', 'Jl. Dual', -7.27, 112.76, 1)`).run(BRAND);
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES ('branch_p3_dual', '272', 35000, 7, 1)`).run();

  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();
  const p272Barat = findProduct(dataBarat.all_products, '272');
  assert.strictEqual(p272Barat.stock_estimate, 100, 'BARAT sees its own stock');

  const resDual = await mockFetch(`/api/v1/catalog/menu?branch_id=branch_p3_dual`);
  const dataDual = await resDual.json();
  const p272Dual = findProduct(dataDual.all_products, '272');
  assert.strictEqual(p272Dual.stock_estimate, 7, 'dual branch sees its own stock');
});

test('P3-14 brand-wide catalog does not leak branch stock or availability flags', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  const data = await res.json();
  for (const p of data.all_products) {
    assert.strictEqual(p.stock_estimate, null, `brand-wide ${p.id} has null stock_estimate`);
    assert.strictEqual(typeof p.is_available, 'boolean', `brand-wide ${p.id} has boolean is_available`);
  }
});