const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../server/database/db');
const app = require('../server/app');

// Helper to make real HTTP requests to Express app
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
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('BRANCH MANAGEMENT CRUD SUITE (Create, Display, Edit, Delete)', async (t) => {
  let server;
  let ownerToken;

  await t.test('0. Setup: start server and authenticate owner', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    // Authenticate owner for brand_bangjo
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Bangjo owner must exist in DB');
    const { token } = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');
    ownerToken = token;
    assert.ok(ownerToken, 'Token session created');
  });

  let createdBranchId = null;

  await t.test('1. CREATE: Successfully create a new branch with valid data', async () => {
    const branchPayload = {
      name: 'Cabang Baru Test Sudirman',
      address_text: 'Jl. Jenderal Sudirman No. 45, Jakarta Pusat',
      phone: '081234567899',
      whatsapp_number: '081234567899',
      latitude: -6.2088,
      longitude: 106.8456,
      free_delivery_km: 2.5,
      price_per_km: 3500,
      max_radius_km: 15,
      promo_min_order: 60000,
      promo_delivery_discount: 10000,
      is_open_override: 1
    };

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/admin/branches',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, branchPayload);

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.branch_id);
    createdBranchId = res.body.branch_id;

    // Verify row in database
    const branchRow = db.prepare('SELECT * FROM branches WHERE id = ?').get(createdBranchId);
    assert.ok(branchRow, 'Branch row must exist in DB');
    assert.strictEqual(branchRow.name, 'Cabang Baru Test Sudirman');
    assert.strictEqual(branchRow.brand_id, 'brand_bangjo');
    assert.strictEqual(branchRow.whatsapp_number, '081234567899');
    assert.strictEqual(branchRow.is_active, 1);
    assert.strictEqual(branchRow.is_open_override, 1);

    // Verify delivery settings row in database
    const bdsRow = db.prepare('SELECT * FROM branch_delivery_settings WHERE branch_id = ?').get(createdBranchId);
    assert.ok(bdsRow, 'Delivery settings row must exist in DB');
    assert.strictEqual(bdsRow.free_delivery_km, 2.5);
    assert.strictEqual(bdsRow.price_per_km, 3500);
    assert.strictEqual(bdsRow.max_radius_km, 15);
  });

  await t.test('1b. CREATE: Rejects invalid or missing WhatsApp number', async () => {
    const invalidPayload = {
      name: 'Cabang No WA',
      address_text: 'Jl. Test',
      phone: '',
      whatsapp_number: ''
    };

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/admin/branches',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, invalidPayload);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('2. DISPLAY: GET /admin/branches returns registered branches including newly created branch', async () => {
    const res = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/admin/branches',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.branches));

    const found = res.body.branches.find(b => b.id === createdBranchId);
    assert.ok(found, 'Newly created branch must appear in branches list');
    assert.strictEqual(found.name, 'Cabang Baru Test Sudirman');
    assert.strictEqual(found.whatsapp_number, '081234567899');
    assert.strictEqual(found.free_delivery_km, 2.5);
    assert.strictEqual(found.price_per_km, 3500);
    assert.strictEqual(found.max_radius_km, 15);
  });

  await t.test('3. EDIT: PUT /admin/branches/:id updates branch details and delivery settings', async () => {
    const editPayload = {
      name: 'Cabang Baru Test Sudirman (Updated)',
      address_text: 'Jl. Jenderal Sudirman No. 99, Jakarta Pusat',
      phone: '081234567888',
      whatsapp_number: '081234567888',
      latitude: -6.2100,
      longitude: 106.8500,
      free_delivery_km: 3.0,
      price_per_km: 4000,
      max_radius_km: 20,
      promo_min_order: 75000,
      promo_delivery_discount: 15000,
      is_open_override: 0
    };

    const res = await makeRequest(server, {
      method: 'PUT',
      path: `/api/v1/admin/branches/${createdBranchId}`,
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, editPayload);

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);

    // Verify DB update
    const updatedBranch = db.prepare('SELECT * FROM branches WHERE id = ?').get(createdBranchId);
    assert.strictEqual(updatedBranch.name, 'Cabang Baru Test Sudirman (Updated)');
    assert.strictEqual(updatedBranch.whatsapp_number, '081234567888');
    assert.strictEqual(updatedBranch.is_open_override, 0);

    const updatedBds = db.prepare('SELECT * FROM branch_delivery_settings WHERE branch_id = ?').get(createdBranchId);
    assert.strictEqual(updatedBds.free_delivery_km, 3.0);
    assert.strictEqual(updatedBds.price_per_km, 4000);
    assert.strictEqual(updatedBds.max_radius_km, 20);
  });

  await t.test('4. DELETE: Successfully deletes inactive branch with 0 orders and clears database records', async () => {
    // Deactivate branch first (real workflow: operator disables before deleting)
    db.prepare('UPDATE branches SET is_active = 0 WHERE id = ?').run(createdBranchId);

    const res = await makeRequest(server, {
      method: 'DELETE',
      path: `/api/v1/admin/branches/${createdBranchId}`,
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.branch_id, createdBranchId);
    assert.strictEqual(res.body.archived, false, 'Branch with no orders must be permanently deleted, not archived');

    // Verify branch is COMPLETELY removed from DB
    const branchCheck = db.prepare('SELECT * FROM branches WHERE id = ?').get(createdBranchId);
    assert.strictEqual(branchCheck, undefined, 'Branch must be deleted from branches table');

    // Verify delivery settings also deleted
    const bdsCheck = db.prepare('SELECT * FROM branch_delivery_settings WHERE branch_id = ?').get(createdBranchId);
    assert.strictEqual(bdsCheck, undefined, 'Delivery settings must be deleted');

    // Verify subsequent GET /admin/branches no longer includes it
    const listRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/admin/branches',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(!listRes.body.branches.some(b => b.id === createdBranchId), 'Deleted branch must not appear in branches list');
  });

  await t.test('4b. DELETE: Nonexistent branch returns 404', async () => {
    const res = await makeRequest(server, {
      method: 'DELETE',
      path: '/api/v1/admin/branches/branch_nonexistent_999',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('4c. DELETE: Inactive branch with transaction history gets archived (not hard-deleted)', async () => {
    // Create an INACTIVE branch with a settled order (transaction history)
    const branchWithOrderId = 'branch_test_order_' + Date.now().toString(36);
    const branchWithOrderSlug = 'cabang-orders-' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, whatsapp_number, is_active)
      VALUES (?, 'brand_bangjo', 'Cabang With Orders', ?, 'Jl. Order', 0, 0, '081234567800', '081234567800', 0)
    `).run(branchWithOrderId, branchWithOrderSlug);


    const testOrderId = 'ord_test_' + Date.now().toString(36);
    const testOrderNumber = 'ORD-' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_method, payment_status)
      VALUES (?, ?, 'brand_bangjo', ?, 'Cust', '081234567800', 'pickup', 'completed', 25000, 25000, 'cash', 'settlement')
    `).run(testOrderId, testOrderNumber, branchWithOrderId);

    const res = await makeRequest(server, {
      method: 'DELETE',
      path: `/api/v1/admin/branches/${branchWithOrderId}`,
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    assert.strictEqual(res.status, 200, `Inactive branch with history must be archived (200), got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.archived, true, 'Response must indicate branch was archived');
    assert.ok(res.body.message && res.body.message.includes('diarsipkan'), 'Message must mention archiving');

    // Verify branch is archived, NOT deleted
    const branchCheck = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchWithOrderId);
    assert.ok(branchCheck, 'Archived branch must still exist in branches table');
    assert.strictEqual(branchCheck.is_archived, 1, 'is_archived must be 1');

    // Clean up
    db.prepare('DELETE FROM orders WHERE id = ?').run(testOrderId);
    db.prepare('DELETE FROM branches WHERE id = ?').run(branchWithOrderId);
  });

  await t.test('4d. DELETE: Active branch with active orders is rejected (preserves ongoing operations)', async () => {
    // Create an ACTIVE branch with an in-progress order
    const branchActiveId = 'branch_test_active_' + Date.now().toString(36);
    const branchActiveSlug = 'cabang-aktif-' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, whatsapp_number, is_active)
      VALUES (?, 'brand_bangjo', 'Cabang Aktif Dengan Pesanan', ?, 'Jl. Aktif', 0, 0, '081234567801', '081234567801', 1)
    `).run(branchActiveId, branchActiveSlug);

    const activeOrderId = 'ord_active_' + Date.now().toString(36);
    const activeOrderNumber = 'ORD-ACTIVE-' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_method, payment_status)
      VALUES (?, ?, 'brand_bangjo', ?, 'Cust', '081234567801', 'pickup', 'confirmed', 30000, 30000, 'cash', 'pending')
    `).run(activeOrderId, activeOrderNumber, branchActiveId);

    const res = await makeRequest(server, {
      method: 'DELETE',
      path: `/api/v1/admin/branches/${branchActiveId}`,
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    assert.strictEqual(res.status, 400, 'Active branch with active orders must be rejected with 400');
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error && res.body.error.includes('pesanan aktif'), 'Error must mention active orders');

    // Clean up
    db.prepare('DELETE FROM orders WHERE id = ?').run(activeOrderId);
    db.prepare('DELETE FROM branches WHERE id = ?').run(branchActiveId);
  });

  await t.test('Teardown', () => {
    if (server) server.close();
  });
});
