'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReportingEngine } = require('../domains/reporting');
const { createAffiliateService } = require('../domains/affiliate');
const DataAccess = require('../core/data/DataAccess');

test('AFFILIATE REPORTING DOMAIN SUITE', async (t) => {
  const brandId = 'brand_rep_test_' + Date.now();
  const affService = createAffiliateService();
  affService.ensureSchema();

  // Seed customer, affiliate profile, orders, order items and conversions
  const customerId = 'cust_rep_' + Date.now();
  DataAccess.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug)
    VALUES ('org_test', 'Org Test', 'org-test')
  `).run();

  DataAccess.prepare(`
    INSERT OR IGNORE INTO brands (id, organization_id, name, slug)
    VALUES (?, 'org_test', 'Test Brand', ?)
  `).run(brandId, 'slug-' + brandId);

  DataAccess.prepare(`
    INSERT INTO customers (id, organization_id, brand_id, display_name, phone)
    VALUES (?, 'org_test', ?, 'Budi Santoso', '08123456789')
  `).run(customerId, brandId);

  const profile = await affService.getOrCreateProfile({
    brandId,
    customerId,
    customerName: 'Budi Santoso',
    customerPhone: '08123456789'
  });

  const branchId = 'br_rep_' + Date.now();
  DataAccess.prepare(`
    INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active)
    VALUES (?, ?, 'Branch Rep', 'branch-rep', 'Jl. Test', 0, 0, 1)
  `).run(branchId, brandId);

  const orderId1 = 'ord_rep_1_' + Date.now();
  const orderId2 = 'ord_rep_2_' + Date.now();

  DataAccess.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_id, customer_name, customer_phone, status, order_type, subtotal, grand_total, payment_status, created_at, updated_at)
    VALUES (?, 'ORD-REP-1', ?, ?, ?, 'Budi', '08123', 'completed', 'delivery', 50000, 50000, 'paid', '2026-10-21 10:00:00', '2026-10-21 10:00:00')
  `).run(orderId1, brandId, branchId, customerId);

  DataAccess.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_id, customer_name, customer_phone, status, order_type, subtotal, grand_total, payment_status, created_at, updated_at)
    VALUES (?, 'ORD-REP-2', ?, ?, ?, 'Budi', '08123', 'completed', 'delivery', 80000, 80000, 'paid', '2026-10-21 11:00:00', '2026-10-21 11:00:00')
  `).run(orderId2, brandId, branchId, customerId);

  DataAccess.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal)
    VALUES ('oi_1', ?, 'prod_1', 'Ayam Bakar Madu', 2, 25000, 50000)
  `).run(orderId1);

  DataAccess.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal)
    VALUES ('oi_2', ?, 'prod_1', 'Ayam Bakar Madu', 1, 25000, 25000)
  `).run(orderId2);

  DataAccess.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal)
    VALUES ('oi_3', ?, 'prod_2', 'Es Teh Manis', 3, 5000, 15000)
  `).run(orderId2);

  // Record 2 conversions for this affiliate
  // Order 1: 2 items -> Rp2.000 commission
  await affService.evaluateOrderConversion({
    brandId,
    orderId: orderId1,
    referralCode: profile.referral_code,
    customerId: 'cust_buyer_1',
    subtotal: 50000,
    totalItems: 2
  });

  // Order 2: 4 items (1 ayam + 3 es teh) -> Rp4.000 commission
  await affService.evaluateOrderConversion({
    brandId,
    orderId: orderId2,
    referralCode: profile.referral_code,
    customerId: 'cust_buyer_2',
    subtotal: 80000,
    totalItems: 4
  });

  await t.test('1. ReportingEngine generates affiliate summary correctly', () => {
    const report = ReportingEngine.generateReport('affiliate', { brand_id: brandId });
    assert.equal(report.report_type, 'affiliate');
    assert.ok(report.summary);
    assert.equal(report.summary.total_orders, 2);
    assert.equal(report.summary.total_sales, 130000);
    assert.equal(report.summary.total_items_sold, 6);
    assert.equal(report.summary.total_commission, 6000); // 6 items * Rp1.000
    assert.equal(report.summary.active_affiliates_count, 1);
  });

  await t.test('2. Top affiliates leaderboard aggregates accurately', () => {
    const report = ReportingEngine.generateReport('affiliate', { brand_id: brandId });
    assert.equal(report.top_affiliates.length, 1);
    const top = report.top_affiliates[0];
    assert.equal(top.referral_code, profile.referral_code);
    assert.equal(top.orders_count, 2);
    assert.equal(top.items_sold, 6);
    assert.equal(top.total_sales, 130000);
    assert.equal(top.total_commission, 6000);
  });

  await t.test('3. Top products sold via affiliate shows menu level breakdown', () => {
    const report = ReportingEngine.generateReport('affiliate', { brand_id: brandId });
    assert.ok(report.top_products.length >= 2);
    const ayam = report.top_products.find(p => p.product_name === 'Ayam Bakar Madu');
    assert.ok(ayam);
    assert.equal(ayam.quantity_sold, 3); // 2 in ord1 + 1 in ord2
  });

  await t.test('4. Recent conversions audit list returns order level details', () => {
    const report = ReportingEngine.generateReport('affiliate', { brand_id: brandId });
    assert.equal(report.recent_conversions.length, 2);
    assert.equal(report.recent_conversions[0].referral_code, profile.referral_code);
    assert.ok(report.recent_conversions[0].commission_amount > 0);
  });
});
