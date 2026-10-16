'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../../server/database/db');

require('../helpers/demoFixtures.js')();
const app = require('../../server/app');

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

test('BRANCH INVENTORY RAW MATERIALS OPERATIONS (BM PERSPECTIVE)', async (t) => {
  let server;
  let bmToken;
  let testBranchId = 'branch_mat_ops_test';
  let testOrgId;
  let testBrandId;
  let testMaterialId = 'mat_ops_cabe_test';
  let testLocId = 'loc_mat_ops_test';

  t.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const brand = db.prepare('SELECT id, organization_id FROM brands LIMIT 1').get();
    testBrandId = brand.id;
    testOrgId = brand.organization_id;

    // Ensure test branch
    db.prepare('DELETE FROM branches WHERE id = ?').run(testBranchId);
    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
      VALUES (?, ?, 'Cabang Mat Ops Test', 'cabang-mat-ops-test', 'Jl. Cabe 123', 0, 0, '081234567891', 1)
    `).run(testBranchId, testBrandId);

    // Ensure stock location
    db.prepare('DELETE FROM stock_locations WHERE id = ?').run(testLocId);
    db.prepare(`
      INSERT INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-MAT-TEST', 'Gudang Cabang Mat Test', 'BRANCH', 1)
    `).run(testLocId, testOrgId, testBranchId);

    // Ensure base uom
    db.prepare("INSERT OR IGNORE INTO uoms (id, code, name, is_active) VALUES ('uom_kg', 'kg', 'Kilogram', 1)").run();

    // Ensure material
    db.prepare('DELETE FROM materials WHERE id = ?').run(testMaterialId);
    db.prepare(`
      INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status)
      VALUES (?, ?, 'MAT-CABE-TEST', 'Cabe Rawit Ops Test', 'uom_kg', 'ACTIVE')
    `).run(testMaterialId, testOrgId);

    // Ensure clean balance
    db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').run(testLocId, testMaterialId);
    db.prepare('DELETE FROM inventory_reorder_policies WHERE stock_location_id = ? AND identity_id = ?').run(testLocId, testMaterialId);

    // Seed initial balance 2 kg
    db.prepare(`
      INSERT INTO material_stock_balances (
        stock_location_id, material_id, quantity_base, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version
      ) VALUES (?, ?, 2.0, 60000, 30000, 'AVAILABLE', 1)
    `).run(testLocId, testMaterialId);

    // Create BM session user
    const bmUserId = 'usr_bm_mat_ops_test';
    db.prepare('DELETE FROM users WHERE id = ?').run(bmUserId);
    db.prepare(`
      INSERT INTO users (id, brand_id, branch_id, username, full_name, email, role, status)
      VALUES (?, ?, ?, 'bm_mat_ops', 'BM Mat Ops', 'bm_mat@test.com', 'branch_manager', 'active')
    `).run(bmUserId, testBrandId, testBranchId);

    const bmUser = db.prepare('SELECT * FROM users WHERE id = ?').get(bmUserId);
    bmToken = global.TokenSessionStore.createSession(bmUser, testBrandId).token;
  });

  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. GET /api/v1/admin/branches/:id/inventory/materials returns list with stock and par level', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/inventory/materials`,
      method: 'GET',
      headers: { Authorization: `Bearer ${bmToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.branch_id, testBranchId);
    assert.ok(Array.isArray(res.body.materials));

    const item = res.body.materials.find(m => m.id === testMaterialId);
    assert.ok(item, 'Material test item must exist');
    assert.strictEqual(item.current_stock, 2.0);
    assert.strictEqual(item.base_uom_name, 'Kilogram');
    assert.strictEqual(item.minimum_quantity, 5); // default fallback
    assert.strictEqual(item.status, 'LOW_STOCK'); // 2 <= 5
  });

  await t.test('2. PUT /api/v1/admin/branches/:id/inventory/materials/:materialId/reorder-policy sets branch par level', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/inventory/materials/${testMaterialId}/reorder-policy`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${bmToken}` }
    }, {
      minimum_quantity: 1.5,
      target_quantity: 8.0
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.minimum_quantity, 1.5);
    assert.strictEqual(res.body.target_quantity, 8.0);

    // Check GET again, status should now be SAFE (2.0 > 1.5)
    const getRes = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/inventory/materials`,
      method: 'GET',
      headers: { Authorization: `Bearer ${bmToken}` }
    });
    const item = getRes.body.materials.find(m => m.id === testMaterialId);
    assert.strictEqual(item.minimum_quantity, 1.5);
    assert.strictEqual(item.target_quantity, 8.0);
    assert.strictEqual(item.status, 'SAFE');
  });

  await t.test('3. POST /api/v1/admin/branches/:id/inventory/materials/:materialId/adjust records stock opname adjustment', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/inventory/materials/${testMaterialId}/adjust`,
      method: 'POST',
      headers: { Authorization: `Bearer ${bmToken}` }
    }, {
      counted_quantity: 6.0,
      adjustment_type: 'AUDIT',
      notes: 'Stok Opname Pagi Hari'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.previous_quantity, 2.0);
    assert.strictEqual(res.body.current_stock, 6.0);
    assert.strictEqual(res.body.adjustment_quantity, 4.0);
    assert.strictEqual(res.body.movement_type, 'ADJUSTMENT_IN');

    // Verify in db balance
    const bal = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(testLocId, testMaterialId);
    assert.strictEqual(Number(bal.quantity_base), 6.0);
  });

  await t.test('4. POST /api/v1/admin/branches/:id/inventory/materials/:materialId/adjust records waste/spoilage', async () => {
    const res = await makeRequest(server, {
      path: `/api/v1/admin/branches/${testBranchId}/inventory/materials/${testMaterialId}/adjust`,
      method: 'POST',
      headers: { Authorization: `Bearer ${bmToken}` }
    }, {
      counted_quantity: 5.2,
      adjustment_type: 'WASTE',
      notes: 'Cabe 0.8kg membusuk di kulkas'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.previous_quantity, 6.0);
    assert.strictEqual(res.body.current_stock, 5.2);
    assert.strictEqual(res.body.movement_type, 'WASTE');

    // Verify in db balance
    const bal = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(testLocId, testMaterialId);
    assert.strictEqual(Number(bal.quantity_base), 5.2);
  });

  await t.test('5. Enforces branch scope isolation for Branch Manager', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/branches/other_branch_id/inventory/materials',
      method: 'GET',
      headers: { Authorization: `Bearer ${bmToken}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });
});
