'use strict';

/**
 * BM-1 — Branch Manager Dashboard Shell + Access + Hari Ini: Test Suite
 *
 * Requirements Matrix:
 * - BM1-01: Unauthenticated request cannot access branch manager endpoints (401).
 * - BM1-02: Authenticated Branch Manager can access assigned branch details, orders, layout, and inventory.
 * - BM1-03: Cashier / Kitchen role cannot gain Branch Manager operational authority (cannot toggle branch status).
 * - BM1-04: Branch Manager cannot access another branch by URL path parameter (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM1-05: Branch Manager cannot access another branch orders (403 FORBIDDEN_BRANCH_ACCESS).
 * - BM1-06: Client-supplied role tampering in request cannot elevate authority.
 * - BM1-07: Client-supplied branch_id in query parameter cannot widen branch scope.
 * - BM1-08: Owner remains governed by Owner Dashboard authority (can see across branches).
 * - BM1-09: Branch Manager cannot mutate Owner-only governance fields (e.g. is_active).
 * - BM1-10: Refresh/re-entry reconstructs branch context from server state.
 * - BM1-11: Authoritative API endpoints return genuine data, not hardcoded metrics.
 * - BM1-12: Session invalidation / token removal terminates operational access.
 *
 * Structural Invariants:
 * - Dashboard HTML contains tab-hari-ini and 8 route placeholder sections (bm-pesanan, bm-meja, bm-menu, bm-promo, bm-stok, bm-staff, bm-jam-operasional, bm-reports).
 * - dashboard.js exports/defines BM_ROUTE_META with all 9 canonical routes.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm1-dashboard-shell';

const app = require('../../server/app');
const db = require('../../server/database/db');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm1_user_test' } = {}) {
  const token = 'bm1_tok_' + crypto.randomBytes(8).toString('hex');
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
    expiresAt: Date.now() + 86400 * 1000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiPath = path.startsWith('/api') ? path : ('/api/v1' + path);
    const url = new URL(apiPath, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

describe('BM-1 — Branch Manager Dashboard Shell + Access + Hari Ini', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const now = new Date().toISOString();
    // Ensure branches exist
    const bA = db.prepare("SELECT * FROM branches WHERE id = ?").get(BRANCH_A_ID);
    if (!bA) {
      db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.25, 112.75, 1, 1, ?, ?)')
        .run(BRANCH_A_ID, BRAND_ID, 'Cabang BM1 Barat', 'surabaya-barat', 'Jl. Barat No 1', now, now);
    }
    const bB = db.prepare("SELECT * FROM branches WHERE id = ?").get(BRANCH_B_ID);
    if (!bB) {
      db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.26, 112.76, 1, 1, ?, ?)')
        .run(BRANCH_B_ID, BRAND_ID, 'Cabang BM1 Timur', 'surabaya-timur', 'Jl. Timur No 2', now, now);
    }

    // Seed sample dine-in tables for branch A
    try {
      db.prepare('INSERT OR IGNORE INTO restaurant_tables (id, branch_id, table_number, capacity, operational_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('tbl_bm1_1', BRANCH_A_ID, 'T-01', 4, 'available', now, now);
      db.prepare('INSERT OR IGNORE INTO restaurant_tables (id, branch_id, table_number, capacity, operational_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('tbl_bm1_2', BRANCH_A_ID, 'T-02', 2, 'occupied', now, now);
    } catch (_) {}

    // Seed sample orders for branch A
    const orderId1 = 'ord_bm1_p1';
    db.prepare(`
      INSERT OR IGNORE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, status, subtotal, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Budi', '08123456789', 'delivery', 'pending', 45000, 45000, 'cash', 'unpaid', ?, ?)
    `).run(orderId1, 'BM1-ORD-1', BRAND_ID, BRANCH_A_ID, now, now);

    db.prepare('INSERT OR IGNORE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('item_bm1_1', orderId1, 'prod_bm1_1', 'Nasi Goreng Spesial', 45000, 1, 45000);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('BM1-01: Unauthenticated request cannot access branch manager endpoints', async () => {
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it('BM1-02: Authenticated Branch Manager can access assigned branch details, orders, and layout', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Branch details
    const resBranch = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resBranch.status, 200);
    assert.equal(resBranch.body.success, true);
    assert.equal(resBranch.body.branch.id, BRANCH_A_ID);

    // Orders
    const resOrders = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/orders`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resOrders.status, 200);
    assert.equal(resOrders.body.success, true);
    assert.ok(Array.isArray(resOrders.body.orders));

    // Dine-in layout
    const resLayout = await request('GET', `/api/v1/dine-in/layout?branch_id=${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resLayout.status, 200);
    assert.equal(resLayout.body.success, true);
  });

  it('BM1-03: Cashier or Kitchen role cannot gain Branch Manager operational authority', async () => {
    const cashierToken = seedStaffSession({ role: 'cashier', branchId: BRANCH_A_ID });

    // Cashier attempting to mutate branch status
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, {
      is_open_override: 0
    }, {
      Authorization: `Bearer ${cashierToken}`
    });
    assert.equal(res.status, 403);
  });

  it('BM1-04: Branch Manager cannot access another branch by URL path parameter (403 FORBIDDEN_BRANCH_SCOPE)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Attempting to read branch B details
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM1-05: Branch Manager cannot access another branch orders (403 FORBIDDEN_BRANCH_ACCESS)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Attempting to read branch B orders
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/orders`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('BM1-06: Client-supplied role tampering cannot elevate privileges', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Send payload claiming role = owner
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_B_ID}`, {
      role: 'owner',
      is_open_override: 0
    }, {
      Authorization: `Bearer ${token}`
    });
    // Server must honor session.role and reject cross-branch mutation
    assert.equal(res.status, 403);
  });

  it('BM1-07: Client-supplied branch_id in query parameter cannot widen scope', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/orders?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('BM1-08: Owner remains governed by Owner Dashboard authority (can see across branches)', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', branchId: null });

    const resBranchA = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.equal(resBranchA.status, 200);

    const resBranchB = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.equal(resBranchB.status, 200);
  });

  it('BM1-09: Branch Manager cannot mutate Owner-only governance fields (e.g. is_active or floor layout geometry)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Branch Manager cannot mutate branch is_active
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, {
      is_active: 0
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.ok(res.body.error === 'FORBIDDEN_GOVERNANCE_MUTATION' || res.body.error === 'INSUFFICIENT_PERMISSIONS');

    // Branch Manager cannot mutate physical floor-plan geometry
    const resLayout = await request('PUT', `/api/v1/dine-in/layout/${BRANCH_A_ID}`, {
      canvas: { width: 1000, height: 1000 },
      tables: []
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resLayout.status, 403);
    assert.equal(resLayout.body.error, 'INSUFFICIENT_PERMISSIONS');
  });

  it('BM1-10: Refresh/re-entry reconstructs branch context from server state', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const resMe = await request('GET', '/api/v1/auth/merchant/me', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resMe.status, 200);
    assert.equal(resMe.body.success, true);
    assert.equal(resMe.body.user.role, 'branch_manager');
    assert.equal(resMe.body.user.branch_id, BRANCH_A_ID);
  });

  it('BM1-11: Authoritative API endpoints return genuine data, not hardcoded metrics', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/orders?status=all`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.orders));
    const found = res.body.orders.find(o => o.id === 'ord_bm1_p1');
    assert.ok(found, 'Seeded order ord_bm1_p1 must exist');
    assert.equal(found.order_number, 'BM1-ORD-1');
    assert.equal(found.grand_total, 45000);
  });

  it('BM1-12: Session invalidation / token removal terminates operational access', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Verify access works first
    const res1 = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res1.status, 200);

    // Invalidate session from TokenSessionStore
    if (global.TokenSessionStore && global.TokenSessionStore.sessions) {
      global.TokenSessionStore.sessions.delete(token);
    }

    // Access must fail with 401
    const res2 = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res2.status, 401);
  });

  it('BM1-13: index.html contains tab-hari-ini and 8 BM route placeholders', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="tab-hari-ini"'), 'Missing tab-hari-ini');
    assert.ok(html.includes('id="tab-bm-pesanan"'), 'Missing tab-bm-pesanan');
    assert.ok(html.includes('id="tab-bm-meja"'), 'Missing tab-bm-meja');
    assert.ok(html.includes('id="tab-bm-menu"'), 'Missing tab-bm-menu');
    assert.ok(html.includes('id="tab-bm-promo"'), 'Missing tab-bm-promo');
    assert.ok(html.includes('id="tab-bm-stok"'), 'Missing tab-bm-stok');
    assert.ok(html.includes('id="tab-bm-staff"'), 'Missing tab-bm-staff');
    assert.ok(html.includes('id="tab-bm-jam-operasional"'), 'Missing tab-bm-jam-operasional');
    assert.ok(html.includes('id="tab-bm-reports"'), 'Missing tab-bm-reports');
  });

  it('BM1-14: dashboard.js defines BM_ROUTE_META with all 9 canonical routes and loads Hari Ini', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    assert.ok(js.includes('var BM_ROUTE_META ='), 'Missing BM_ROUTE_META');
    assert.ok(js.includes('function renderBranchManagerNavigation()'), 'Missing renderBranchManagerNavigation');
    assert.ok(js.includes('function loadHariIni()'), 'Missing loadHariIni');
    assert.ok(js.includes('function toggleBranchOpen()'), 'Missing toggleBranchOpen');

    const expectedRoutes = ['hari-ini', 'pesanan', 'meja', 'menu', 'promo', 'stok', 'staff', 'reports', 'jam-operasional'];
    expectedRoutes.forEach(r => {
      assert.ok(js.includes(`"${r}"`), `Missing route in JS: ${r}`);
    });
  });

  it('BM1-15: Navigation IA & Branch Context element match locked contract for Branch Manager', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Branch context badge belongs to the Merchant App; the owner branch selector stays in legacy.
    const legacyHtml = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/index.html'), 'utf8');
    assert.ok(legacyHtml.includes('id="x-branch-selector"'), 'Missing x-branch-selector for owner in legacy dashboard');
    assert.ok(!html.includes('id="x-branch-selector"'), 'Merchant App must not render the owner branch selector');
    assert.ok(html.includes('id="dash-bm-branch-badge"'), 'Missing dash-bm-branch-badge for branch manager');
    assert.ok(html.includes('id="dash-bm-branch-name"'), 'Missing dash-bm-branch-name for branch manager');

    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    // BM navigation must contain canonical labels: Hari Ini, Operasional (Pesanan, Meja, Menu, Promo, Stok), Tim (Staff), Laporan (Penjualan Hari Ini), Pengaturan (Jam Operasional)
    assert.ok(js.includes('>HARI INI</div>'), 'Missing HARI INI group label in BM nav');
    assert.ok(js.includes('>OPERASIONAL</div>'), 'Missing OPERASIONAL group label in BM nav');
    assert.ok(js.includes('>TIM</div>'), 'Missing TIM group label in BM nav');
    assert.ok(js.includes('>LAPORAN</div>'), 'Missing LAPORAN group label in BM nav');
    assert.ok(js.includes('>PENGATURAN</div>'), 'Missing PENGATURAN group label in BM nav');
    assert.ok(js.includes('>Penjualan Hari Ini</span>'), 'Missing Penjualan Hari Ini item in BM nav');
    assert.ok(js.includes('>Jam Operasional</span>'), 'Missing Jam Operasional item in BM nav');

    // Branch context switching: BM hides selector, displays badge; Owner shows selector, hides badge
    assert.ok(js.includes("dash-bm-branch-badge"), 'Missing dash-bm-branch-badge reference in JS');
    assert.ok(js.includes("dash-bm-branch-name"), 'Missing dash-bm-branch-name reference in JS');
  });
});
