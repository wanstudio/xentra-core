'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../server/database/db');
const DeliveryDispatchService = require('../domains/delivery/services/DeliveryDispatchService');
const DeliveryModel = require('../domains/delivery/models/DeliveryModel');

test('Cross-Surface Delivery Workflow: Auto-Dispatch, In-App Chat, POD Gatekeeper & Owner Custody', async (t) => {
  const orgId = 'org_cs_' + crypto.randomBytes(4).toString('hex');
  const brandId = 'brand_cs_' + crypto.randomBytes(4).toString('hex');
  const branchId = 'branch_cs_' + crypto.randomBytes(4).toString('hex');
  const driverAId = 'drv_a_' + crypto.randomBytes(4).toString('hex');
  const driverBId = 'drv_b_' + crypto.randomBytes(4).toString('hex');
  const order1Id = 'ord_cs1_' + crypto.randomBytes(4).toString('hex');
  const order2Id = 'ord_cs2_' + crypto.randomBytes(4).toString('hex');
  const order3Id = 'ord_cs3_' + crypto.randomBytes(4).toString('hex');

  // 1. Seed Organization, Brand, Branch with Hybrid Dispatch Settings
  db.prepare(`
    INSERT INTO organizations (id, name, slug)
    VALUES (?, 'Cross Surface Org', ?)
  `).run(orgId, 'org-cs-' + orgId);

  db.prepare(`
    INSERT INTO brands (id, organization_id, name, slug)
    VALUES (?, ?, 'Cross Surface Brand', ?)
  `).run(brandId, orgId, 'brand-cs-' + brandId);

  db.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active)
    VALUES (?, ?, 'Cabang Delivery Pusat', ?, 'Jl. Merdeka 10', -7.26, 112.74, 1)
  `).run(branchId, brandId, 'branch-cs-' + branchId);

  db.prepare(`
    INSERT OR REPLACE INTO branch_delivery_settings (
      id, branch_id, is_delivery_active, dispatch_mode, auto_dispatch_timeout_seconds
    ) VALUES (?, ?, 1, 'hybrid', 120)
  `).run('bds_' + branchId, branchId);

  // 2. Seed Drivers: Driver A (online, has 1 busy task), Driver B (online, 0 busy tasks)
  db.prepare(`
    INSERT INTO users (id, brand_id, branch_id, username, full_name, role, status, phone)
    VALUES (?, ?, ?, 'driver_a', 'Driver A (Busy)', 'driver', 'active', '0811111111')
  `).run(driverAId, brandId, branchId);

  db.prepare(`
    INSERT INTO users (id, brand_id, branch_id, username, full_name, role, status, phone)
    VALUES (?, ?, ?, 'driver_b', 'Driver B (Idle)', 'driver', 'active', '0822222222')
  `).run(driverBId, brandId, branchId);

  // Mark both online
  db.prepare(`
    INSERT OR REPLACE INTO driver_locations (driver_id, brand_id, branch_id, is_online, latitude, longitude, updated_at)
    VALUES (?, ?, ?, 1, -7.2601, 112.7401, datetime('now'))
  `).run(driverAId, brandId, branchId);

  db.prepare(`
    INSERT OR REPLACE INTO driver_locations (driver_id, brand_id, branch_id, is_online, latitude, longitude, updated_at)
    VALUES (?, ?, ?, 1, -7.2605, 112.7405, datetime('now'))
  `).run(driverBId, brandId, branchId);

  // Give Driver A an active task
  db.prepare(`
    INSERT INTO orders (id, brand_id, branch_id, order_number, order_type, customer_name, customer_phone, payment_method, payment_status, subtotal, grand_total, status)
    VALUES (?, ?, ?, 'ORD-A-BUSY', 'delivery', 'Budi Hartono', '08999', 'cash', 'pending', 50000, 50000, 'preparing')
  `).run(order1Id, brandId, branchId);

  db.prepare(`
    INSERT INTO order_deliveries (id, order_id, driver_id, driver_name, driver_phone, status, driver_assignment_status)
    VALUES (?, ?, ?, 'Driver A (Busy)', '0811111111', 'assigned', 'accepted')
  `).run('dlv_' + order1Id, order1Id, driverAId);

  await t.test('1. DeliveryDispatchService.findBestAvailableDriver picks Driver B (lowest active tasks)', () => {
    const best = DeliveryDispatchService.findBestAvailableDriver(branchId);
    assert.ok(best, 'Driver online harus ditemukan');
    assert.equal(best.id, driverBId, 'Harus memilih Driver B karena memiliki 0 tugas aktif vs Driver A yang punya 1');
    assert.equal(Number(best.active_task_count), 0);
  });

  await t.test('2. DeliveryDispatchService.autoAssign assigns order to Driver B and publishes auto-dispatch event', () => {
    // Seed Order 2 (ready for delivery)
    db.prepare(`
      INSERT INTO orders (id, brand_id, branch_id, order_number, order_type, customer_name, customer_phone, payment_method, payment_status, subtotal, grand_total, status)
      VALUES (?, ?, ?, 'ORD-AUTO-01', 'delivery', 'Dewi Lestari', '087777777', 'cash', 'pending', 75000, 75000, 'ready')
    `).run(order2Id, brandId, branchId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, status)
      VALUES (?, ?, 'unassigned')
    `).run('dlv_' + order2Id, order2Id);

    const result = DeliveryDispatchService.autoAssign({ order_id: order2Id, branch_id: branchId });
    assert.equal(result.success, true);
    assert.equal(result.mode, 'hybrid');
    assert.equal(result.driver.id, driverBId);

    const deliveryRow = db.prepare('SELECT driver_id, status, driver_assignment_status FROM order_deliveries WHERE order_id = ?').get(order2Id);
    assert.equal(deliveryRow.driver_id, driverBId);
    assert.equal(deliveryRow.status, 'assigned');
    assert.equal(deliveryRow.driver_assignment_status, 'pending');
  });

  await t.test('3. checkHybridTimeouts detects expired assignment and reverts to unassigned with BM fallback', () => {
    // Simulate Driver B timed out (updated_at set to 180 seconds ago)
    db.prepare(`
      UPDATE order_deliveries
      SET updated_at = datetime('now', '-180 seconds')
      WHERE order_id = ?
    `).run(order2Id);

    const timedOut = DeliveryDispatchService.checkHybridTimeouts({ branch_id: branchId });
    assert.ok(Array.isArray(timedOut));
    assert.equal(timedOut.length, 1);
    assert.equal(timedOut[0].order_id, order2Id);

    const deliveryRow = db.prepare('SELECT status, driver_assignment_status, driver_assignment_rejection_reason FROM order_deliveries WHERE order_id = ?').get(order2Id);
    assert.equal(deliveryRow.status, 'unassigned', 'Status delivery harus kembali ke unassigned untuk dipilih manual oleh BM');
    assert.equal(deliveryRow.driver_assignment_status, 'timed_out');
    assert.equal(deliveryRow.driver_assignment_rejection_reason, 'AUTO_DISPATCH_TIMEOUT');
  });

  await t.test('4. In-App Chat Kurir ↔ Customer synchronizes via ops_messages with thread_type = delivery', () => {
    // Customer sends message
    const custMsgId = 'msg_c_' + crypto.randomBytes(4).toString('hex');
    db.prepare(`
      INSERT INTO ops_messages (
        id, brand_id, branch_id, thread_type, thread_ref_id,
        sender_user_id, sender_role, sender_name, target_role, body, created_at
      ) VALUES (?, ?, ?, 'delivery', ?, 'customer:087777777', 'customer', 'Bu Dewi', 'driver', 'Pak, saya di lantai 2 ya', datetime('now'))
    `).run(custMsgId, brandId, branchId, order2Id);

    // Driver sends reply
    const drvMsgId = 'msg_d_' + crypto.randomBytes(4).toString('hex');
    db.prepare(`
      INSERT INTO ops_messages (
        id, brand_id, branch_id, thread_type, thread_ref_id,
        sender_user_id, sender_role, sender_name, target_role, body, created_at
      ) VALUES (?, ?, ?, 'delivery', ?, ?, 'driver', 'Driver B (Idle)', 'customer', 'Siap Bu Dewi, sebentar lagi sampai', datetime('now'))
    `).run(drvMsgId, brandId, branchId, order2Id, driverBId);

    const messages = db.prepare(`
      SELECT sender_role, sender_name, body FROM ops_messages
      WHERE brand_id = ? AND thread_type = 'delivery' AND thread_ref_id = ?
      ORDER BY datetime(created_at) ASC
    `).all(brandId, order2Id);

    assert.equal(messages.length, 2);
    assert.equal(messages[0].sender_role, 'customer');
    assert.equal(messages[0].body, 'Pak, saya di lantai 2 ya');
    assert.equal(messages[1].sender_role, 'driver');
    assert.equal(messages[1].body, 'Siap Bu Dewi, sebentar lagi sampai');
  });

  await t.test('5. Photo POD Gatekeeper: Delivery completion blocked without photo or bypass reason', () => {
    // Re-assign order 2 to driver B and advance to on_delivery
    DeliveryDispatchService.assign({
      order_id: order2Id,
      driver_id: driverBId,
      driver_name: 'Driver B',
      driver_phone: '0822222222'
    });
    DeliveryDispatchService.acceptAssignment({ order_id: order2Id, actor_id: driverBId });
    DeliveryDispatchService.updateStatus({ order_id: order2Id, status: 'picked_up', actor_id: driverBId });
    DeliveryDispatchService.updateStatus({ order_id: order2Id, status: 'on_delivery', actor_id: driverBId });

    // Attempt completion with NO photo and NO bypass reason
    assert.throws(() => {
      DeliveryDispatchService.updateStatus({
        order_id: order2Id,
        status: DeliveryModel.STATUS.DELIVERED,
        actor_id: driverBId,
        cod_amount_tendered: 75000
        // missing pod_photo_url & pod_bypass_reason
      });
    }, /\[POD_PHOTO_OR_BYPASS_REQUIRED\]/);
  });

  await t.test('6. Photo POD Bypass: Successfully completes with bypass reason and logs audit', () => {
    const bypassReason = 'Pelanggan meminta tidak difoto (privasi)';
    const result = DeliveryDispatchService.updateStatus({
      order_id: order2Id,
      status: DeliveryModel.STATUS.DELIVERED,
      actor_id: driverBId,
      cod_amount_tendered: 75000,
      pod_bypass_reason: bypassReason,
      pod_note: 'Diterima oleh petugas satpam pos depan'
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'delivered');

    const deliveryRow = db.prepare('SELECT status, pod_bypass_reason, pod_note FROM order_deliveries WHERE order_id = ?').get(order2Id);
    assert.equal(deliveryRow.status, 'delivered');
    assert.equal(deliveryRow.pod_bypass_reason, bypassReason);
    assert.equal(deliveryRow.pod_note, 'Diterima oleh petugas satpam pos depan');
  });

  await t.test('7. Owner COD Custody: Driver holds COD cash until cashier handover', () => {
    // Query custody liability
    const collectedRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN od.status = 'delivered' THEN COALESCE(od.cod_collected_amount, o.grand_total) ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN od.cod_collection_status = 'handed_over' THEN COALESCE(od.cod_collected_amount, o.grand_total) ELSE 0 END), 0) AS total_handed_over
      FROM orders o
      JOIN order_deliveries od ON od.order_id = o.id
      WHERE o.brand_id = ? AND o.payment_method = 'cash' AND o.order_type = 'delivery'
    `).get(brandId);

    const totalCollected = Number(collectedRow.total_collected);
    const totalHandedOver = Number(collectedRow.total_handed_over);
    const inCustody = totalCollected - totalHandedOver;

    assert.equal(totalCollected, 75000);
    assert.equal(totalHandedOver, 0);
    assert.equal(inCustody, 75000, 'Uang COD Rp 75.000 harus tercatat dalam penguasaan (custody) kurir');

    // Check driver breakdown
    const driverCustody = db.prepare(`
      SELECT od.driver_id, od.driver_name, SUM(COALESCE(od.cod_collected_amount, o.grand_total)) AS held_amount
      FROM orders o
      JOIN order_deliveries od ON od.order_id = o.id
      WHERE o.brand_id = ? AND o.payment_method = 'cash' AND o.order_type = 'delivery'
        AND od.status = 'delivered' AND od.cod_collection_status != 'handed_over'
      GROUP BY od.driver_id
    `).all(brandId);

    assert.equal(driverCustody.length, 1);
    assert.equal(driverCustody[0].driver_id, driverBId);
    assert.equal(Number(driverCustody[0].held_amount), 75000);

    // Check POD bypass logs
    const bypassLogs = db.prepare(`
      SELECT o.order_number, od.pod_bypass_reason
      FROM orders o
      JOIN order_deliveries od ON od.order_id = o.id
      WHERE o.brand_id = ? AND od.pod_bypass_reason IS NOT NULL
    `).all(brandId);

    assert.equal(bypassLogs.length, 1);
    assert.equal(bypassLogs[0].order_number, 'ORD-AUTO-01');
    assert.equal(bypassLogs[0].pod_bypass_reason, 'Pelanggan meminta tidak difoto (privasi)');
  });

  await t.test('8. Return to Store (RTS) Exception Flow: Driver reports issue, order cancelled, COD liability cleared', () => {
    const order4Id = 'ord_rts_' + Math.random().toString(36).substring(2, 9);
    db.prepare(`
      INSERT INTO orders (id, brand_id, branch_id, order_number, order_type, customer_name, customer_phone, payment_method, payment_status, subtotal, grand_total, status)
      VALUES (?, ?, ?, 'ORD-RTS-01', 'delivery', 'Eko Prasetyo', '085555555', 'cash', 'pending', 60000, 60000, 'ready')
    `).run(order4Id, brandId, branchId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, driver_id, driver_name, driver_phone, status, driver_assignment_status)
      VALUES (?, ?, ?, 'Driver B (Idle)', '0822222222', 'assigned', 'accepted')
    `).run('dlv_' + order4Id, order4Id, driverBId);

    // Driver picks up and starts delivery
    DeliveryDispatchService.updateStatus({
      order_id: order4Id,
      status: DeliveryModel.STATUS.PICKED_UP,
      actor_id: driverBId
    });
    DeliveryDispatchService.updateStatus({
      order_id: order4Id,
      status: DeliveryModel.STATUS.ON_DELIVERY,
      actor_id: driverBId
    });

    // Driver reports delivery failed / customer unreachable
    const failReason = 'Pelanggan Tidak Dapat Dihubungi (>10 Menit)';
    const result = DeliveryDispatchService.updateStatus({
      order_id: order4Id,
      status: DeliveryModel.STATUS.FAILED,
      actor_id: driverBId,
      notes: failReason
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'failed');

    const orderRow = db.prepare('SELECT status FROM orders WHERE id = ?').get(order4Id);
    assert.equal(orderRow.status, 'cancelled', 'Order status harus cancelled saat gagal antar');

    const deliveryRow = db.prepare('SELECT status, cod_collection_status, cod_cash_custody, pod_note FROM order_deliveries WHERE order_id = ?').get(order4Id);
    assert.equal(deliveryRow.status, 'failed');
    assert.equal(deliveryRow.cod_collection_status, 'cancelled');
    assert.equal(deliveryRow.cod_cash_custody, 'none', 'Kewajiban kas COD kurir harus dibebaskan (none)');
    assert.equal(deliveryRow.pod_note, failReason);
  });

  // Cleanup test data
  t.after(() => {
    try {
      db.prepare('DELETE FROM ops_messages WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM order_deliveries WHERE order_id IN (?, ?, ?)').run(order1Id, order2Id, order3Id);
      db.prepare('DELETE FROM orders WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM driver_locations WHERE driver_id IN (?, ?)').run(driverAId, driverBId);
      db.prepare('DELETE FROM users WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM branch_delivery_settings WHERE branch_id = ?').run(branchId);
      db.prepare('DELETE FROM branches WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);
    } catch (_) {}
  });
});
