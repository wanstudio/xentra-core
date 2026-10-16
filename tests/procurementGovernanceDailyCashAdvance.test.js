'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../server/database/db');

require('./helpers/demoFixtures.js')();
const app = require('../server/app');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
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
    if (payload != null) req.write(payload);
    req.end();
  });
}

test('PROCUREMENT GOVERNANCE & DAILY PETTY CASH LIFECYCLE', async (t) => {
  let server;
  let ownerToken;
  let staffToken;
  let bmToken;
  let testBranchId = 'branch_governance_test';
  let testOrgId;
  let testBrandId;
  let testMaterialId = 'mat_gov_test_beef';
  let testLocId = 'loc_gov_test';

  t.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    // Get brand and org
    const brand = db.prepare('SELECT id, organization_id FROM brands LIMIT 1').get();
    testBrandId = brand.id;
    testOrgId = brand.organization_id;

    // Ensure test branch exists
    db.prepare('DELETE FROM branches WHERE id = ?').run(testBranchId);
    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, daily_petty_cash_limit)
      VALUES (?, ?, 'Cabang Governance Test', 'cabang-gov-test', 'Jl. Uji Coba 123', 0, 0, '081234567890', 1, 500000)
    `).run(testBranchId, testBrandId);

    // Ensure stock location exists for branch
    db.prepare('DELETE FROM stock_locations WHERE id = ?').run(testLocId);
    db.prepare(`
      INSERT INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-GOV-TEST', 'Gudang Cabang Test', 'BRANCH', 1)
    `).run(testLocId, testOrgId, testBranchId);

    // Ensure base uom exists
    db.prepare("INSERT OR IGNORE INTO uoms (id, code, name, is_active) VALUES ('uom_kg', 'kg', 'Kilogram', 1)").run();

    // Ensure material exists
    db.prepare('DELETE FROM materials WHERE id = ?').run(testMaterialId);
    db.prepare(`
      INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status)
      VALUES (?, ?, 'MAT-BEEF-TEST', 'Daging Sapi Test', 'uom_kg', 'ACTIVE')
    `).run(testMaterialId, testOrgId);

    // Delete existing balance
    db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').run(testLocId, testMaterialId);

    // Create users for auth
    db.prepare("INSERT OR IGNORE INTO users (id, brand_id, branch_id, username, full_name, email, role, status) VALUES ('usr_gov_owner', ?, NULL, 'owner_gov', 'Owner Test', 'owner_gov@test.com', 'owner', 'active')").run(testBrandId);
    db.prepare("INSERT OR IGNORE INTO users (id, brand_id, branch_id, username, full_name, email, role, status) VALUES ('usr_gov_bm', ?, ?, 'bm_gov', 'Manager Test', 'bm_gov@test.com', 'branch_manager', 'active')").run(testBrandId, testBranchId);
    db.prepare("INSERT OR IGNORE INTO users (id, brand_id, branch_id, username, full_name, email, role, status) VALUES ('usr_gov_staff', ?, ?, 'staff_gov', 'Staff Test', 'staff_gov@test.com', 'purchasing', 'active')").run(testBrandId, testBranchId);

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_gov_owner'").get();
    const bmUser = db.prepare("SELECT * FROM users WHERE id = 'usr_gov_bm'").get();
    const staffUser = db.prepare("SELECT * FROM users WHERE id = 'usr_gov_staff'").get();

    ownerToken = global.TokenSessionStore.createSession(ownerUser, testBrandId).token;
    bmToken = global.TokenSessionStore.createSession(bmUser, testBrandId).token;
    staffToken = global.TokenSessionStore.createSession(staffUser, testBrandId).token;
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('1. GET /admin/branches/:id/purchasing/checklist returns daily_petty_cash_limit', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/purchasing/checklist`,
      headers: { Authorization: `Bearer ${staffToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.daily_petty_cash_limit, 500000);
  });

  await t.test('2. POST /admin/branches/:id/purchasing/settle blocks staff when expenditure > daily_petty_cash_limit', async () => {
    // 500,000 limit, staff attempts 600,000 (e.g. 5 kg @ 120,000)
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/purchasing/settle`,
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    }, {
      cash_advance: 600000,
      items: [
        {
          material_id: testMaterialId,
          quantity: 5,
          unit_price: 120000
        }
      ]
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'EXCEEDS_PETTY_CASH_LIMIT');
    assert.strictEqual(res.body.daily_petty_cash_limit, 500000);
    assert.strictEqual(res.body.total_real_expenditure, 600000);
  });

  await t.test('3. POST /admin/branches/:id/purchasing/request-advance notifies owner and populates recipients', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/purchasing/request-advance`,
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    }, {
      requested_amount: 750000,
      reason: 'Harga daging sapi naik di pasar'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.requested_amount, 750000);

    // Verify notification was stored
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(res.body.notification_id);
    assert.ok(notif, 'Notification must exist in database');
    assert.strictEqual(notif.source_type, 'CASH_ADVANCE_REQUEST');
    assert.strictEqual(notif.target_role, 'owner');
    assert.ok(notif.action_url.includes('suggested_advance=750000'), 'action_url must contain suggested_advance parameter');

    // Verify recipient was linked
    const rcp = db.prepare('SELECT * FROM notification_recipients WHERE notification_id = ?').all(res.body.notification_id);
    assert.ok(rcp.length > 0, 'Must insert into notification_recipients for owner');
  });

  await t.test('4. Branch Manager cannot change daily_petty_cash_limit (RBAC check)', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${bmToken}` }
    }, {
      daily_petty_cash_limit: 800000
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'INSUFFICIENT_PERMISSIONS');
  });

  await t.test('5. Owner updates daily_petty_cash_limit to 750,000', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      daily_petty_cash_limit: 750000
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    const b = db.prepare('SELECT daily_petty_cash_limit FROM branches WHERE id = ?').get(testBranchId);
    assert.strictEqual(Number(b.daily_petty_cash_limit), 750000);
  });

  await t.test('6. POST /admin/branches/:id/purchasing/settle succeeds now that expenditure (600,000) <= new limit (750,000)', async () => {
    const receiptPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/purchasing/settle`,
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    }, {
      cash_advance: 750000,
      items: [
        {
          material_id: testMaterialId,
          quantity: 5,
          unit_price: 120000
        }
      ],
      receipt_photo_url: receiptPhoto
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.total_real_expenditure, 600000);
    assert.strictEqual(res.body.change_due, 150000);

    // Verify stock balance was updated correctly
    const balance = db.prepare('SELECT * FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(testLocId, testMaterialId);
    assert.ok(balance, 'Material balance must exist');
    assert.strictEqual(Number(balance.quantity_base), 5);
    assert.strictEqual(Number(balance.carrying_value), 600000);
    assert.strictEqual(Number(balance.moving_average_unit_cost), 120000);

    // Verify history returns receipt_photo_url
    const histRes = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/purchasing/history`,
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(histRes.status, 200);
    assert.ok(histRes.body.sessions && histRes.body.sessions.length > 0);
    const latest = histRes.body.sessions[0];
    assert.strictEqual(latest.receipt_photo_url, receiptPhoto);
  });
});
