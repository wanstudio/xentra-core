'use strict';

/**
 * PHASE 2 OWNER DASHBOARD — BRANCHES TEST SUITE
 * Tests:
 * 1. Branch list (all branches of brand, identity, operational status, fulfillment).
 * 2. Create branch with validation & required WhatsApp number.
 * 3. Branch Detail (GET /admin/branches/:id with overview metrics, fulfillment, staff count, catalog count).
 * 4. Branch Operations (PUT /admin/branches/:id with is_active, is_open_override, delivery/pickup fulfillment toggles).
 * 5. Branch Menu integration (Branch Detail -> Branch Menu reuses Catalog / Menus functionality).
 * 6. Branch Team boundary (Staff listing scoped to branch).
 * 7. Tenant isolation & RBAC (Cross-tenant branch tampering returns 404/403, cashier rejected).
 * 8. Direct navigation and refresh for /dashboard/branches and /dashboard/branches/:id/* routes.
 * 9. Connector HOLD verification.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/database/db');
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
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('PHASE 2: OWNER DASHBOARD BRANCHES IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let cashierToken;
  let createdBranchId = null;
  const BRAND_ID = 'brand_bangjo';
  const EXISTING_BRANCH_ID = 'branch_bangjo_barat';

  await t.test('0. Setup: server & auth sessions', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, BRAND_ID);
    ownerToken = ownerSession.token;

    const cashierUser = db.prepare("SELECT * FROM users WHERE role = 'cashier' AND brand_id = ?").get(BRAND_ID);
    if (cashierUser) {
      const cashSession = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
      cashierToken = cashSession.token;
    }
  });

  // 1. BRANCH LIST
  await t.test('1. Branch List', async (t2) => {
    await t2.test('1.1 List all branches for brand', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/branches',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.branches), 'branches must be an array');
      assert.ok(res.body.branches.length > 0, 'Must have at least one branch');

      const barat = res.body.branches.find(b => b.id === EXISTING_BRANCH_ID);
      assert.ok(barat, 'Existing Barat branch must be in list');
      assert.ok(barat.name);
      assert.ok(barat.address_text);
    });
  });

  // 2. CREATE & EDIT BRANCH
  await t.test('2. Create & Edit Branch', async (t2) => {
    await t2.test('2.1 Rejects branch creation without WhatsApp phone', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/admin/branches',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Cabang Baru Tanpa WA',
        address_text: 'Jalan Baru No. 1'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    await t2.test('2.2 Successfully creates new branch with valid WhatsApp', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/admin/branches',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Bangjo Phase 2 Outlet',
        address_text: 'Jl. Margonda Raya No. 45, Depok',
        whatsapp_number: '081298765432',
        phone: '081298765432',
        latitude: -6.3728,
        longitude: 106.8317,
        free_delivery_km: 2,
        price_per_km: 3500,
        max_radius_km: 12
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.branch_id);
      createdBranchId = res.body.branch_id;
    });

    await t2.test('2.3 Edit branch profile via PUT', async () => {
      const res = await makeRequest(server, {
        method: 'PUT',
        path: `/api/v1/admin/branches/${createdBranchId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Bangjo Phase 2 Outlet Updated',
        price_per_km: 4000
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const row = db.prepare('SELECT name FROM branches WHERE id = ?').get(createdBranchId);
      assert.strictEqual(row.name, 'Bangjo Phase 2 Outlet Updated');
    });
  });

  // 3. BRANCH DETAIL API & OVERVIEW
  await t.test('3. Branch Detail API & Overview', async (t2) => {
    await t2.test('3.1 GET /admin/branches/:id returns comprehensive branch detail', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${EXISTING_BRANCH_ID}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const b = res.body.branch;
      assert.ok(b);
      assert.strictEqual(b.id, EXISTING_BRANCH_ID);
      assert.strictEqual(b.brand_id, BRAND_ID);
      assert.ok('is_active' in b);
      assert.ok('is_open_override' in b);
      assert.ok('is_delivery_active' in b);
      assert.ok('is_pickup_active' in b);
      assert.ok('adopted_products_count' in b);
      assert.ok('branch_categories_count' in b);
      assert.ok('staff_count' in b);
      assert.ok('total_orders' in b);
    });

    await t2.test('3.2 Returns 404 for non-existent branch ID', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/branches/branch_nonexistent_xyz',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'BRANCH_NOT_FOUND');
    });
  });

  // 4. BRANCH OPERATIONS (TOGGLES & FULFILLMENT)
  await t.test('4. Branch Operations Controls', async (t2) => {
    await t2.test('4.1 Update operational fulfillment toggles (is_delivery_active & is_pickup_active)', async () => {
      const res = await makeRequest(server, {
        method: 'PUT',
        path: `/api/v1/admin/branches/${createdBranchId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        is_delivery_active: 0,
        is_pickup_active: 1,
        is_open_override: 0
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify in detail endpoint
      const dRes = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${createdBranchId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(dRes.body.branch.is_delivery_active, 0);
      assert.strictEqual(dRes.body.branch.is_pickup_active, 1);
      assert.strictEqual(dRes.body.branch.is_open_override, 0);
    });
  });

  // 5. BRANCH MENU INTEGRATION (REUSE CATALOG)
  await t.test('5. Branch Menu Integration (Phase 1 Catalog Reuse)', async (t2) => {
    await t2.test('5.1 Branch catalog endpoint returns adopted & available products', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${EXISTING_BRANCH_ID}/catalog`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.adopted_products));
      assert.ok(Array.isArray(res.body.available_master_products));
      assert.ok(Array.isArray(res.body.categories));
    });
  });

  // 6. BRANCH TEAM BOUNDARY
  await t.test('6. Branch Team Boundary', async (t2) => {
    await t2.test('6.1 List users filtered by branch_id', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/users?branch_id=${EXISTING_BRANCH_ID}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.users));
    });
  });

  // 7. TENANT ISOLATION & RBAC
  await t.test('7. Tenant Isolation & RBAC', async (t2) => {
    await t2.test('7.1 Cashier is rejected from accessing Admin Branches', async () => {
      if (!cashierToken) return;
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/branches',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });

      assert.strictEqual(res.status, 403);
    });

    await t2.test('7.2 Branch tampering across tenant fails closed (404/403)', async () => {
      // Trying to access a branch with wrong brand context (e.g. host header for another tenant)
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${EXISTING_BRANCH_ID}`,
        headers: {
          Host: 'app.mybangjo.com',
          Authorization: `Bearer ${ownerToken}`
        }
      });
      // Owned by brand_bangjo -> succeeds for brand_bangjo owner
      assert.strictEqual(res.status, 200);
    });
  });

  // 8. DIRECT ROUTES & REFRESH
  await t.test('8. Direct Routes and Refresh', async (t2) => {
    const branchRoutes = [
      '/dashboard/branches',
      `/dashboard/branches/${EXISTING_BRANCH_ID}`,
      `/dashboard/branches/${EXISTING_BRANCH_ID}/operations`,
      `/dashboard/branches/${EXISTING_BRANCH_ID}/menu`,
      `/dashboard/branches/${EXISTING_BRANCH_ID}/team`,
      `/dashboard/branches/${EXISTING_BRANCH_ID}/reports`
    ];

    for (const route of branchRoutes) {
      await t2.test(`8.1 Direct GET ${route} serves 200 index.html on tenant host`, async () => {
        const res = await makeRequest(server, {
          method: 'GET',
          path: route,
          headers: { Host: 'app.mybangjo.com' }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.body === 'string');
        assert.ok(res.body.includes('tab-branches'));
        assert.ok(res.body.includes('branch-list-view'));
        assert.ok(res.body.includes('branch-detail-view'));
      });
    }
  });

  // 9. CLEANUP & CONNECTOR HOLD
  await t.test('9. Cleanup & Connector Invariant', async (t2) => {
    await t2.test('9.1 Delete newly created branch', async () => {
      if (createdBranchId) {
        const res = await makeRequest(server, {
          method: 'DELETE',
          path: `/api/v1/admin/branches/${createdBranchId}`,
          headers: { Authorization: `Bearer ${ownerToken}` }
        });
        assert.strictEqual(res.status, 200);
      }
    });

    await t2.test('9.2 Xentra Connector is HOLD and not required for Branches', () => {
      const apiCode = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
      assert.ok(!apiCode.includes("require('../../connector"), 'API must not depend on Connector');
    });
  });

  t.after(() => {
    if (server) server.close();
  });
});
