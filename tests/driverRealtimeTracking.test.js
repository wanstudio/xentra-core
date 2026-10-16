'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/database/db');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('DRIVER-REALTIME-01: Database tables for driver_locations and driver_location_logs exist with correct schema', () => {
  const locTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='driver_locations'").get();
  assert.ok(locTable, 'driver_locations table must exist');
  assert.match(locTable.sql, /driver_id/);
  assert.match(locTable.sql, /latitude/);
  assert.match(locTable.sql, /longitude/);
  assert.match(locTable.sql, /is_online/);
  assert.match(locTable.sql, /active_order_id/);

  const logTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='driver_location_logs'").get();
  assert.ok(logTable, 'driver_location_logs table must exist');
  assert.match(logTable.sql, /order_id/);
  assert.match(logTable.sql, /accuracy/);
  assert.match(logTable.sql, /heading/);
  assert.match(logTable.sql, /speed/);
  assert.match(logTable.sql, /is_mock/);
});

test('DRIVER-REALTIME-02: Driver availability and location endpoints are registered in server/routes/driver.js', () => {
  const src = read('server/routes/driver.js');
  assert.match(src, /router\.get\('\/driver\/availability'/);
  assert.match(src, /router\.post\('\/driver\/availability'/);
  assert.match(src, /router\.post\('\/driver\/location'/);
  assert.match(src, /router\.get\('\/driver\/location'/);
  assert.match(src, /INVALID_COORDINATES/);
  assert.match(src, /driver_location_logs/);
});

test('DRIVER-REALTIME-03: Driver App UI integrates live availability toggle and driverLocationService', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');
  assert.match(ui, /driverLocationService/);
  assert.match(ui, /ONLINE \(Siap Antar\)/);
  assert.match(ui, /OFFLINE \(Istirahat\)/);
  assert.match(ui, /toggle-availability/);
  assert.match(ui, /\/driver\/location/);
  assert.match(ui, /\/driver\/availability/);
  assert.match(ui, /google\.navigation:q=/);
});

test('DRIVER-REALTIME-04: Customer live tracking endpoint is registered in server/routes/customer-orders.js', () => {
  const src = read('server/routes/customer-orders.js');
  assert.match(src, /\/customer\/orders\/:orderNumber\/live-tracking/);
  assert.match(src, /driver_locations/);
  assert.match(src, /driver_location:/);
});

test('DRIVER-REALTIME-05: Database operations on driver_locations and driver_location_logs succeed', () => {
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get();
  assert.ok(brand, 'At least one brand must exist');

  let driver = db.prepare("SELECT id, branch_id FROM users WHERE role = 'driver' LIMIT 1").get();
  if (!driver) {
    const testDriverId = 'usr_driver_test_' + Date.now();
    db.prepare(`
      INSERT INTO users (id, username, email, full_name, role, status, brand_id, organization_id, created_at, updated_at)
      VALUES (?, 'driver_test', 'driver_test@test.local', 'Driver Test', 'driver', 'active', ?, 'org_default', datetime('now'), datetime('now'))
    `).run(testDriverId, brand.id);
    driver = { id: testDriverId, branch_id: null };
  }

  // 1. Availability toggle
  db.prepare(`
    INSERT INTO driver_locations (driver_id, brand_id, branch_id, is_online, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(driver_id) DO UPDATE SET is_online = 1, updated_at = datetime('now')
  `).run(driver.id, brand.id, driver.branch_id);

  let rec = db.prepare('SELECT is_online FROM driver_locations WHERE driver_id = ?').get(driver.id);
  assert.strictEqual(rec.is_online, 1, 'Driver should be online');

  // 2. Realtime Location Upsert
  db.prepare(`
    INSERT INTO driver_locations (
      driver_id, brand_id, branch_id, is_online, latitude, longitude,
      accuracy, heading, speed, battery_level, is_mock, updated_at
    ) VALUES (?, ?, ?, 1, -7.2575, 112.7521, 8.5, 180, 25.4, 85, 0, datetime('now'))
    ON CONFLICT(driver_id) DO UPDATE SET
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      heading = excluded.heading,
      speed = excluded.speed,
      battery_level = excluded.battery_level,
      is_mock = excluded.is_mock,
      updated_at = datetime('now')
  `).run(driver.id, brand.id, driver.branch_id);

  rec = db.prepare('SELECT latitude, longitude, speed, battery_level FROM driver_locations WHERE driver_id = ?').get(driver.id);
  assert.strictEqual(rec.latitude, -7.2575);
  assert.strictEqual(rec.longitude, 112.7521);
  assert.strictEqual(rec.speed, 25.4);
  assert.strictEqual(rec.battery_level, 85);

  // 3. Location logs breadcrumb
  const existingOrder = db.prepare('SELECT id FROM orders LIMIT 1').get();
  const testOrderId = existingOrder ? existingOrder.id : null;
  const logId = 'dll_test_' + Date.now();
  db.prepare(`
    INSERT INTO driver_location_logs (
      id, driver_id, order_id, latitude, longitude,
      accuracy, heading, speed, is_mock, battery_level, created_at
    ) VALUES (?, ?, ?, -7.2575, 112.7521, 8.5, 180, 25.4, 0, 85, datetime('now'))
  `).run(logId, driver.id, testOrderId);

  const logRec = db.prepare('SELECT order_id, latitude, longitude FROM driver_location_logs WHERE id = ?').get(logId);
  assert.strictEqual(logRec.order_id, testOrderId);
  assert.strictEqual(logRec.latitude, -7.2575);

  // Cleanup test log
  db.prepare('DELETE FROM driver_location_logs WHERE id = ?').run(logId);
});
