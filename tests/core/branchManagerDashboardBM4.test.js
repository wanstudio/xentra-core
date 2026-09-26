'use strict';

/**
 * BM-4 — Branch Manager Dashboard: Staff, Jam Operasional, Reports & Online Order Controls
 *
 * Requirements Matrix:
 * - BM4-01: Branch Manager can view staff assigned to their branch.
 * - BM4-02: Branch Manager CANNOT view staff from other branches (scoped).
 * - BM4-03: Branch Manager can create a cashier user assigned to their own branch.
 * - BM4-04: Branch Manager CANNOT create roles exceeding cashier (e.g. owner, brand_manager) -> 403.
 * - BM4-05: Branch Manager can toggle staff active/inactive status in own branch.
 * - BM4-06: Branch Manager can generate a password reset token for cashiers in own branch.
 * - BM4-07: Branch Manager can toggle online order delivery status (is_delivery_active: 0/1) for own branch.
 * - BM4-08: Cross-branch online delivery update is rejected (403 FORBIDDEN_BRANCH_SCOPE).
 * - BM4-09: Branch Manager can read branch operational report metrics scoped to assigned branch.
 * - BM4-10: index.html contains fully rendered UI surfaces for tab-bm-staff, tab-bm-jam-operasional, tab-bm-reports, and online order toggle button.
 * - BM4-11: dashboard.js implements loadBMStaff, toggleBMStaffStatus, resetBMStaffPassword, loadBMJamOperasional, loadBMReports, and toggleBranchOnlineOrders.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm4-staff-hours-reports';

const app = require('../../server/app');
const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm4_user_test' } = {}) {
  const token = 'bm4_tok_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    branchId,
    branch_id: branchId,
    userId,
    id: userId,
    username: 'test_' + role,
    created_at: new Date().toISOString()
  };
  if (store && typeof store.setSession === 'function') {
    store.setSession(token, sess);
  } else if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Host: 'app.mybangjo.com',
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('BM-4 — Branch Manager Dashboard: Staff, Jam Operasional & Reports', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed test cashiers for branch A and branch B
    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES ('user_bm4_cashier_a', ?, ?, ?, 'cashier_a_test', 'hash', 'Kasir Cabang A', 'cashier_a@test.com', 'cashier', 'active', datetime('now'), datetime('now'))
    `).run(BRAND_ID, ORG_ID, BRANCH_A_ID);

    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES ('user_bm4_cashier_b', ?, ?, ?, 'cashier_b_test', 'hash', 'Kasir Cabang B', 'cashier_b@test.com', 'cashier', 'active', datetime('now'), datetime('now'))
    `).run(BRAND_ID, ORG_ID, BRANCH_B_ID);
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('BM4-01: Branch Manager can view staff assigned to their branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/users?branch_id=${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.users));
    const userA = res.body.users.find(u => u.id === 'user_bm4_cashier_a');
    assert.ok(userA);
    assert.equal(userA.branch_id, BRANCH_A_ID);
  });

  it('BM4-02: Branch Manager cannot query staff from other branch (403 FORBIDDEN_BRANCH_ACCESS)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/users?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${token}`
    });

    // Server-enforced requireAuth middleware rejects cross-branch query
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('BM4-03: Branch Manager can create a cashier user assigned to their own branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const username = 'kasir_bm4_' + crypto.randomBytes(4).toString('hex');
    const res = await request('POST', '/api/v1/admin/users', {
      username,
      password: 'password123',
      full_name: 'Kasir Baru Branch A',
      role: 'cashier',
      branch_id: BRANCH_A_ID
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'cashier');
    assert.equal(res.body.user.branch_id, BRANCH_A_ID);
  });

  it('BM4-04: Branch Manager CANNOT create roles exceeding cashier (403 FORBIDDEN_ROLE_CEILING)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('POST', '/api/v1/admin/users', {
      username: 'fake_manager_' + crypto.randomBytes(4).toString('hex'),
      password: 'password123',
      full_name: 'Fake Brand Manager',
      role: 'brand_manager',
      branch_id: BRANCH_A_ID
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_ROLE_CEILING');
  });

  it('BM4-05: Branch Manager can toggle staff active/inactive status in own branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    
    // Disable
    const resDisable = await request('POST', '/api/v1/admin/users/user_bm4_cashier_a/disable', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resDisable.status, 200);
    assert.equal(resDisable.body.success, true);
    assert.equal(resDisable.body.user.status, 'disabled');

    // Enable
    const resEnable = await request('POST', '/api/v1/admin/users/user_bm4_cashier_a/enable', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resEnable.status, 200);
    assert.equal(resEnable.body.success, true);
    assert.equal(resEnable.body.user.status, 'active');
  });

  it('BM4-06: Branch Manager can generate a password reset token for cashiers in own branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('POST', '/api/v1/admin/users/user_bm4_cashier_a/reset-password', null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.reset_token, 'reset_token must be generated and returned');
  });

  it('BM4-07: Branch Manager can toggle online order delivery status (is_delivery_active: 0/1) for own branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });

    // Pause online delivery
    const resPause = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, {
      is_delivery_active: 0
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resPause.status, 200);
    assert.equal(resPause.body.success, true);

    // Verify in branch details
    const resCheck = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resCheck.status, 200);
    assert.equal(resCheck.body.branch.is_delivery_active, 0);

    // Resume online delivery
    const resResume = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, {
      is_delivery_active: 1
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(resResume.status, 200);
    assert.equal(resResume.body.success, true);
  });

  it('BM4-08: Cross-branch online delivery update is rejected with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_B_ID}`, {
      is_delivery_active: 0
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('BM4-09: Branch Manager can query branch-scoped orders for client operational reporting feed', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/orders?status=all`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.orders));
    // Verify all returned orders strictly belong to the assigned branch
    for (const ord of res.body.orders) {
      assert.equal(ord.branch_id, BRANCH_A_ID, 'Order must belong to assigned branch');
    }
  });

  it('BM4-10: index.html contains fully rendered UI surfaces for tab-bm-staff, tab-bm-jam-operasional, tab-bm-reports, and online toggle', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Tab staff
    assert.ok(html.includes('id="tab-bm-staff"'), 'Missing tab-bm-staff');
    assert.ok(html.includes('id="bm-staff-tbody"'), 'Missing bm-staff-tbody');
    assert.ok(html.includes('id="bm-staff-stat-total"'), 'Missing bm-staff-stat-total');

    // Tab jam operasional
    assert.ok(html.includes('id="tab-bm-jam-operasional"'), 'Missing tab-bm-jam-operasional');
    assert.ok(html.includes('id="bm-jam-status-text"'), 'Missing bm-jam-status-text');
    assert.ok(html.includes('id="bm-jam-delivery-text"'), 'Missing bm-jam-delivery-text');

    // Tab reports
    assert.ok(html.includes('id="tab-bm-reports"'), 'Missing tab-bm-reports');
    assert.ok(html.includes('id="bm-report-stat-sales"'), 'Missing bm-report-stat-sales');
    assert.ok(html.includes('id="bm-report-channel-delivery"'), 'Missing bm-report-channel-delivery');

    // Online toggle in Hari Ini
    assert.ok(html.includes('id="btn-bm-toggle-online-orders"'), 'Missing btn-bm-toggle-online-orders');
  });

  it('BM4-12: staff.js has one canonical Staff implementation and uses the standalone BM cashier modal', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/staff.js');
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const js = fs.readFileSync(jsPath, 'utf8');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const countFunction = (name) => {
      const matches = js.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || [];
      return matches.length;
    };

    for (const name of [
      'loadBMStaff',
      'renderBMStaffTable',
      'openBMAddCashierModal',
      'toggleBMStaffStatus',
      'resetBMStaffPassword'
    ]) {
      assert.equal(countFunction(name), 1, name + ' must have exactly one implementation');
    }

    assert.ok(js.includes("var modal = $('modal-bm-add-cashier');"), 'Staff add flow must use the standalone BM cashier modal');
    assert.ok(js.includes("var form = $('form-bm-add-cashier');"), 'Staff add flow must reset the standalone BM cashier form');
    assert.ok(html.includes('id="modal-bm-add-cashier"'), 'Standalone BM cashier modal must exist');
    assert.ok(html.includes('id="form-bm-add-cashier"'), 'Standalone BM cashier form must exist');
    assert.ok(!js.includes('openCreateUserModal()'), 'Merchant App Staff flow must not depend on dashboard-only create-user modal');
    assert.ok(!js.includes("openEditUser('"), 'Merchant App Staff flow must not reference an undefined dashboard-only edit-user handler');
  });

  it('BM4-11: staff, jam operasional, reports and online-order controls live in their canonical modules', () => {
    const staffPath = path.join(__dirname, '../../apps/merchant-app/assets/js/staff.js');
    const jamPath = path.join(__dirname, '../../apps/merchant-app/assets/js/jam-operasional.js');
    const reportsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/reports.js');
    const hariIniPath = path.join(__dirname, '../../apps/merchant-app/assets/js/hari-ini.js');

    const staffJs = fs.readFileSync(staffPath, 'utf8');
    const jamJs = fs.readFileSync(jamPath, 'utf8');
    const reportsJs = fs.readFileSync(reportsPath, 'utf8');
    const hariIniJs = fs.readFileSync(hariIniPath, 'utf8');

    assert.ok(staffJs.includes('async function loadBMStaff()'), 'Missing loadBMStaff');
    assert.ok(staffJs.includes('async function toggleBMStaffStatus('), 'Missing toggleBMStaffStatus');
    assert.ok(staffJs.includes('async function resetBMStaffPassword('), 'Missing resetBMStaffPassword');
    assert.ok(jamJs.includes('async function loadBMJamOperasional()'), 'Missing loadBMJamOperasional');
    assert.ok(reportsJs.includes('async function loadBMReports()'), 'Missing loadBMReports');
    assert.ok(hariIniJs.includes('async function toggleBranchOnlineOrders()'), 'Missing toggleBranchOnlineOrders');
  });

  it('BM4-12: merchant-app.js no longer contains Staff or operational-hours/report controller implementations', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    for (const name of [
      'loadBMStaff',
      'toggleBMStaffStatus',
      'resetBMStaffPassword',
      'loadBMJamOperasional',
      'loadBMReports'
    ]) {
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }
  });
});
