'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../server/database/db');
const DeliveryDispatchService = require('../domains/delivery/services/DeliveryDispatchService');
const DeliveryModel = require('../domains/delivery/models/DeliveryModel');
const PosShiftModel = require('../domains/pos/models/PosShiftModel');

test('POS COD Settlement with Cash Drawer Integration', async (t) => {
  const orgId = 'org_test_' + crypto.randomBytes(4).toString('hex');
  const brandId = 'brand_test_' + crypto.randomBytes(4).toString('hex');
  const branchId = 'branch_test_' + crypto.randomBytes(4).toString('hex');
  const cashierId = 'user_cashier_' + crypto.randomBytes(4).toString('hex');
  const driverId = 'user_driver_' + crypto.randomBytes(4).toString('hex');
  const orderId = 'order_cod_' + crypto.randomBytes(4).toString('hex');
  const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const shiftId = 'shift_pos_' + crypto.randomBytes(4).toString('hex');

  // Seed Org, Brand, Branch, Users
  db.prepare(`
    INSERT INTO organizations (id, name, slug)
    VALUES (?, 'Test Org', ?)
  `).run(orgId, 'org-slug-' + orgId);

  db.prepare(`
    INSERT INTO brands (id, organization_id, name, slug)
    VALUES (?, ?, 'Test Brand', ?)
  `).run(brandId, orgId, 'slug-' + brandId);

  db.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active)
    VALUES (?, ?, 'Test Branch', ?, 'Jl. Raya No. 1', -7.25, 112.75, 1)
  `).run(branchId, brandId, 'slug-' + branchId);

  db.prepare(`
    INSERT INTO users (id, brand_id, branch_id, username, full_name, role, status)
    VALUES (?, ?, ?, 'cashier_test', 'Kasir Siti', 'cashier', 'active')
  `).run(cashierId, brandId, branchId);

  db.prepare(`
    INSERT INTO users (id, brand_id, branch_id, username, full_name, role, status, phone)
    VALUES (?, ?, ?, 'driver_agus', 'Agus Supriyanto', 'driver', 'active', '08123456789')
  `).run(driverId, brandId, branchId);

  // Open POS Shift for Cashier
  const startingFloat = 100000;
  db.prepare(`
    INSERT INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, total_cash_in, total_cash_out, expected_cash, status, opened_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'open', datetime('now'))
  `).run(shiftId, branchId, cashierId, startingFloat, startingFloat);

  // Seed COD Delivery Order: Rp 78.000
  const grandTotal = 78000;
  db.prepare(`
    INSERT INTO orders (id, brand_id, branch_id, order_number, order_type, order_channel, customer_name, customer_phone, payment_method, payment_status, subtotal, grand_total, status)
    VALUES (?, ?, ?, ?, 'delivery', 'pwa', 'Budi Santoso', '081299998888', 'cash', 'pending', 68000, ?, 'out_for_delivery')
  `).run(orderId, brandId, branchId, orderNumber, grandTotal);

  db.prepare(`
    INSERT INTO order_deliveries (
      id, order_id, driver_id, driver_name, driver_phone,
      status, driver_assignment_status, cod_collection_status, cod_cash_custody,
      cod_collected_amount, arrived_at, pod_photo_url
    ) VALUES (
      ?, ?, ?, 'Agus Supriyanto', '08123456789',
      'on_delivery', 'accepted', 'pending', NULL,
      0, datetime('now'), 'https://images.example.com/pod.webp'
    )
  `).run('dlv_' + orderId, orderId, driverId);

  await t.test('1. Driver completes delivery with COD cash collection', () => {
    const res = DeliveryDispatchService.updateStatus({
      order_id: orderId,
      status: DeliveryModel.STATUS.DELIVERED,
      actor_id: driverId,
      cod_amount_tendered: 100000,
      pod_photo_url: 'https://images.example.com/pod.webp'
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'delivered');

    const dlv = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(orderId);
    assert.equal(dlv.status, 'delivered');
    assert.equal(dlv.cod_collection_status, 'collected');
    assert.equal(dlv.cod_cash_custody, 'driver');
    assert.equal(dlv.cod_collected_amount, grandTotal);
    assert.equal(dlv.cod_amount_tendered, 100000);
    assert.equal(dlv.cod_change_given, 22000);
    assert.equal(dlv.pod_photo_url, 'https://images.example.com/pod.webp');
  });

  await t.test('2. Cashier settles COD and verifies atomic cash drawer movement', () => {
    // Record COD handover via DeliveryDispatchService
    const handover = DeliveryDispatchService.recordCodHandover({
      order_id: orderId,
      cashier_id: cashierId,
      branch_id: branchId,
      received_amount: grandTotal
    });

    assert.equal(handover.success, true);
    assert.equal(handover.cod_cash_custody, 'cashier');
    assert.equal(handover.cod_collection_status, 'handed_over');

    // Simulate pos.js financial integration
    const { PosShiftService } = require('../domains/pos');
    const updatedShift = PosShiftService.recordCashMovement({
      shift_id: shiftId,
      type: 'in',
      amount: grandTotal,
      reason: `Setoran COD Kurir: Pesanan #${orderNumber}`,
      actor_id: cashierId,
      actor_role: 'cashier'
    });

    assert.ok(updatedShift);
    assert.equal(Number(updatedShift.total_cash_in), grandTotal);
    assert.equal(Number(updatedShift.expected_cash), startingFloat + grandTotal);

    // Verify database row directly
    const shiftInDb = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shiftId);
    assert.equal(Number(shiftInDb.total_cash_in), grandTotal);
    assert.equal(Number(shiftInDb.expected_cash), 178000);

    const movement = db.prepare('SELECT * FROM pos_cash_movements WHERE shift_id = ?').get(shiftId);
    assert.equal(movement.type, 'in');
    assert.equal(Number(movement.amount), grandTotal);
    assert.ok(movement.reason.includes(orderNumber));
  });

  await t.test('3. Idempotent call does not double count cash movement', () => {
    const handoverRetry = DeliveryDispatchService.recordCodHandover({
      order_id: orderId,
      cashier_id: cashierId,
      branch_id: branchId,
      received_amount: grandTotal
    });

    assert.equal(handoverRetry.success, true);
    assert.equal(handoverRetry.idempotent, true);

    // Movements count should still be exactly 1
    const movements = db.prepare('SELECT COUNT(*) as count FROM pos_cash_movements WHERE shift_id = ?').get(shiftId);
    assert.equal(movements.count, 1);
  });

  await t.test('4. POS QR lookup route resolves order by order_number and QR pattern', async () => {
    const express = require('express');
    const registerPosRoutes = require('../server/routes/pos');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.brand_id = brandId;
      req.user = { id: cashierId, role: 'cashier', branch_id: branchId };
      next();
    });

    const mockAuth = () => (req, res, next) => next();
    registerPosRoutes(app, {
      db,
      requireAuth: mockAuth,
      TokenSessionStore: { getSession: () => null }
    });

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // Lookup by raw order_number
      const res1 = await fetch(`http://127.0.0.1:${port}/pos/delivery/lookup-by-qr?code=${orderNumber}`);
      const data1 = await res1.json();
      assert.equal(res1.status, 200);
      assert.equal(data1.success, true);
      assert.equal(data1.order.order_number, orderNumber);
      assert.equal(data1.order.grand_total, grandTotal);
      assert.equal(data1.delivery.driver_name, 'Agus Supriyanto');

      // Lookup by QR URL scheme
      const qrUrl = encodeURIComponent(`xentra://delivery/settle?order_number=${orderNumber}&amount=${grandTotal}`);
      const res2 = await fetch(`http://127.0.0.1:${port}/pos/delivery/lookup-by-qr?code=${qrUrl}`);
      const data2 = await res2.json();
      assert.equal(res2.status, 200);
      assert.equal(data2.success, true);
      assert.equal(data2.order.order_number, orderNumber);
    } finally {
      server.close();
    }
  });
});
