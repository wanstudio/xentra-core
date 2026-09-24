'use strict';

/**
 * XENTRA — BRANCH MANAGER / PHASE 3
 * M:N Category Membership + RBAC + Branch Scope Test Suite
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm-phase3-mn';

const app = require('../../server/app');
const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
const {
  IdentityModel,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement
} = require('../../core/identity');
const CatalogRepository = require('../../core/data/repositories/CatalogRepository');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';
const OTHER_BRAND_ID = 'brand_other_tenant';
const OTHER_BRANCH_ID = 'branch_other_tenant_1';

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = null } = {}) {
  const token = 'p3_tok_' + crypto.randomBytes(8).toString('hex');
  const uid = userId || ('usr_bm_p3_' + crypto.randomBytes(4).toString('hex'));
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    organization_id: organizationId,
    branchId,
    branch_id: branchId,
    userId: uid,
    id: uid,
    username: uid,
    email_verified: true,
    created_at: Date.now(),
    expires_at: Date.now() + 86400000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

describe('BM Phase 3 — M:N Category Membership + RBAC + Branch Scope', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // Seed master product and categories for tests
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, brand_id, name, slug, sort_order)
      VALUES ('cat_p3_master_1', ?, 'Makanan Master', 'makanan-master', 1)
    `).run(BRAND_ID);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, min_price, max_price, is_active, sort_order)
      VALUES ('prod_p3_test_1', ?, 'cat_p3_master_1', 'Ayam Geprek Sambal Korek', 'ayam-geprek-korek', 25000, 'range', 20000, 30000, 1, 1)
    `).run(BRAND_ID);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, min_price, max_price, is_active, sort_order)
      VALUES ('prod_p3_test_2', ?, 'cat_p3_master_1', 'Bebek Goreng Crispy', 'bebek-goreng-crispy', 35000, 'lock', 35000, 35000, 1, 2)
    `).run(BRAND_ID);

    // Seed branch categories for Branch A
    db.prepare(`
      INSERT OR REPLACE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES ('bc_p3_cat_a', ?, ?, 'Makanan Utama', 'makanan-utama', 1)
    `).run(BRAND_ID, BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES ('bc_p3_cat_b', ?, ?, 'Best Seller', 'best-seller', 2)
    `).run(BRAND_ID, BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES ('bc_p3_cat_c', ?, ?, 'Promo Spesial', 'promo-spesial', 3)
    `).run(BRAND_ID, BRANCH_A_ID);

    // Adopt product into Branch A
    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, price, is_available, stock)
      VALUES (?, 'prod_p3_test_1', 'bc_p3_cat_a', 25000, 1, 50)
    `).run(BRANCH_A_ID);

    // Insert into branch_product_categories junction
    db.prepare(`
      INSERT OR REPLACE INTO branch_product_categories (branch_id, product_id, branch_category_id)
      VALUES (?, 'prod_p3_test_1', 'bc_p3_cat_a')
    `).run(BRANCH_A_ID);
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // =========================================================================
  // 1. DATA MIGRATION & SAFETY
  // =========================================================================
  it('P3-01: Existing branch category assignments survive into branch_product_categories with 0 orphans', () => {
    const totalBPWithCat = db.prepare('SELECT count(*) as c FROM branch_products WHERE branch_category_id IS NOT NULL AND branch_category_id != \'\'').get().c;
    const totalBPC = db.prepare('SELECT count(*) as c FROM branch_product_categories').get().c;
    assert.ok(totalBPC >= totalBPWithCat, `Expected at least ${totalBPWithCat} rows in branch_product_categories, found ${totalBPC}`);

    const orphans = db.prepare(`
      SELECT count(*) as c
      FROM branch_product_categories bpc
      LEFT JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bc.id IS NULL
    `).get().c;
    assert.equal(orphans, 0, 'Orphan branch_product_categories count must be exactly 0');
  });

  // =========================================================================
  // 2. M:N RELATIONSHIP & APIS
  // =========================================================================
  it('P3-02: Product can belong to multiple branch categories simultaneously', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Assign product to second category: 'Best Seller' (bc_p3_cat_b)
    const assignRes1 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, {
      category_id: 'bc_p3_cat_b'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(assignRes1.status, 201);
    assert.equal(assignRes1.body.success, true);
    assert.ok(assignRes1.body.category_ids.includes('bc_p3_cat_b'));

    // Assign product to third category: 'Promo Spesial' (bc_p3_cat_c)
    const assignRes2 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, {
      category_id: 'bc_p3_cat_c'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(assignRes2.status, 201);
    assert.equal(assignRes2.body.success, true);
    assert.ok(assignRes2.body.category_ids.includes('bc_p3_cat_c'));

    // Verify all 3 categories are returned for the product
    const getRes = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.success, true);
    const catIds = getRes.body.categories.map(c => c.id);
    assert.ok(catIds.includes('bc_p3_cat_a'), 'Must include Makanan Utama');
    assert.ok(catIds.includes('bc_p3_cat_b'), 'Must include Best Seller');
    assert.ok(catIds.includes('bc_p3_cat_c'), 'Must include Promo Spesial');
  });

  it('P3-03: Duplicate category membership is prevented (idempotent)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Try assigning bc_p3_cat_b again
    const dupRes = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, {
      category_id: 'bc_p3_cat_b'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(dupRes.status, 201);

    // Verify count in DB is exactly 1 for (BRANCH_A_ID, prod_p3_test_1, bc_p3_cat_b)
    const row = db.prepare(`
      SELECT count(*) as c FROM branch_product_categories
      WHERE branch_id = ? AND product_id = ? AND branch_category_id = ?
    `).get(BRANCH_A_ID, 'prod_p3_test_1', 'bc_p3_cat_b');
    assert.equal(row.c, 1, 'Duplicate row must not be inserted');
  });

  it('P3-04: Product can be removed from one category while remaining in others', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Remove from 'Best Seller' (bc_p3_cat_b)
    const delRes = await request('DELETE', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories/bc_p3_cat_b`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
    assert.equal(delRes.body.removed_category_id, 'bc_p3_cat_b');

    // Verify product still remains in bc_p3_cat_a and bc_p3_cat_c
    const getRes = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(getRes.status, 200);
    const catIds = getRes.body.categories.map(c => c.id);
    assert.equal(catIds.includes('bc_p3_cat_b'), false, 'bc_p3_cat_b must be removed');
    assert.equal(catIds.includes('bc_p3_cat_a'), true, 'bc_p3_cat_a must remain');
    assert.equal(catIds.includes('bc_p3_cat_c'), true, 'bc_p3_cat_c must remain');
  });

  it('P3-05: Category can contain multiple products and be retrieved via GET /categories/:catId/products', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Adopt second product into Branch A and assign to bc_p3_cat_a
    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, price, is_available, stock)
      VALUES (?, 'prod_p3_test_2', 'bc_p3_cat_a', 35000, 1, 40)
    `).run(BRANCH_A_ID);

    await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_2/categories`, {
      category_id: 'bc_p3_cat_a'
    }, {
      Authorization: `Bearer ${token}`
    });

    const catProductsRes = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/categories/bc_p3_cat_a/products`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(catProductsRes.status, 200);
    assert.equal(catProductsRes.body.success, true);
    assert.ok(Array.isArray(catProductsRes.body.products));
    const prodIds = catProductsRes.body.products.map(p => p.product_id);
    assert.ok(prodIds.includes('prod_p3_test_1'));
    assert.ok(prodIds.includes('prod_p3_test_2'));
  });

  it('P3-06: Deleting a category does NOT delete products', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Create a temporary category
    const catRes = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/categories`, {
      name: 'Kategori Sementara'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(catRes.status, 201);
    const tempCatId = catRes.body.category.id;

    // Assign prod_p3_test_1 to temporary category
    await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, {
      category_id: tempCatId
    }, {
      Authorization: `Bearer ${token}`
    });

    // Delete the temporary category
    const delCatRes = await request('DELETE', `/api/v1/admin/branches/${BRANCH_A_ID}/categories/${tempCatId}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delCatRes.status, 200);
    assert.equal(delCatRes.body.success, true);

    // Verify products still exist in branch_products
    const bp = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A_ID, 'prod_p3_test_1');
    assert.ok(bp, 'Branch product must still exist');

    // Verify junction row for tempCatId is gone
    const jRow = db.prepare('SELECT * FROM branch_product_categories WHERE branch_id = ? AND branch_category_id = ?').get(BRANCH_A_ID, tempCatId);
    assert.equal(jRow, undefined);
  });

  it('P3-07: Catalog endpoint GET /admin/branches/:id/catalog returns M:N categories and category_ids for each adopted product', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/catalog`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const adopted = res.body.adopted_products.find(p => p.product_id === 'prod_p3_test_1');
    assert.ok(adopted);
    assert.ok(Array.isArray(adopted.category_ids));
    assert.ok(Array.isArray(adopted.categories));
    assert.ok(adopted.category_ids.length >= 2, 'Must have at least 2 categories assigned');
  });

  it('P3-08: PATCH /admin/branches/:id/products/:productId/override supports category_ids array atomically', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Set categories to [bc_p3_cat_b, bc_p3_cat_c]
    const overrideRes = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/override`, {
      category_ids: ['bc_p3_cat_b', 'bc_p3_cat_c']
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(overrideRes.status, 200);
    assert.equal(overrideRes.body.success, true);
    assert.ok(Array.isArray(overrideRes.body.override.category_ids));
    assert.deepEqual(overrideRes.body.override.category_ids.sort(), ['bc_p3_cat_b', 'bc_p3_cat_c'].sort());

    // Verify DB junction
    const jRows = db.prepare('SELECT branch_category_id FROM branch_product_categories WHERE branch_id = ? AND product_id = ?').all(BRANCH_A_ID, 'prod_p3_test_1');
    const jIds = jRows.map(r => r.branch_category_id).sort();
    assert.deepEqual(jIds, ['bc_p3_cat_b', 'bc_p3_cat_c'].sort());
  });

  // =========================================================================
  // 3. RBAC & PERMISSION MODEL
  // =========================================================================
  it('P3-09: PermissionModel grants menu:manage to BRANCH_MANAGER', () => {
    assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'menu:manage'), true);
    assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'menu:view'), true);
  });

  it('P3-10: AuthorizationService authorizes BM for menu:manage in own branch scope, denies for another branch', () => {
    const user = new IdentityModel({ username: 'bm_rbac_test', status: 'active' });
    const assignments = [{
      user_id: user.id,
      role: 'branch_manager',
      scope_type: 'branch',
      scope_id: BRANCH_A_ID
    }];

    // Own branch -> ALLOW
    const ownAuth = AuthorizationService.authorize({
      identity: user,
      assignments,
      required_permission: 'menu:manage',
      target_context: { branch_id: BRANCH_A_ID }
    });
    assert.strictEqual(ownAuth.allowed, true);

    // Other branch -> DENY
    const otherAuth = AuthorizationService.authorize({
      identity: user,
      assignments,
      required_permission: 'menu:manage',
      target_context: { branch_id: BRANCH_B_ID }
    });
    assert.strictEqual(otherAuth.allowed, false);

    // Brand/Master scope -> DENY (cannot mutate brand-wide master catalog)
    const brandAuth = AuthorizationService.authorize({
      identity: user,
      assignments,
      required_permission: 'menu:manage',
      target_context: { brand_id: BRAND_ID }
    });
    assert.strictEqual(brandAuth.allowed, false);
  });

  it('P3-11: Cross-branch category membership mutation is denied with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Attempt to mutate Branch B categories
    const res = await request('POST', `/api/v1/admin/branches/${BRANCH_B_ID}/products/prod_p3_test_1/categories`, {
      category_id: 'bc_p3_cat_b'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('P3-12: Cross-tenant access is denied with 403 FORBIDDEN_TENANT_ACCESS', async () => {
    // Staff belongs to OTHER_BRAND_ID attempting to access BRAND_ID's branch catalog
    const token = seedStaffSession({ role: 'branch_manager', branchId: OTHER_BRANCH_ID, brandId: OTHER_BRAND_ID });

    // Attempt to access Branch A (which belongs to BRAND_ID)
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/catalog`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('P3-13: Branch Manager CANNOT create, update, or delete master products (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // POST /admin/products -> 403
    const createRes = await request('POST', '/api/v1/admin/products', {
      name: 'Illegal Master Product',
      price: 50000
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(createRes.status, 403);

    // PUT /admin/products/:id -> 403
    const editRes = await request('PUT', '/api/v1/admin/products/prod_p3_test_1', {
      name: 'Altered Master Name'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(editRes.status, 403);

    // DELETE /admin/products/:id -> 403
    const delRes = await request('DELETE', '/api/v1/admin/products/prod_p3_test_1', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delRes.status, 403);
  });

  it('P3-14: Branch Manager CANNOT create, update, or delete master categories (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // POST /admin/categories -> 403
    const createCat = await request('POST', '/api/v1/admin/categories', {
      name: 'Illegal Master Category'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(createCat.status, 403);

    // DELETE /admin/categories/:id -> 403
    const delCat = await request('DELETE', '/api/v1/admin/categories/cat_p3_master_1', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delCat.status, 403);
  });

  it('P3-15: Branch Manager CANNOT create or mutate Bundle/Composite master compositions (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Bundles are managed in Master Catalog under Owner/Brand authority
    const res = await request('POST', '/api/v1/admin/products', {
      name: 'Paket Hemat Bundle',
      price: 45000,
      bundle_components: ['prod_p3_test_1', 'prod_p3_test_2']
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
  });

  // =========================================================================
  // 4. AUDIT LOGGING
  // =========================================================================
  it('P3-16: Category membership mutations create structured branch_operation_logs', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Assign
    await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories`, {
      category_id: 'bc_p3_cat_a'
    }, {
      Authorization: `Bearer ${token}`
    });

    const assignLog = db.prepare(`
      SELECT * FROM branch_operation_logs
      WHERE branch_id = ? AND product_id = ? AND action = 'branch_product_category.assign'
      ORDER BY created_at DESC LIMIT 1
    `).get(BRANCH_A_ID, 'prod_p3_test_1');

    assert.ok(assignLog, 'Must have assign audit log');
    assert.equal(assignLog.field, 'branch_category_id');
    assert.equal(assignLog.authorized, 1);
    assert.ok(assignLog.actor_id);
    assert.ok(assignLog.actor_role);

    // Remove
    await request('DELETE', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_p3_test_1/categories/bc_p3_cat_a`, null, {
      Authorization: `Bearer ${token}`
    });

    const removeLog = db.prepare(`
      SELECT * FROM branch_operation_logs
      WHERE branch_id = ? AND product_id = ? AND action = 'branch_product_category.remove'
      ORDER BY created_at DESC LIMIT 1
    `).get(BRANCH_A_ID, 'prod_p3_test_1');

    assert.ok(removeLog, 'Must have remove audit log');
    assert.equal(removeLog.field, 'branch_category_id');
    assert.equal(removeLog.authorized, 1);
  });

  // =========================================================================
  // 5. REGRESSION & CATALOG REPOSITORY
  // =========================================================================
  it('P3-17: CatalogRepository findBranchProducts returns category_ids array and preserves category_id', () => {
    const repo = new CatalogRepository();
    const products = repo.findBranchProducts({ branchId: BRANCH_A_ID, brandId: BRAND_ID, activeOnly: false });
    assert.ok(Array.isArray(products));
    const p1 = products.find(p => p.id === 'prod_p3_test_1');
    assert.ok(p1);
    assert.ok(Array.isArray(p1.category_ids));
    assert.ok(p1.category_id != null, 'Legacy category_id property must be preserved');
  });

  it('P3-18: UI contains M:N category elements in index.html and dashboard.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/index.html'), 'utf8');
    // The M:N category picker is rendered by the shared branch-catalog module,
    // which both the Owner modal and the Branch Manager menu consume.
    const js = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/assets/js/branch-catalog-ui.js'), 'utf8');

    assert.ok(html.includes('id="override-categories-list"'), 'Missing override-categories-list in index.html');
    assert.ok(js.includes('override-cat-checkbox'), 'Missing override-cat-checkbox in the shared branch-catalog module');
  });
});
