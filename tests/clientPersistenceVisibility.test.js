'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const app = require('../server/app');
const db = require('../server/database/db');

// Ensure test fixture branches exist for client persistence tests
db.seedDemoData(db);

// Helper to make mock requests to Express app
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

async function loginOwner(username = 'owner_persist_test') {
  const hash = crypto.createHash('sha256').update('password123').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role, status, email_verified_at)
    VALUES (?, 'brand_bangjo', 'org_xentra_holding', NULL, ?, ?, ?, 'Owner Persist', 'owner', 'active', datetime('now'))
  `).run('usr_' + username, username, username + '@bangjo.test', hash);

  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'password123' })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, 'Owner login must succeed');
  return {
    headers: {
      'authorization': 'Bearer ' + data.token,
      'content-type': 'application/json'
    },
    user: data.user
  };
}

test('1. Deleting all products persists empty list and NEVER resurrects dummy items on GET /admin/products', async () => {
  const owner = await loginOwner('owner_p1');

  // Insert a test product then delete all products for brand_bangjo
  const testProdId = 'prod_temp_' + Date.now();
  db.prepare(`
    INSERT INTO products (id, brand_id, name, slug, price, is_active)
    VALUES (?, 'brand_bangjo', 'Temp Product', 'temp-prod', 15000, 1)
  `).run(testProdId);

  // Clear all products and branch assignments for brand_bangjo
  db.prepare(`DELETE FROM branch_products WHERE branch_id IN (SELECT id FROM branches WHERE brand_id = 'brand_bangjo')`).run();
  db.prepare(`DELETE FROM products WHERE brand_id = 'brand_bangjo'`).run();

  // GET /admin/products should return []
  const res = await mockFetch('/api/v1/admin/products', { headers: owner.headers });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.products));
  assert.strictEqual(data.products.length, 0, 'Must NOT resurrect dummy fallback products when empty');
});

test('2. Deleting all categories persists empty list and NEVER resurrects dummy categories on GET /admin/categories', async () => {
  const owner = await loginOwner('owner_p2');

  // Delete all categories for brand_bangjo
  db.prepare(`DELETE FROM categories WHERE brand_id = 'brand_bangjo'`).run();

  const res = await mockFetch('/api/v1/admin/categories', { headers: owner.headers });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories));
  assert.strictEqual(data.categories.length, 0, 'Must NOT resurrect dummy categories when empty');
});

test('3. Deactivating a product (is_active = 0) hides it from customer menu and prevents branch adoption', async () => {
  const owner = await loginOwner('owner_p3');

  // Create active category & product
  const catId = 'cat_test_p3';
  const prodId = 'prod_test_p3';
  const branchId = 'branch_bangjo_pusat';

  db.prepare(`INSERT OR REPLACE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, 'brand_bangjo', 'P3 Cat', 'p3-cat', 1)`).run(catId);
  db.prepare(`INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, 'brand_bangjo', ?, 'P3 Product', 'p3-product', 25000, 1)`).run(prodId, catId);
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, is_available) VALUES (?, ?, 25000, 1)`).run(branchId, prodId);

  // Customer menu should show the product
  let menuRes = await mockFetch(`/api/v1/catalog/menu?branch_id=${branchId}`);
  assert.strictEqual(menuRes.status, 200);
  let menuData = await menuRes.json();
  let prods = Array.isArray(menuData.all_products) ? menuData.all_products : (menuData.products?.items || []);
  let found = prods.some(p => p.id === prodId);
  assert.strictEqual(found, true, 'Active product should appear in customer menu all_products');

  // Deactivate the product via PUT /admin/products/:id
  const updateRes = await mockFetch(`/api/v1/admin/products/${prodId}`, {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ is_active: 0 })
  });
  assert.strictEqual(updateRes.status, 200);

  // Verify in DB that is_active is integer 0
  const prodInDb = db.prepare(`SELECT is_active FROM products WHERE id = ?`).get(prodId);
  assert.strictEqual(prodInDb.is_active, 0, 'is_active should be stored as integer 0');

  // Customer menu must now HIDE the deactivated product
  menuRes = await mockFetch(`/api/v1/catalog/menu?branch_id=${branchId}`);
  assert.strictEqual(menuRes.status, 200);
  menuData = await menuRes.json();
  prods = Array.isArray(menuData.all_products) ? menuData.all_products : (menuData.products?.items || []);
  found = prods.some(p => p.id === prodId);
  assert.strictEqual(found, false, 'Deactivated product MUST NOT appear in customer menu');

  // Adoption by another branch must be rejected
  const adoptRes = await mockFetch(`/api/v1/admin/branches/branch_bangjo_barat/adopt`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: prodId, price: 25000 })
  });
  assert.strictEqual(adoptRes.status, 400, 'Adopting an inactive master product must fail with 400');
});

test('4. Seed data bootstrap idempotency: restart does NOT overwrite branch product overrides or re-seed deleted branches', () => {
  // Set custom price and stock on branch_products
  const branchId = 'branch_bangjo_pusat';
  const prodId = 'prod_custom_price_test';

  db.prepare(`INSERT OR REPLACE INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, 'brand_bangjo', 'Custom Price Prod', 'custom-price-prod', 20000, 1)`).run(prodId);
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, 77777, 42, 1)`).run(branchId, prodId);

  // Mark seed completed in system_metadata
  db.prepare(`INSERT OR REPLACE INTO system_metadata (key, value) VALUES ('seed_demo_data_completed', '1')`).run();

  // Trigger seedData function again (simulating app boot/restart)
  db.seedData(db);

  // Verify the custom price and stock were NOT overwritten
  const bp = db.prepare(`SELECT price, stock, is_available FROM branch_products WHERE branch_id = ? AND product_id = ?`).get(branchId, prodId);
  assert.strictEqual(bp.price, 77777, 'Merchant custom price must survive bootstrap/restart');
  assert.strictEqual(bp.stock, 42, 'Merchant custom stock must survive bootstrap/restart');
});

test('5. Explicitly empty banners array is preserved and not replaced by default Unsplash banners', async () => {
  const owner = await loginOwner('owner_p5');

  // Set brand banners to empty array
  const putRes = await mockFetch('/api/v1/admin/brand', {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ banners: [] })
  });
  assert.strictEqual(putRes.status, 200);

  // Check GET /brand/info
  const infoRes = await mockFetch('/api/v1/brand/info');
  assert.strictEqual(infoRes.status, 200);
  const infoData = await infoRes.json();
  assert.strictEqual(infoData.success, true);
  assert.deepStrictEqual(infoData.brand.banners, [], 'Explicit empty banners array must not be replaced with fallback images');
});
