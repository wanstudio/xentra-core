'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const db = require('../server/database/db');
const registerOperationalOrderRoutes = require('../server/routes/operational-orders');

test('Branch Manager Delivery Dispatch API suite', async (t) => {
  const brandId = 'brand_test_dispatch';
  const orgId = 'org_test_dispatch';
  const branchId = 'branch_test_dispatch';
  const otherBranchId = 'branch_other_dispatch';

  // Seed baseline data
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)`).run(orgId, 'Org Dispatch', 'org-dispatch');
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)`).run(brandId, orgId, 'Brand Dispatch', 'brand-dispatch');
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    branchId, brandId, 'Branch Dispatch 1', 'branch-dispatch-1', 'Jl. Test 1', -7.25, 112.75
  );
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    otherBranchId, brandId, 'Branch Dispatch 2', 'branch-dispatch-2', 'Jl. Test 2', -7.26, 112.76
  );

  // Seed drivers
  const driverId = 'user_driver_branch_1';
  db.prepare(`INSERT OR REPLACE INTO users (id, username, full_name, phone, role, status, brand_id, organization_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    driverId, 'driver1', 'Driver Satu', '08123456789', 'driver', 'active', brandId, orgId, branchId
  );

  const driver2Id = 'user_driver_branch_2';
  db.prepare(`INSERT OR REPLACE INTO users (id, username, full_name, phone, role, status, brand_id, organization_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    driver2Id, 'driver2', 'Driver Dua', '08129876543', 'driver', 'active', brandId, orgId, otherBranchId
  );

  // Setup express test app
  let currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.brand_id = brandId;
    req.brand = { id: brandId, organization_id: orgId };
    next();
  });

  const mockRequireAuth = (allowedRoles) => (req, res, next) => {
    req.user = currentUser;
    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Unauthorized role' });
    }
    next();
  };

  registerOperationalOrderRoutes(app, {
    db,
    requireAuth: mockRequireAuth,
    OrderStateMachine: require('../server/services/OrderStateMachine'),
    AcceptanceTimeoutService: {}
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  async function apiCall(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  await t.test('GET /admin/branches/:branchId/drivers returns branch drivers', async () => {
    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('GET', `/admin/branches/${branchId}/drivers`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(Array.isArray(res.body.drivers), true);
    assert.strictEqual(res.body.drivers.length, 1);
    assert.strictEqual(res.body.drivers[0].id, driverId);
    assert.strictEqual(res.body.drivers[0].name, 'Driver Satu');
  });

  await t.test('GET /admin/branches/:branchId/drivers enforces branch scope', async () => {
    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('GET', `/admin/branches/${otherBranchId}/drivers`);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('POST /admin/orders/:id/assign-driver assigns driver when status is ready', async () => {
    const orderId = 'order_test_delivery_1';
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, brandId, branchId, 'DEL-001', 'Budi', '0812345678', 'delivery', 'ready', 50000, 50000, 'paid', 'qris');

    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('POST', `/admin/orders/${orderId}/assign-driver`, {
      driver_id: driverId
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.delivery.driver_id, driverId);
    assert.strictEqual(res.body.delivery.status, 'assigned');
    assert.strictEqual(res.body.delivery.driver_assignment_status, 'pending');
  });

  await t.test('POST /admin/orders/:id/assign-driver rejects assignment if order is not ready', async () => {
    const orderId = 'order_test_delivery_preparing';
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, brandId, branchId, 'DEL-002', 'Budi', '0812345678', 'delivery', 'preparing', 50000, 50000, 'paid', 'qris');

    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('POST', `/admin/orders/${orderId}/assign-driver`, {
      driver_id: driverId
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /ready/i);
  });

  await t.test('POST /admin/orders/:id/assign-driver rejects driver from another branch', async () => {
    const orderId = 'order_test_delivery_ready_2';
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, brandId, branchId, 'DEL-003', 'Budi', '0812345678', 'delivery', 'ready', 50000, 50000, 'paid', 'qris');

    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('POST', `/admin/orders/${orderId}/assign-driver`, {
      driver_id: driver2Id // From other branch
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /cabang yang sama/i);
  });

  await t.test('POST /admin/orders/:id/assign-driver allows assigning active branch driver even when phone is empty in DB', async () => {
    const noPhoneDriverId = 'user_driver_no_phone';
    db.prepare(`INSERT OR REPLACE INTO users (id, username, full_name, phone, role, status, brand_id, organization_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      noPhoneDriverId, 'driver_nophone', 'Agus Kurir', null, 'driver', 'active', brandId, orgId, branchId
    );

    const orderId = 'order_test_delivery_no_phone_driver';
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, brandId, branchId, 'DEL-004', 'Sari', '0812345678', 'delivery', 'ready', 45000, 45000, 'paid', 'qris');

    currentUser = { id: 'bm_user_1', role: 'branch_manager', branchId: branchId };
    const res = await apiCall('POST', `/admin/orders/${orderId}/assign-driver`, {
      driver_id: noPhoneDriverId
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.delivery.driver_id, noPhoneDriverId);
    assert.strictEqual(res.body.delivery.driver_name, 'Agus Kurir');
    assert.strictEqual(res.body.delivery.status, 'assigned');
  });
});
