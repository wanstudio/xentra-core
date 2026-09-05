'use strict';

/**
 * P3 PRODUCT/CATALOG — GET /catalog/menu?branch_id=
 *
 * Branch-scoped catalog via CatalogService. When a branch context is explicitly
 * requested the route delegates to the canonical commerce CatalogService (branch
 * price override, C1 operational availability, branch stock estimate) AND fails
 * closed (400) for an unknown/inactive branch.
 *
 * BRANCH CATALOG MODEL: branch_products is the source of truth for branch context.
 * Only adopted products appear. Categories come from branch_categories (Branch-owned).
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');

const BARAT = 'branch_bangjo_barat';
const TIMUR = 'branch_bangjo_timur';
const BRAND = 'brand_bangjo';

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

function findProduct(brandProducts, id) {
  return brandProducts.find((p) => String(p.id) === String(id));
}

test('P3-01 branch-scoped catalog returns adopted products with correct stock and availability', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.categories.length > 0, 'branch categories present');
  assert.ok(data.all_products.length >= 4, 'branch-adopted products present');

  for (const p of data.all_products) {
    assert.strictEqual(typeof p.is_available, 'boolean', `is_available must be explicit for ${p.id}`);
  }

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'Nasi Goreng present at BARAT');
  assert.strictEqual(p272.is_available, true, 'assigned product is available');

  // Branch categories come from branch_categories, not master categories
  const favorit = data.categories.find((c) => String(c.name).toLowerCase() === 'menu favorit');
  assert.ok(favorit && favorit.products.length > 0, 'Menu Favorit category populated in branch scope');
});

test('P3-02 branch price override is honored and is_available reflects the flag', async () => {
  db.prepare(`UPDATE products SET pricing_mode = 'range', min_price = 15000, max_price = 35000 WHERE id = '272' AND brand_id = ?`).run(BRAND);
  db.prepare(`UPDATE branch_products SET price = 20000, stock = 7, is_available = 0 WHERE branch_id = ? AND product_id = '272'`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'product 272 present');
  assert.strictEqual(p272.sale_price, 20000, 'branch override resolved as effective price');
  assert.strictEqual(p272.price, 20000, 'effective price field');
  assert.strictEqual(p272.regular_price, 25000, 'owner base price preserved separately');
  assert.strictEqual(p272.is_overridden, true, 'range override flagged');
  assert.strictEqual(p272.is_available, false, 'is_available=0 at branch must surface to the client');
  assert.strictEqual(p272.stock_estimate, 7, 'branch stock surfaces');

  const p345 = findProduct(data.all_products, '345');
  assert.ok(p345);
  assert.strictEqual(p345.is_available, true, 'unmodified product stays available');

  db.prepare(`UPDATE products SET pricing_mode = 'lock', min_price = NULL, max_price = NULL WHERE id = '272' AND brand_id = ?`).run(BRAND);
  db.prepare(`UPDATE branch_products SET price = 25000, stock = 50, is_available = 1 WHERE branch_id = ? AND product_id = '272'`).run(BARAT);
});

test('P3-03 master product not adopted by a branch does NOT appear in branch catalog', async () => {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order) VALUES ('prod_p3_unassigned', ?, '34', 'Menu Tanpa Cabang', 'menu-tanpa-cabang', 'Tidak dialokasikan ke cabang manapun.', 25000, 1, 99)`).run(BRAND);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  // BRANCH CATALOG MODEL: unassigned products do NOT appear in branch menu at all.
  // Only adopted products (branch_products rows) are shown.
  const unassigned = findProduct(data.all_products, 'prod_p3_unassigned');
  assert.ok(!unassigned, 'unassigned product MUST NOT appear in branch menu (branch catalog is not a filtered master view)');
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

test('P3-06 brand-wide catalog uses CatalogService and returns coherent projection', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.all_products.length >= 5, 'all active brand products present');
  assert.strictEqual(data.all_products[0].is_available, true, 'brand-wide products are marked available');
  assert.strictEqual(data.all_products[0].stock_estimate, null, 'brand-wide stock_estimate is null');
});

test('P3-07 product adopted by branch is visible in branch-scoped catalog', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const p272 = findProduct(data.all_products, '272');
  assert.ok(p272, 'Nasi Goreng adopted by BARAT is visible');
  assert.strictEqual(p272.is_available, true, 'adopted product is available');
});

test('P3-08 product not adopted by branch does NOT appear in branch catalog', async () => {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order) VALUES ('prod_p3_only_other', ?, '34', 'Produk Lain', 'produk-lain', 'Hanya di cabang lain', 10000, 1, 98)`).run(BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_p3_other', ?, 'Cabang Lain', 'cabang-lain', 'Jl. Timur', -7.28, 112.75, 1)`).run(BRAND);
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES ('branch_p3_other', 'prod_p3_only_other', 10000, 50, 1)`).run();

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  // BRANCH CATALOG MODEL: product adopted by another branch does NOT appear here.
  const unassigned = findProduct(data.all_products, 'prod_p3_only_other');
  assert.ok(!unassigned, 'product adopted by another branch MUST NOT appear in this branch menu');
});

test('P3-09 unavailable branch product (is_available=0) is not treated as available', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();

  const p285 = findProduct(data.all_products, '285');
  assert.ok(p285, 'Ayam Geprek still listed (adopted by BARAT)');
  assert.strictEqual(p285.is_available, false, 'is_available=0 surfaces as unavailable');
});

test('P3-10 branch-specific stock is surfaced correctly', async () => {
  db.prepare(`UPDATE branch_products SET stock = 3 WHERE branch_id = ? AND product_id = '345'`).run(BARAT);

  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();
  const p345 = findProduct(data.all_products, '345');
  assert.strictEqual(p345.stock_estimate, 3, 'branch stock override surfaces');

  db.prepare(`UPDATE branch_products SET stock = 40 WHERE branch_id = ? AND product_id = '345'`).run(BARAT);
});

test('P3-11 branch categories do not leak products across branches', async () => {
  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();

  // BARAT has its own categories, TIMUR has its own
  const baratCatNames = dataBarat.categories.map(c => c.name);
  const timurCatNames = dataTimur.categories.map(c => c.name);

  assert.ok(baratCatNames.includes('Menu Favorit'), 'BARAT has Menu Favorit');
  assert.ok(baratCatNames.includes('Minuman Segar'), 'BARAT has Minuman Segar');
  assert.ok(!baratCatNames.includes('Paket Hemat'), 'BARAT does NOT have TIMUR category');

  assert.ok(timurCatNames.includes('Paket Hemat'), 'TIMUR has Paket Hemat');
  assert.ok(timurCatNames.includes('Kopi & Teh'), 'TIMUR has Kopi & Teh');
  assert.ok(!timurCatNames.includes('Menu Favorit'), 'TIMUR does NOT have BARAT category');
});

test('P3-12 same product in different branch categories: each branch sees its own placement', async () => {
  // Product 272 (Nasi Goreng) is adopted by both branches into different categories
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

  // Verify the categories reflect this
  const baratFavorit = dataBarat.categories.find(c => String(c.id) === 'bc_barat_favorit');
  assert.ok(baratFavorit, 'BARAT Menu Favorit category exists');
  const baratNasiGoreng = baratFavorit.products.find(p => String(p.id) === '272');
  assert.ok(baratNasiGoreng, 'Nasi Goreng is in BARAT Menu Favorit');

  const timurPaket = dataTimur.categories.find(c => String(c.id) === 'bc_timur_paket');
  assert.ok(timurPaket, 'TIMUR Paket Hemat category exists');
  const timurNasiGoreng = timurPaket.products.find(p => String(p.id) === '272');
  assert.ok(timurNasiGoreng, 'Nasi Goreng is in TIMUR Paket Hemat');
});

test('P3-13 same product assigned to two branches: each branch sees its own stock', async () => {
  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();
  const p272Barat = findProduct(dataBarat.all_products, '272');
  assert.strictEqual(p272Barat.stock_estimate, 50, 'BARAT sees its own stock');

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();
  const p272Timur = findProduct(dataTimur.all_products, '272');
  assert.strictEqual(p272Timur.stock_estimate, 75, 'TIMUR sees its own stock');
});

test('P3-14 brand-wide catalog does not leak branch stock or availability flags', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  const data = await res.json();
  for (const p of data.all_products) {
    assert.strictEqual(p.stock_estimate, null, `brand-wide ${p.id} has null stock_estimate`);
    assert.strictEqual(typeof p.is_available, 'boolean', `brand-wide ${p.id} has boolean is_available`);
  }
});

test('P3-15 Branch A has products Branch B does not (and vice versa)', async () => {
  const resBarat = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const dataBarat = await resBarat.json();

  const resTimur = await mockFetch(`/api/v1/catalog/menu?branch_id=${TIMUR}`);
  const dataTimur = await resTimur.json();

  const baratAvail = dataBarat.all_products.filter((p) => p.is_available).map((p) => String(p.id));
  const timurAvail = dataTimur.all_products.filter((p) => p.is_available).map((p) => String(p.id));

  assert.ok(baratAvail.includes('288'), 'BARAT has Es Teh');
  assert.ok(!timurAvail.includes('288'), 'TIMUR does not have Es Teh');

  assert.ok(timurAvail.includes('287'), 'TIMUR has Kopi Susu');
  assert.ok(!baratAvail.includes('287'), 'BARAT does not have Kopi Susu');
});

test('P3-16 Product 285 (Ayam Geprek) is unavailable at BARAT despite being adopted', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BARAT}`);
  const data = await res.json();
  const p285 = findProduct(data.all_products, '285');
  assert.ok(p285, 'Ayam Geprek listed (adopted by BARAT)');
  assert.strictEqual(p285.is_available, false, 'is_available=0 respected');
  assert.strictEqual(p285.stock_estimate, 30, 'stock still shown even though unavailable');
});
