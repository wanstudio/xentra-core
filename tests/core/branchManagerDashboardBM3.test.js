'use strict';

/**
 * BM-3 — Branch Manager Dashboard: Menu + Stok + Promo Test Suite
 *
 * Requirements Matrix:
 * - BM3-01: Branch Manager can view menu assignments for their assigned branch.
 * - BM3-02: Cross-branch menu read is denied (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM3-03: Branch Manager can toggle product availability (is_available 0/1) for their assigned branch.
 * - BM3-04: Cross-branch product availability toggle is denied (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM3-05: Toggling branch_products.is_available DOES NOT alter master catalog products.is_active.
 * - BM3-06: Branch Manager CANNOT create, update, or delete master products (403).
 * - BM3-07: Branch Manager CANNOT create, update, or delete master categories (403).
 * - BM3-08: Branch Manager can view branch inventory stock and low stock thresholds.
 * - BM3-09: Cross-branch inventory read is denied (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM3-10: Branch Manager can perform operational stock adjustment (audit_adjustment) with audit log.
 * - BM3-11: Branch Manager can perform operational waste reduction (waste_spoilage).
 * - BM3-12: Positive quantity on waste_spoilage is rejected (400 INVALID_QUANTITY).
 * - BM3-13: Disallowed movement types (e.g. sale_deduction, purchase_in) are rejected (400 INVALID_MOVEMENT_TYPE).
 * - BM3-14: Cross-branch inventory adjustment is denied (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM3-15: Operational stock adjustment prevents negative stock balance (409 INSUFFICIENT_STOCK).
 * - BM3-16: Branch Manager can view approved brand marketing promotions.
 * - BM3-17: Branch Manager can view promotion redemptions automatically scoped to assigned branch.
 * - BM3-18: Cross-tenant brand isolation is strictly preserved across menu, stock, and promo.
 * - BM3-19: index.html contains full operational UI for tab-bm-menu, tab-bm-promo, and tab-bm-stok with adjustment modal.
 * - BM3-20: dashboard.js implements loadBMMenu, toggleBMProductAvailability, loadBMStock, submitBMStockAdjustment, and loadBMPromotions.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm3-menu-stock-promo';

const app = require('../../server/app');
const db = require('../../server/database/db');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

const OTHER_BRAND_ID = 'brand_other_tenant';
const OTHER_BRANCH_ID = 'branch_other_1';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm3_user_test' } = {}) {
  const token = 'bm3_tok_' + crypto.randomBytes(8).toString('hex');
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
    userId,
    username: userId,
    email_verified: true,
    created_at: Date.now(),
    expires_at: Date.now() + 86400000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

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

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('BM-3 — Branch Manager Dashboard: Menu + Stok + Promo', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .run(ORG_ID, 'Xentra Holding', 'xentra-holding');
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .run('org_other_tenant', 'Other Org', 'other-org');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)')
      .run(BRAND_ID, ORG_ID, 'Bangjo Resto', 'bangjo');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)')
      .run(OTHER_BRAND_ID, 'org_other_tenant', 'Other Brand', 'other-brand');

    // Seed test branches
    db.prepare(`
      INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, -7.25, 112.75, 1, 1, datetime('now'), datetime('now'))
    `).run(BRANCH_A_ID, BRAND_ID, 'Bangjo Barat', 'bangjo-barat', 'Jl. Barat No. 1');

    db.prepare(`
      INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, -7.26, 112.76, 1, 1, datetime('now'), datetime('now'))
    `).run(BRANCH_B_ID, BRAND_ID, 'Bangjo Timur', 'bangjo-timur', 'Jl. Timur No. 2');

    // Seed master category and products
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, brand_id, name, slug, sort_order, created_at)
      VALUES ('cat_bm3_1', ?, 'Makanan Utama', 'makanan-utama', 1, datetime('now'))
    `).run(BRAND_ID);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active, sort_order, created_at, updated_at)
      VALUES ('prod_bm3_nasi', ?, 'cat_bm3_1', 'Nasi Goreng Spesial', 'nasi-goreng-spesial', 30000, 1, 1, datetime('now'), datetime('now'))
    `).run(BRAND_ID);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active, sort_order, created_at, updated_at)
      VALUES ('prod_bm3_mie', ?, 'cat_bm3_1', 'Mie Goreng Seafood', 'mie-goreng-seafood', 35000, 1, 2, datetime('now'), datetime('now'))
    `).run(BRAND_ID);

    // Seed branch_products for Branch A
    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold, created_at, updated_at)
      VALUES (?, 'prod_bm3_nasi', 30000, 50, 1, 10, datetime('now'), datetime('now'))
    `).run(BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold, created_at, updated_at)
      VALUES (?, 'prod_bm3_mie', 35000, 4, 1, 5, datetime('now'), datetime('now'))
    `).run(BRANCH_A_ID);

    // Seed branch_products for Branch B
    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold, created_at, updated_at)
      VALUES (?, 'prod_bm3_nasi', 32000, 20, 1, 5, datetime('now'), datetime('now'))
    `).run(BRANCH_B_ID);

    // Seed brand marketing promotions
    db.prepare(`
      INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, start_at, end_at, created_at, updated_at)
      VALUES ('promo_bm3_opening', ?, 'Promo Opening Cabang', 'OPENING20', 'discount_percent', 1, datetime('now', '-1 day'), datetime('now', '+30 days'), datetime('now'), datetime('now'))
    `).run(BRAND_ID);

    // Seed dummy orders for promotion redemptions
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total, created_at)
      VALUES ('ord_bm3_dummy_1', 'ORD-BM3-001', ?, ?, 'Customer 1', '08123456789', 'dine_in', 50000, 40000, datetime('now'))
    `).run(BRAND_ID, BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total, created_at)
      VALUES ('ord_bm3_dummy_2', 'ORD-BM3-002', ?, ?, 'Customer 2', '08129876543', 'dine_in', 70000, 55000, datetime('now'))
    `).run(BRAND_ID, BRANCH_B_ID);

    // Seed promotion redemptions
    db.prepare(`
      INSERT OR REPLACE INTO promotion_redemptions (id, promotion_id, brand_id, branch_id, order_id, customer_phone, benefit_amount, redeemed_at)
      VALUES ('red_bm3_1', 'promo_bm3_opening', ?, ?, 'ord_bm3_dummy_1', '08123456789', 10000, datetime('now'))
    `).run(BRAND_ID, BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO promotion_redemptions (id, promotion_id, brand_id, branch_id, order_id, customer_phone, benefit_amount, redeemed_at)
      VALUES ('red_bm3_2', 'promo_bm3_opening', ?, ?, 'ord_bm3_dummy_2', '08129876543', 15000, datetime('now'))
    `).run(BRAND_ID, BRANCH_B_ID);
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('BM3-01: Branch Manager can view menu assignments for their assigned branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/products`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.branch_id, BRANCH_A_ID);
    assert.ok(Array.isArray(res.body.assignments));
    assert.equal(res.body.assignments.length >= 2, true);

    const nasi = res.body.assignments.find(a => a.product_id === 'prod_bm3_nasi');
    assert.ok(nasi);
    assert.equal(nasi.product_name, 'Nasi Goreng Spesial');
    assert.equal(nasi.category_name, 'Makanan Utama');
    assert.equal(nasi.is_available, 1);
  });

  it('BM3-02: Cross-branch menu read is denied with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/products`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM3-03: Branch Manager can toggle product availability (is_available 0/1) for their assigned branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Toggle to 0 (Habis)
    const resOff = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_nasi`, {
      is_available: 0
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(resOff.status, 200);
    assert.equal(resOff.body.success, true);
    assert.equal(resOff.body.assignment.is_available, 0);

    const dbRowOff = db.prepare('SELECT is_available FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_nasi');
    assert.equal(dbRowOff.is_available, 0);

    // Toggle back to 1 (Tersedia)
    const resOn = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_nasi`, {
      is_available: 1
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(resOn.status, 200);
    assert.equal(resOn.body.success, true);
    assert.equal(resOn.body.assignment.is_available, 1);
  });

  it('BM3-04: Cross-branch product availability toggle is denied with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_B_ID}/products/prod_bm3_nasi`, {
      is_available: 0
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');

    // Ensure Branch B row remained untouched
    const dbRow = db.prepare('SELECT is_available FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_B_ID, 'prod_bm3_nasi');
    assert.equal(dbRow.is_available, 1);
  });

  it('BM3-05: Toggling branch_products.is_available DOES NOT alter master catalog products.is_active', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Toggle branch product off
    await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_nasi`, {
      is_available: 0
    }, {
      Authorization: `Bearer ${token}`
    });

    // Master product MUST still be active
    const masterProd = db.prepare('SELECT is_active FROM products WHERE id = ?').get('prod_bm3_nasi');
    assert.equal(masterProd.is_active, 1);

    // Restore availability
    await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_nasi`, {
      is_available: 1
    }, {
      Authorization: `Bearer ${token}`
    });
  });

  it('BM3-06: Branch Manager CANNOT create, update, or delete master products (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Try Create Master Product
    const resCreate = await request('POST', '/api/v1/admin/products', {
      name: 'Illegal Product by BM',
      price: 50000
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resCreate.status, 403);

    // Try Update Master Product
    const resUpdate = await request('PUT', '/api/v1/admin/products/prod_bm3_nasi', {
      name: 'Renamed by BM'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resUpdate.status, 403);

    // Try Delete Master Product
    const resDelete = await request('DELETE', '/api/v1/admin/products/prod_bm3_nasi', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resDelete.status, 403);
  });

  it('BM3-07: Branch Manager CANNOT create, update, or delete master categories (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Try Create Master Category
    const resCreate = await request('POST', '/api/v1/admin/categories', {
      name: 'Illegal Category by BM'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resCreate.status, 403);
  });

  it('BM3-08: Branch Manager can view branch inventory stock and low stock thresholds', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.inventory));

    const mie = res.body.inventory.find(i => i.product_id === 'prod_bm3_mie');
    assert.ok(mie);
    assert.equal(mie.stock, 4);
    assert.equal(mie.low_stock_threshold, 5);
  });

  it('BM3-09: Cross-branch inventory read is denied with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/inventory`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM3-10: Branch Manager can perform operational stock adjustment (audit_adjustment) with audit log', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const initialStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_nasi').stock;

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory/prod_bm3_nasi`, {
      movement_type: 'audit_adjustment',
      quantity: 5,
      notes: 'Opname fisik menemukan kelebihan stok 5 porsi'
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.stock, initialStock + 5);

    // Verify DB
    const updatedStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_nasi').stock;
    assert.equal(updatedStock, initialStock + 5);

    // Verify stock movements ledger
    const movement = db.prepare('SELECT * FROM inventory_movements WHERE branch_id = ? AND product_id = ? AND movement_type = ? ORDER BY id DESC LIMIT 1')
      .get(BRANCH_A_ID, 'prod_bm3_nasi', 'audit_adjustment');
    assert.ok(movement);
    assert.equal(movement.quantity, 5);
  });

  it('BM3-11: Branch Manager can perform operational waste reduction (waste_spoilage)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const initialStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_mie').stock;

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory/prod_bm3_mie`, {
      movement_type: 'waste_spoilage',
      quantity: -2,
      notes: 'Bahan basi terpaksa dibuang'
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.stock, initialStock - 2);

    const updatedStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_mie').stock;
    assert.equal(updatedStock, initialStock - 2);

    const movement = db.prepare('SELECT * FROM inventory_movements WHERE branch_id = ? AND product_id = ? AND movement_type = ? ORDER BY id DESC LIMIT 1')
      .get(BRANCH_A_ID, 'prod_bm3_mie', 'waste_spoilage');
    assert.ok(movement);
    assert.equal(movement.quantity, -2);
  });

  it('BM3-12: Positive quantity on waste_spoilage is rejected (400 INVALID_QUANTITY)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory/prod_bm3_mie`, {
      movement_type: 'waste_spoilage',
      quantity: 2,
      notes: 'Harus negatif'
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'INVALID_QUANTITY');
  });

  it('BM3-13: Disallowed movement types (e.g. sale_deduction, purchase_in) are rejected (400 INVALID_MOVEMENT_TYPE)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory/prod_bm3_mie`, {
      movement_type: 'sale_deduction',
      quantity: -1
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'INVALID_MOVEMENT_TYPE');
  });

  it('BM3-14: Cross-branch inventory adjustment is denied with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_B_ID}/inventory/prod_bm3_nasi`, {
      movement_type: 'audit_adjustment',
      quantity: 1
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM3-15: Operational stock adjustment prevents negative stock balance (409 INSUFFICIENT_STOCK)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const currentStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?')
      .get(BRANCH_A_ID, 'prod_bm3_mie').stock;

    // Deducting more than available
    const res = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/inventory/prod_bm3_mie`, {
      movement_type: 'audit_adjustment',
      quantity: -(currentStock + 100),
      notes: 'Pengurangan melebihi stok'
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'INSUFFICIENT_STOCK');
  });

  it('BM3-16: Branch Manager can view approved brand marketing promotions', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', '/api/v1/admin/marketing/promotions', null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.promotions));
    const promo = res.body.promotions.find(p => p.id === 'promo_bm3_opening');
    assert.ok(promo);
    assert.equal(promo.promo_code, 'OPENING20');
  });

  it('BM3-17: Branch Manager can view promotion redemptions automatically scoped to assigned branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Request redemptions without query param, server must scope to BRANCH_A_ID
    const res = await request('GET', '/api/v1/admin/marketing/redemptions', null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.redemptions));

    // Must contain Branch A redemptions, NOT Branch B
    const itemA = res.body.redemptions.find(r => r.order_id === 'ord_bm3_dummy_1');
    const hasBranchB = res.body.redemptions.some(r => r.order_id === 'ord_bm3_dummy_2');
    assert.ok(itemA, 'Should contain Branch A redemption');
    assert.equal(itemA.benefit_amount, 10000, 'Redemption benefit_amount must match');
    assert.equal(itemA.discount_amount, 10000, 'Redemption discount_amount alias must match');
    assert.equal(hasBranchB, false);

    // If query param attempts to ask for Branch B, requireAuth denies cross-branch query (403 FORBIDDEN_BRANCH_ACCESS)
    const resAttempt = await request('GET', `/api/v1/admin/marketing/redemptions?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resAttempt.status, 403);
    assert.equal(resAttempt.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('BM3-18: Cross-tenant brand isolation is strictly preserved across menu, stock, and promo', async () => {
    // Seed other tenant branch
    db.prepare(`
      INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'Other Tenant Branch', 'other-branch', 'Jl. Lain', -7.28, 112.78, 1, datetime('now'), datetime('now'))
    `).run(OTHER_BRANCH_ID, OTHER_BRAND_ID);

    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    // Attempting to access other tenant branch products -> 403 or 404
    const res = await request('GET', `/api/v1/admin/branches/${OTHER_BRANCH_ID}/products`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal([403, 404].includes(res.status), true);
  });

  it('BM3-19: index.html contains full operational UI for tab-bm-menu, tab-bm-promo, and tab-bm-stok with adjustment modal', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="tab-bm-menu"'), 'Missing tab-bm-menu');
    assert.ok(html.includes('id="bm-menu-tbody"'), 'Missing bm-menu-tbody');
    assert.ok(html.includes('id="bm-menu-stat-total"'), 'Missing bm-menu-stat-total');

    assert.ok(html.includes('id="tab-bm-promo"'), 'Missing tab-bm-promo');
    assert.ok(html.includes('id="bm-promo-list"'), 'Missing bm-promo-list');
    assert.ok(html.includes('id="bm-promo-redemptions-tbody"'), 'Missing bm-promo-redemptions-tbody');

    assert.ok(html.includes('id="tab-bm-stok"'), 'Missing tab-bm-stok');
    assert.ok(html.includes('id="bm-stock-tbody"'), 'Missing bm-stock-tbody');
    assert.ok(html.includes('id="modal-bm-stock-adjust"'), 'Missing modal-bm-stock-adjust');
    assert.ok(html.includes('id="form-bm-stock-adjust"'), 'Missing form-bm-stock-adjust');
  });

  it('BM3-20: dashboard.js implements loadBMMenu, toggleBMProductAvailability, loadBMStock, submitBMStockAdjustment, and loadBMPromotions', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const menuPath = path.join(__dirname, '../../apps/merchant-app/assets/js/menu.js');
    const stockPath = path.join(__dirname, '../../apps/merchant-app/assets/js/stock.js');
    const promoPath = path.join(__dirname, '../../apps/merchant-app/assets/js/promotions.js');
    const js = [jsPath, menuPath, stockPath, promoPath]
      .filter(p => fs.existsSync(p))
      .map(p => fs.readFileSync(p, 'utf8'))
      .join('\n');

    assert.ok(js.includes('async function loadBMMenu()'), 'Missing loadBMMenu');
    assert.ok(js.includes('async function toggleBMProductAvailability('), 'Missing toggleBMProductAvailability');
    assert.ok(js.includes('async function loadBMStock()'), 'Missing loadBMStock');
    assert.ok(js.includes('async function submitBMStockAdjustment('), 'Missing submitBMStockAdjustment');
    assert.ok(js.includes('async function loadBMPromotions()'), 'Missing loadBMPromotions');
    assert.ok(js.includes('openBMStockAdjustmentModal'), 'Missing openBMStockAdjustmentModal');
  });

  /* ─────────────────────────────────────────────────────────────────────────
     BM-3 PHASE 2: MENU WORKSPACE, ADOPTION & BRANCH CATEGORIES
     ───────────────────────────────────────────────────────────────────────── */

  it('BM3-21: Branch Manager can query branch catalog (/admin/branches/:id/catalog) for assigned branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/catalog`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.categories));
    assert.ok(Array.isArray(res.body.adopted_products));
    assert.ok(Array.isArray(res.body.available_master_products));

    // Cross-branch must be denied
    const crossRes = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/catalog`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(crossRes.status, 403);
    assert.equal(crossRes.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM3-22: Branch Manager can adopt a master product into assigned branch with price policy enforcement', async () => {
    // Seed an unadopted master product with range pricing
    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, min_price, max_price, is_active, sort_order, created_at, updated_at)
      VALUES ('prod_bm3_adoptable', ?, 'cat_bm3_1', 'Es Teh Manis Jumbo', 'es-teh-jumbo', 8000, 'range', 7000, 12000, 1, 10, datetime('now'), datetime('now'))
    `).run(BRAND_ID);

    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    // 1. Invalid price below min_price must be rejected (400 INVALID_BRANCH_PRICE)
    const failRes = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/adopt`, {
      product_id: 'prod_bm3_adoptable',
      price: 5000
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(failRes.status, 400);
    assert.equal(failRes.body.error, 'INVALID_BRANCH_PRICE');

    // 2. Cross-branch adoption must be denied (403 FORBIDDEN_BRANCH_SCOPE)
    const crossRes = await request('POST', `/api/v1/admin/branches/${BRANCH_B_ID}/adopt`, {
      product_id: 'prod_bm3_adoptable',
      price: 9000
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(crossRes.status, 403);
    assert.equal(crossRes.body.error, 'FORBIDDEN_BRANCH_SCOPE');

    // 3. Valid adoption within range must succeed
    const okRes = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/adopt`, {
      product_id: 'prod_bm3_adoptable',
      price: 9000
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(okRes.status, 201);
    assert.equal(okRes.body.success, true);
    assert.equal((okRes.body.adopted || okRes.body.assignment).price, 9000);

    // Verify persisted in DB
    const bp = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A_ID, 'prod_bm3_adoptable');
    assert.ok(bp);
    assert.equal(bp.price, 9000);
  });

  it('BM3-23: Branch Manager can create, rename, reorder, and delete branch categories', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    // 1. Create Category 1
    const createRes1 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/categories`, {
      name: 'Minuman Segar'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(createRes1.status, 201);
    assert.equal(createRes1.body.success, true);
    const cat1Id = createRes1.body.category.id;

    // 2. Create Category 2
    const createRes2 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/categories`, {
      name: 'Camilan Sore'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(createRes2.status, 201);
    const cat2Id = createRes2.body.category.id;

    // Cross-branch category create denied
    const crossCreate = await request('POST', `/api/v1/admin/branches/${BRANCH_B_ID}/categories`, {
      name: 'Illegal Category'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(crossCreate.status, 403);
    assert.equal(crossCreate.body.error, 'FORBIDDEN_BRANCH_SCOPE');

    // 3. Rename Category
    const renameRes = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/categories/${cat1Id}`, {
      name: 'Minuman Dingin & Hangat'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(renameRes.status, 200);
    assert.equal(renameRes.body.success, true);
    assert.equal(renameRes.body.category.name, 'Minuman Dingin & Hangat');

    // 4. Reorder Categories
    const reorderRes = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}/categories/reorder`, {
      order: [cat2Id, cat1Id]
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(reorderRes.status, 200);
    assert.equal(reorderRes.body.success, true);

    // 5. Delete Category 2
    const delRes = await request('DELETE', `/api/v1/admin/branches/${BRANCH_A_ID}/categories/${cat2Id}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);

    const checkDel = db.prepare('SELECT * FROM branch_categories WHERE id = ?').get(cat2Id);
    assert.equal(checkDel, undefined);
  });

  it('BM3-24: Branch Manager can assign and clear category override on adopted branch product', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    // Create a branch category
    const catRes = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/categories`, {
      name: 'Spesial Cabang'
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(catRes.status, 201);
    const catId = catRes.body.category.id;

    // Assign category to adopted product prod_bm3_adoptable
    const assignRes = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_adoptable/override`, {
      branch_category_id: catId
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.body.success, true);

    const bp = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A_ID, 'prod_bm3_adoptable');
    assert.equal(bp.branch_category_id, catId);

    // Clear category assignment
    const clearRes = await request('PATCH', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_adoptable/override`, {
      branch_category_id: null
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(clearRes.status, 200);
    assert.equal(clearRes.body.success, true);

    const bpCleared = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A_ID, 'prod_bm3_adoptable');
    assert.equal(bpCleared.branch_category_id, null);
  });

  it('BM3-25: Branch Manager can unadopt (remove) product from branch without affecting master catalog', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID });

    // Cross-branch unadopt denied
    const crossRes = await request('DELETE', `/api/v1/admin/branches/${BRANCH_B_ID}/products/prod_bm3_adoptable`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(crossRes.status, 403);
    assert.equal(crossRes.body.error, 'FORBIDDEN_BRANCH_SCOPE');

    // Unadopt from own branch
    const delRes = await request('DELETE', `/api/v1/admin/branches/${BRANCH_A_ID}/products/prod_bm3_adoptable`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);

    // Verify branch_product row is removed
    const bp = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A_ID, 'prod_bm3_adoptable');
    assert.equal(bp, undefined);

    // Verify master product is completely intact
    const master = db.prepare('SELECT * FROM products WHERE id = ?').get('prod_bm3_adoptable');
    assert.ok(master);
    assert.equal(master.name, 'Es Teh Manis Jumbo');
    assert.equal(master.is_active, 1);
  });

  it('BM3-26: index.html contains UI controls for Phase 2 BM Menu workspace', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="btn-bm-menu-add-catalog"'), 'Missing btn-bm-menu-add-catalog');
    assert.ok(html.includes('id="btn-bm-menu-add-category"'), 'Missing btn-bm-menu-add-category');
    assert.ok(html.includes('id="bm-menu-categories-bar"'), 'Missing bm-menu-categories-bar');
    assert.ok(html.includes('id="modal-bm-add-catalog"'), 'Missing modal-bm-add-catalog');
    assert.ok(html.includes('id="bm-add-catalog-list"'), 'Missing bm-add-catalog-list');
  });

  it('BM3-27: dashboard.js implements Phase 2 BM Menu functions and modal triggers', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const menuPath = path.join(__dirname, '../../apps/merchant-app/assets/js/menu.js');
    const js = [jsPath, menuPath]
      .filter(p => fs.existsSync(p))
      .map(p => fs.readFileSync(p, 'utf8'))
      .join('\n');

    assert.ok(js.includes('openBMAddCatalogModal'), 'Missing openBMAddCatalogModal');
    assert.ok(js.includes('promptAddBMBranchCategory'), 'Missing promptAddBMBranchCategory');
    assert.ok(js.includes('deleteBMBranchCategory'), 'Missing deleteBMBranchCategory');
    assert.ok(js.includes('removeBMBranchProduct'), 'Missing removeBMBranchProduct');
    assert.ok(js.includes('renderBMMenuCategoriesBar'), 'Missing renderBMMenuCategoriesBar');
  });
});
