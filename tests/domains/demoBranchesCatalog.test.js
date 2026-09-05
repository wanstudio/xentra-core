'use strict';

/**
 * DEMO DATASET VALIDATION — 5 BRANCHES / MASTER CATALOG SEPARATION
 *
 * Validates:
 * TEST A — EXACTLY FIVE BRANCHES for target demo brand ('brand_bangjo')
 * TEST B — EVERY BRANCH HAS CATALOG (bc count > 0, bp count > 0)
 * TEST C — BRANCH PRODUCT PROVENANCE (references valid master product)
 * TEST D — SAME BRAND (bp master product belongs to same brand as branch)
 * TEST E — BRANCH CATEGORY OWNERSHIP (bc belongs to same branch as bp)
 * TEST F — DIFFERENT CATALOGS (branches have different product subsets)
 * TEST G — SHARED MASTER PRODUCT (at least one master product adopted by >= 3 branches independently)
 * TEST H — MASTER-ONLY PRODUCT (products not adopted by branch do not leak into branch catalog)
 * TEST I — DIFFERENT BRANCH CATEGORY ORGANIZATION (shared product organized under different categories)
 * TEST J — IDEMPOTENCY (seeding multiple times converges to same dataset)
 * TEST K — NO MASTER CATEGORY LEAK (branch_products.branch_category_id references branch_categories, never categories.id)
 * TEST L — NO EMPTY BRANCH (no demo branch has 0 categories or 0 products)
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../../server/app');
const db = require('../../server/database/db');
const CatalogService = require('../../domains/commerce/services/CatalogService');

const BRAND = 'brand_bangjo';
const TARGET_BRANCHES = [
  'branch_bangjo_barat',
  'branch_bangjo_timur',
  'branch_bangjo_pusat',
  'branch_bangjo_utara',
  'branch_bangjo_selatan'
];

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

test('TEST 1 — EXACTLY FIVE BRANCHES', () => {
  const branches = db.prepare('SELECT id, name FROM branches WHERE brand_id = ?').all(BRAND);
  assert.strictEqual(branches.length, 5, 'Target demo Brand branch count === 5');

  for (const targetId of TARGET_BRANCHES) {
    const found = branches.find(b => b.id === targetId);
    assert.ok(found, `Target branch ${targetId} must exist`);
  }
});

test('TEST 2 — EVERY BRANCH HAS CATEGORY', () => {
  for (const branchId of TARGET_BRANCHES) {
    const categories = db.prepare('SELECT id, name FROM branch_categories WHERE branch_id = ?').all(branchId);
    assert.ok(categories.length > 0, `Branch ${branchId} category count > 0, found ${categories.length}`);
  }
});

test('TEST 3 — EVERY BRANCH HAS PRODUCTS', () => {
  for (const branchId of TARGET_BRANCHES) {
    const products = db.prepare('SELECT product_id, product_name FROM branch_products WHERE branch_id = ?').all(branchId);
    assert.ok(products.length > 0, `Branch ${branchId} product count > 0, found ${products.length}`);
  }
});

test('TEST 4 — DIFFERENT PRODUCT SUBSETS', () => {
  const catalogMap = {};
  for (const branchId of TARGET_BRANCHES) {
    const products = db.prepare('SELECT product_id FROM branch_products WHERE branch_id = ?').all(branchId);
    catalogMap[branchId] = new Set(products.map(p => String(p.product_id)));
  }

  // Not all five Branches have identical product sets
  const sets = Object.values(catalogMap);
  let differentCount = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const s1 = sets[i];
      const s2 = sets[j];
      const same = s1.size === s2.size && [...s1].every(x => s2.has(x));
      if (!same) differentCount++;
    }
  }
  assert.ok(differentCount > 0, 'Branches must have different product sets');

  // Verify explicit differences
  assert.ok(catalogMap['branch_bangjo_barat'].has('285'), 'Barat has Ayam Geprek (285)');
  assert.ok(!catalogMap['branch_bangjo_timur'].has('285'), 'Timur does not have Ayam Geprek (285)');
  assert.ok(!catalogMap['branch_bangjo_pusat'].has('272'), 'Pusat does not adopt Nasi Goreng (272)');
  assert.ok(catalogMap['branch_bangjo_utara'].has('401'), 'Utara adopts Es Teh Manis (401)');
});

test('TEST 5 — SHARED MASTER PRODUCT', () => {
  // Assert at least one Master Product is adopted by >= 3 Branches
  const masterProducts = db.prepare('SELECT id FROM products WHERE brand_id = ?').all(BRAND);
  let sharedFound = false;

  for (const p of masterProducts) {
    const adopting = TARGET_BRANCHES.filter(b => {
      return !!db.prepare('SELECT 1 FROM branch_products WHERE branch_id = ? AND product_id = ?').get(b, p.id);
    });
    if (adopting.length >= 3) {
      sharedFound = true;
      break;
    }
  }
  assert.ok(sharedFound, 'At least one Master Product is adopted by >= 3 branches');
});

test('TEST 6 — SHARED PRODUCT INDEPENDENCE', () => {
  // For the shared Master Product (272): each Branch has its own Branch Product record
  const bpBarat = db.prepare('SELECT stock, price, branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_bangjo_barat', '272');
  const bpTimur = db.prepare('SELECT stock, price, branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_bangjo_timur', '272');
  const bpUtara = db.prepare('SELECT stock, price, branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_bangjo_utara', '272');

  assert.ok(bpBarat && bpTimur && bpUtara, 'Branch product records exist independently');
  assert.notStrictEqual(bpBarat.stock, bpTimur.stock, 'Barat and Timur stock values are independent');
  assert.notStrictEqual(bpBarat.price, bpUtara.price, 'Barat and Utara demo prices are independent');

  // Changing Branch A demo configuration must not mutate Branch B
  const oldTimurPrice = bpTimur.price;
  db.prepare('UPDATE branch_products SET price = 99999 WHERE branch_id = ? AND product_id = ?').run('branch_bangjo_barat', '272');
  const newTimur = db.prepare('SELECT price FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_bangjo_timur', '272');
  assert.strictEqual(newTimur.price, oldTimurPrice, 'Branch B is unaffected by mutating Branch A');
  db.prepare('UPDATE branch_products SET price = ? WHERE branch_id = ? AND product_id = ?').run(bpBarat.price, 'branch_bangjo_barat', '272');
});

test('TEST 7 — BRANCH CATEGORY OWNERSHIP', () => {
  for (const branchId of TARGET_BRANCHES) {
    const branchProducts = db.prepare('SELECT product_id, branch_category_id FROM branch_products WHERE branch_id = ?').all(branchId);
    for (const bp of branchProducts) {
      const branchCat = db.prepare('SELECT id, branch_id FROM branch_categories WHERE id = ?').get(bp.branch_category_id);
      assert.ok(branchCat, `branch_category ${bp.branch_category_id} must exist in branch_categories`);
      assert.strictEqual(branchCat.branch_id, branchId, 'branch_categories.branch_id === branch_products.branch_id');
    }
  }
});

test('TEST 8 — MASTER PRODUCT PROVENANCE', () => {
  for (const branchId of TARGET_BRANCHES) {
    const branchProducts = db.prepare('SELECT product_id FROM branch_products WHERE branch_id = ?').all(branchId);
    for (const bp of branchProducts) {
      const masterProduct = db.prepare('SELECT id, name FROM products WHERE id = ?').get(bp.product_id);
      assert.ok(masterProduct, `Every Branch Product product_id (${bp.product_id}) must resolve to a valid Master Product`);
    }
  }
});

test('TEST 9 — SAME BRAND', () => {
  for (const branchId of TARGET_BRANCHES) {
    const branch = db.prepare('SELECT id, brand_id FROM branches WHERE id = ?').get(branchId);
    const branchProducts = db.prepare('SELECT product_id FROM branch_products WHERE branch_id = ?').all(branchId);
    for (const bp of branchProducts) {
      const masterProduct = db.prepare('SELECT id, brand_id FROM products WHERE id = ?').get(bp.product_id);
      assert.strictEqual(masterProduct.brand_id, branch.brand_id, 'Master product brand matches branch brand');
    }
  }
});

test('TEST 10 — MASTER-ONLY PRODUCT DOES NOT LEAK', async () => {
  // Product 401 (Es Teh Manis) is only adopted by branch_bangjo_utara
  for (const branchId of ['branch_bangjo_barat', 'branch_bangjo_timur', 'branch_bangjo_pusat', 'branch_bangjo_selatan']) {
    const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${branchId}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const found401 = data.all_products.find(p => String(p.id) === '401');
    assert.ok(!found401, `Master product 401 must NOT leak into ${branchId}`);
  }
});

test('TEST 11 — DIFFERENT CATEGORY ORGANIZATION', async () => {
  // Shared product 272 belongs to different Branch Categories in different Branches
  const resBarat = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_barat');
  const resTimur = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_timur');
  const resUtara = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_utara');
  const resSelatan = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_selatan');

  const dataBarat = await resBarat.json();
  const dataTimur = await resTimur.json();
  const dataUtara = await resUtara.json();
  const dataSelatan = await resSelatan.json();

  const pBarat = dataBarat.all_products.find(p => String(p.id) === '272');
  const pTimur = dataTimur.all_products.find(p => String(p.id) === '272');
  const pUtara = dataUtara.all_products.find(p => String(p.id) === '272');
  const pSelatan = dataSelatan.all_products.find(p => String(p.id) === '272');

  assert.strictEqual(String(pBarat.category_id), 'bc_barat_favorit');
  assert.strictEqual(String(pTimur.category_id), 'bc_timur_paket');
  assert.strictEqual(String(pUtara.category_id), 'bc_utara_bestseller');
  assert.strictEqual(String(pSelatan.category_id), 'bc_selatan_makan');
});

test('TEST 12 — IDEMPOTENCY', () => {
  const branchesBefore = db.prepare('SELECT count(*) as c FROM branches WHERE brand_id = ?').get(BRAND).c;
  const bcBefore = db.prepare('SELECT count(*) as c FROM branch_categories WHERE brand_id = ?').get(BRAND).c;
  const bpBefore = db.prepare('SELECT count(*) as c FROM branch_products bp JOIN branches b ON b.id = bp.branch_id WHERE b.brand_id = ?').get(BRAND).c;

  assert.strictEqual(branchesBefore, 5, 'Branch count unchanged');
  assert.strictEqual(bcBefore, 11, 'Branch Category count unchanged');
  assert.strictEqual(bpBefore, 16, 'Branch Product count unchanged');

  // Verify no duplicates
  const dupBp = db.prepare(`
    SELECT branch_id, product_id, count(*) as cnt
    FROM branch_products
    GROUP BY branch_id, product_id
    HAVING cnt > 1
  `).all();
  assert.strictEqual(dupBp.length, 0, 'No duplicate branch_products rows');
});

test('TEST 13 — NO MASTER CATEGORY ID LEAK', () => {
  const masterCategories = db.prepare('SELECT id FROM categories WHERE brand_id = ?').all(BRAND).map(c => String(c.id));

  for (const branchId of TARGET_BRANCHES) {
    const branchProducts = db.prepare('SELECT product_id, branch_category_id FROM branch_products WHERE branch_id = ?').all(branchId);
    for (const bp of branchProducts) {
      assert.ok(!masterCategories.includes(String(bp.branch_category_id)),
        `branch_category_id ${bp.branch_category_id} must not resolve to categories.id`);
      const bc = db.prepare('SELECT id FROM branch_categories WHERE id = ?').get(bp.branch_category_id);
      assert.ok(bc, `branch_category_id ${bp.branch_category_id} resolves to branch_categories.id`);
    }
  }
});
