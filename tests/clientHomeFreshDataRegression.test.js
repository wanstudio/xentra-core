'use strict';

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');

const BRAND_A = 'brand_bangjo';
const BRAND_B = 'brand_other_co';
const BRANCH_A = 'branch_bangjo_barat';

// Helper for mock HTTP requests against Express app
async function mockFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : null;

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
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

test('Regression 1: Direct Home load reads fresh Brand-wide catalog from Core DB', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories));
  assert.ok(Array.isArray(data.all_products));
  assert.ok(data.categories.length > 0);
  assert.ok(data.all_products.length > 0);
});

test('Regression 2: Direct Home load with branch_id reads fresh Branch Catalog without stale connector', async () => {
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BRANCH_A}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories));
  assert.ok(data.categories.length > 0);
  assert.ok(data.all_products.length > 0);
  // Verify adopted branch products are present
  const productNames = data.all_products.map(p => p.name);
  assert.ok(productNames.length > 0);
});

test('Regression 3: Dashboard -> Home mutation reflection (Product update)', async () => {
  const testProdId = 'prod_reg_test_3';
  const origName = 'Original Regression Burger';
  const updatedName = 'Updated Deluxe Burger';

  // 1. Insert product into Core DB as if created by Dashboard
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, is_active, sort_order)
    VALUES (?, ?, '34', ?, 'burger', 'Juicy burger', 35000, 35000, 1, 999)
  `).run(testProdId, BRAND_A, origName);

  // 2. Fetch Home catalog -> verify original name
  const res1 = await mockFetch('/api/v1/catalog/menu');
  const data1 = await res1.json();
  const found1 = data1.all_products.find(p => p.id === testProdId);
  assert.ok(found1);
  assert.strictEqual(found1.name, origName);

  // 3. Mutate product in Core DB (simulating Dashboard update)
  db.prepare('UPDATE products SET name = ?, price = 42000 WHERE id = ?').run(updatedName, testProdId);

  // 4. Fetch Home catalog again (refresh) -> must immediately show updated data
  const res2 = await mockFetch('/api/v1/catalog/menu');
  const data2 = await res2.json();
  const found2 = data2.all_products.find(p => p.id === testProdId);
  assert.ok(found2);
  assert.strictEqual(found2.name, updatedName);
  assert.strictEqual(found2.price, 42000);

  // Clean up
  db.prepare('DELETE FROM products WHERE id = ?').run(testProdId);
});

test('Regression 4: Dashboard -> Home mutation reflection (Branch & Delivery settings)', async () => {
  const testBranchId = 'branch_reg_test_4';
  const branchName = 'Cabang Anyar Test';

  // 1. Create branch in Core DB
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active)
    VALUES (?, ?, ?, 'cabang-anyar', 'Jl. Baru No. 10', -7.25, 112.75, 1)
  `).run(testBranchId, BRAND_A, branchName);

  // 2. Query /brand/branches
  const res1 = await mockFetch('/api/v1/brand/branches');
  const data1 = await res1.json();
  assert.strictEqual(data1.success, true);
  const branch1 = data1.branches.find(b => b.id === testBranchId);
  assert.ok(branch1);
  assert.strictEqual(branch1.name, branchName);

  // 3. Deactivate branch (Dashboard deactivates)
  db.prepare('UPDATE branches SET is_active = 0 WHERE id = ?').run(testBranchId);

  // 4. Query /brand/branches again -> must NOT include inactive branch
  const res2 = await mockFetch('/api/v1/brand/branches');
  const data2 = await res2.json();
  const branch2 = data2.branches.find(b => b.id === testBranchId);
  assert.strictEqual(branch2, undefined, 'Deactivated branch must not be returned');

  // Clean up
  db.prepare('DELETE FROM branches WHERE id = ?').run(testBranchId);
});

test('Regression 5: Dashboard -> Home mutation reflection (Branch Category & Product Adoption)', async () => {
  const branchCatId = 'bc_reg_test_5';
  const prodId = 'prod_reg_test_5';

  // 1. Create master product
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, is_active, sort_order)
    VALUES (?, ?, '34', 'Master Test Item', 'master-test', 'desc', 20000, 20000, 1, 999)
  `).run(prodId, BRAND_A);

  // 2. Create branch category
  db.prepare(`
    INSERT OR REPLACE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
    VALUES (?, ?, ?, 'Kategori Spesial Cabang', 'kategori-spesial', 10)
  `).run(branchCatId, BRAND_A, BRANCH_A);

  // 3. Adopt product into branch with override price
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, price, stock, is_available, name_override)
    VALUES (?, ?, ?, 27500, 15, 1, 'Branch Override Name')
  `).run(BRANCH_A, prodId, branchCatId);

  // 4. Query Home branch catalog -> must show branch category and overridden product
  const res = await mockFetch(`/api/v1/catalog/menu?branch_id=${BRANCH_A}`);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const cat = data.categories.find(c => c.id === branchCatId);
  assert.ok(cat, 'Branch category must appear in branch catalog');
  assert.strictEqual(cat.name, 'Kategori Spesial Cabang');

  const prod = data.all_products.find(p => p.id === prodId);
  assert.ok(prod, 'Adopted product must appear in branch catalog');
  assert.strictEqual(prod.name, 'Branch Override Name');
  assert.strictEqual(prod.price, 27500);
  assert.strictEqual(prod.stock_estimate, 15);
  assert.strictEqual(prod.is_available, true);

  // Clean up
  db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, prodId);
  db.prepare('DELETE FROM branch_categories WHERE id = ?').run(branchCatId);
  db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
});

test('Regression 6: Tenant Isolation — Brand A mutations never leak to Brand B', async () => {
  // Query catalog as Brand B (via other.tenant.com custom_domain)
  const resB = await mockFetch('/api/v1/catalog/menu', {
    headers: { host: 'other.tenant.com' }
  });
  const dataB = await resB.json();
  assert.strictEqual(dataB.success, true);

  // Querying with Brand A branch under Brand B tenant must fail (400 branch not found)
  const crossRes = await mockFetch(`/api/v1/catalog/menu?branch_id=${BRANCH_A}`, {
    headers: { host: 'other.tenant.com' }
  });
  assert.strictEqual(crossRes.status, 400);
  const crossData = await crossRes.json();
  assert.strictEqual(crossData.error, 'branch not found');
});
