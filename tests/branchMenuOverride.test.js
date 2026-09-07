'use strict';

/**
 * BRANCH PRODUCT OVERRIDE -- Master Product Default + Branch Optional Override
 *
 * Tests that:
 *  1. After adopt, override columns are NULL (branch inherits live master values).
 *  2. CatalogService resolves to live master when override is NULL.
 *  3. PATCH override sets name/image -- CatalogService resolves to branch value.
 *  4. CatalogService resolves branch override after PATCH.
 *  5. PATCH with null clears the override -- falls back to master.
 *  6. Master update propagates to branch without override.
 *  7. Master update does NOT overwrite explicit branch override.
 *  8. PATCH empty body returns 400.
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');
const CatalogService = require('../domains/commerce/services/CatalogService');

const BRAND   = 'brand_bangjo';
const BRANCH  = 'branch_bangjo_barat';
const PRODUCT = 'prod_ovr_test';
const CAT_ID  = '34';

// ---- Helpers ----

function mockFetch(path, options) {
  options = options || {};
  const method  = options.method  || 'GET';
  const headers = options.headers || {};
  const body    = options.body ? JSON.parse(options.body) : null;
  return new Promise(function(resolve, reject) {
    const req = {
      method: method, url: path,
      headers: Object.assign({ host: 'app.mybangjo.com', 'content-type': 'application/json' }, headers),
      body: body, query: {}, params: {}
    };
    if (path.indexOf('?') !== -1) {
      const parts = path.split('?');
      req.url = parts[0];
      const sp = new URLSearchParams(parts[1]);
      for (const e of sp.entries()) req.query[e[0]] = e[1];
    }
    const res = {
      statusCode: 200, _h: {},
      status: function(c) { this.statusCode = c; return this; },
      setHeader: function(k, v) { this._h[k] = v; },
      getHeader: function(k) { return this._h[k]; },
      json: function(d) { resolve({ status: this.statusCode, body: d }); },
      send: function(d) { let p = d; if (typeof d === 'string') { try { p = JSON.parse(d); } catch (_) {} } resolve({ status: this.statusCode, body: p }); },
      end:  function(d) { let p = d; if (typeof d === 'string') { try { p = JSON.parse(d); } catch (_) {} } resolve({ status: this.statusCode, body: p }); }
    };
    app(req, res, function(err) { if (err) reject(err); });
  });
}

let authToken = null;

async function getAuthToken() {
  if (authToken) return authToken;
  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  assert.strictEqual(res.status, 200, 'Admin login must succeed for override tests');
  authToken = res.body.token;
  assert.ok(authToken, 'Login must return a token');
  return authToken;
}

async function patchOverride(branchId, productId, fields) {
  const token = await getAuthToken();
  return mockFetch('/api/v1/admin/branches/' + branchId + '/products/' + productId + '/override', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify(fields)
  });
}

// ---- Setup ----

test.before(function() {
  try { db.prepare('DELETE FROM branch_products WHERE product_id = ?').run(PRODUCT); } catch (_) {}
  try { db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT); } catch (_) {}
  db.prepare('INSERT INTO products (id, brand_id, category_id, name, slug, description, image_url, price, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 99)').run(
    PRODUCT, BRAND, CAT_ID, 'Override Test Product', 'override-test-product', 'Master description', '/master-img.png', 30000
  );
  const bc = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? LIMIT 1').get(BRANCH);
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, price, is_available, stock) VALUES (?, ?, ?, 30000, 1, 50)').run(BRANCH, PRODUCT, bc ? bc.id : null);
});

test.after(function() {
  try { db.prepare('DELETE FROM branch_products WHERE product_id = ?').run(PRODUCT); } catch (_) {}
  try { db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT); } catch (_) {}
});

// ---- Tests ----

test('OVR-01 after adopt, override columns are NULL', function() {
  const row = db.prepare('SELECT name_override, description_override, image_override FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH, PRODUCT);
  assert.ok(row, 'branch_products row must exist');
  assert.strictEqual(row.name_override,        null, 'name_override must be NULL after adopt');
  assert.strictEqual(row.description_override, null, 'description_override must be NULL after adopt');
  assert.strictEqual(row.image_override,       null, 'image_override must be NULL after adopt');
});

test('OVR-02 CatalogService resolves to live master when override is NULL', function() {
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH });
  const p = menu.products.find(function(x) { return x.id === PRODUCT; });
  assert.ok(p, 'product must appear in branch menu');
  assert.strictEqual(p.name,        'Override Test Product', 'name resolves to master');
  assert.strictEqual(p.description, 'Master description',    'description resolves to master');
  assert.strictEqual(p.image_url,   '/master-img.png',       'image_url resolves to master');
  assert.strictEqual(p.name_override,  null, 'name_override exposed as null');
  assert.strictEqual(p.image_override, null, 'image_override exposed as null');
});

test('OVR-03 PATCH sets branch name and image override', async function() {
  const res = await patchOverride(BRANCH, PRODUCT, { name: 'Branch Override Name', image_url: '/branch-img.png' });
  assert.strictEqual(res.status, 200, 'PATCH must succeed: ' + JSON.stringify(res.body));
  assert.strictEqual(res.body.success, true);
  const row = db.prepare('SELECT name_override, image_override FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH, PRODUCT);
  assert.strictEqual(row.name_override,  'Branch Override Name');
  assert.strictEqual(row.image_override, '/branch-img.png');
});

test('OVR-04 CatalogService resolves branch override after PATCH', function() {
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH });
  const p = menu.products.find(function(x) { return x.id === PRODUCT; });
  assert.ok(p);
  assert.strictEqual(p.name,        'Branch Override Name',  'name = branch override');
  assert.strictEqual(p.image_url,   '/branch-img.png',       'image_url = branch override');
  assert.strictEqual(p.description, 'Master description',    'non-overridden description stays master');
  assert.strictEqual(p.master_name, 'Override Test Product', 'master_name always present');
  assert.strictEqual(p.name_override,  'Branch Override Name', 'override exposed in payload');
  assert.strictEqual(p.image_override, '/branch-img.png',      'image_override in payload');
});

test('OVR-05 PATCH null clears override, falls back to master', async function() {
  const res = await patchOverride(BRANCH, PRODUCT, { name: null, image_url: null });
  assert.strictEqual(res.status, 200);
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH });
  const p = menu.products.find(function(x) { return x.id === PRODUCT; });
  assert.ok(p);
  assert.strictEqual(p.name,         'Override Test Product', 'name falls back to master');
  assert.strictEqual(p.image_url,    '/master-img.png',       'image_url falls back to master');
  assert.strictEqual(p.name_override,  null, 'name_override cleared');
  assert.strictEqual(p.image_override, null, 'image_override cleared');
});

test('OVR-06 master update propagates when no override', function() {
  db.prepare('UPDATE branch_products SET name_override = NULL WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT);
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run('Updated Master Name', PRODUCT);
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH });
  const p = menu.products.find(function(x) { return x.id === PRODUCT; });
  assert.ok(p);
  assert.strictEqual(p.name, 'Updated Master Name', 'branch inherits live master update');
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run('Override Test Product', PRODUCT);
});

test('OVR-07 master update does not overwrite explicit branch override', function() {
  db.prepare('UPDATE branch_products SET name_override = ? WHERE branch_id = ? AND product_id = ?').run('Locked Branch Name', BRANCH, PRODUCT);
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run('New Master Name', PRODUCT);
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH });
  const p = menu.products.find(function(x) { return x.id === PRODUCT; });
  assert.ok(p);
  assert.strictEqual(p.name, 'Locked Branch Name', 'explicit override not overwritten by master');
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run('Override Test Product', PRODUCT);
  db.prepare('UPDATE branch_products SET name_override = NULL WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT);
});

test('OVR-08 PATCH empty body returns 400', async function() {
  const res = await patchOverride(BRANCH, PRODUCT, {});
  assert.strictEqual(res.status, 400, 'empty body must be rejected');
  assert.strictEqual(res.body.success, false);
});
