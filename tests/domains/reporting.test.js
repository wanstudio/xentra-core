'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const { domain } = require('../../core');
const {
  ReportingEngine,
  ReportFilterModel,
  SalesReportService,
  PaymentReportService,
  InventoryReportService,
  PosShiftReportService,
  ProductReportService,
  BranchCompareService,
  identity,
  capabilities
} = require('../../domains/reporting');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_rep', 'Holding Report', 'org-rep')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_rep', 'org_rep', 'Brand Report', 'brand-rep')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_rep_1', 'brand_rep', 'Cabang Surabaya', 'sby', '62811111111', 'Jl. Basuki Rahmat', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_rep_2', 'brand_rep', 'Cabang Jakarta', 'jkt', '62822222222', 'Jl. Sudirman', -6.20, 106.81)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_rep', 'brand_rep', 'Menu Utama', 'menu-utama')`).run();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active)
      VALUES 
        ('prod_rep_1', 'brand_rep', 'cat_rep', 'Nasi Goreng Spesial', 'nasgor-spesial', 30000, 'lock', 1),
        ('prod_rep_2', 'brand_rep', 'cat_rep', 'Es Teh Manis', 'es-teh', 5000, 'lock', 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_rep_1', 'prod_rep_1', NULL, 3, 1, 5),
        ('branch_rep_1', 'prod_rep_2', NULL, 50, 1, 10),
        ('branch_rep_2', 'prod_rep_1', NULL, 15, 1, 5)
    `).run();

    // Orders Seed
    db.prepare(`
      INSERT OR REPLACE INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, delivery_fee, grand_total, payment_method, status, created_at)
      VALUES 
        ('ord_rep_1', 'ORD-REP-1', 'brand_rep', 'branch_rep_1', 'Budi', '6281234', 'dine_in', 'pos_cashier', 60000, 0, 60000, 'cash', 'confirmed', '2026-08-31 10:00:00'),
        ('ord_rep_2', 'ORD-REP-2', 'brand_rep', 'branch_rep_1', 'Siti', '6281235', 'delivery', 'customer_app', 35000, 10000, 45000, 'midtrans', 'confirmed', '2026-08-31 12:00:00'),
        ('ord_rep_3', 'ORD-REP-3', 'brand_rep', 'branch_rep_2', 'Agus', '6281236', 'pickup', 'customer_app', 30000, 0, 30000, 'midtrans', 'confirmed', '2026-08-31 14:00:00')
    `).run();

    // Order Items Seed
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES
        ('item_rep_1', 'ord_rep_1', 'prod_rep_1', 'Nasi Goreng Spesial', 30000, 2, 60000),
        ('item_rep_2', 'ord_rep_2', 'prod_rep_1', 'Nasi Goreng Spesial', 30000, 1, 30000),
        ('item_rep_3', 'ord_rep_2', 'prod_rep_2', 'Es Teh Manis', 5000, 1, 5000),
        ('item_rep_4', 'ord_rep_3', 'prod_rep_1', 'Nasi Goreng Spesial', 30000, 1, 30000)
    `).run();

    // Order Payments Seed
    db.prepare(`
      INSERT OR REPLACE INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, settled_at, created_at)
      VALUES
        ('pay_rep_1', 'ord_rep_1', 'cash', 'cash', 'settlement', 60000, '2026-08-31 10:05:00', '2026-08-31 10:00:00'),
        ('pay_rep_2', 'ord_rep_2', 'midtrans', 'midtrans', 'settlement', 45000, '2026-08-31 12:05:00', '2026-08-31 12:00:00'),
        ('pay_rep_3', 'ord_rep_3', 'midtrans', 'midtrans', 'settlement', 30000, '2026-08-31 14:05:00', '2026-08-31 14:00:00')
    `).run();

    // POS Shift Seed
    db.prepare(`
      INSERT OR REPLACE INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, total_cash_in, total_cash_out, expected_cash, actual_cash, variance, status, opened_at, closed_at)
      VALUES ('shift_rep_1', 'branch_rep_1', 'cashier_1', 100000, 60000, 0, 0, 160000, 160000, 0, 'closed', '2026-08-31 08:00:00', '2026-08-31 16:00:00')
    `).run();
  } catch (e) {
    console.error('Reporting seed error:', e.message);
  }
});

// ==============================================================================
// Reporting 1 — Domain Registration & Capability Declaration
// ==============================================================================
test('Reporting 1 — Domain Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'reporting');
  assert.strictEqual(capabilities.features_provided.includes('sales_analytics'), true);
  assert.strictEqual(capabilities.features_provided.includes('branch_comparison_leaderboard'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('reporting'), true);
});

// ==============================================================================
// Reporting 2 — Sales Report Service (Aggregations, Channels & Order Types)
// ==============================================================================
test('Reporting 2 — Sales Report: aggregates revenue, order types, and channels without mutation', () => {
  const sales = SalesReportService.getSalesReport({ brand_id: 'brand_rep' });
  assert.strictEqual(sales.summary.total_orders, 3);
  assert.strictEqual(sales.summary.gross_revenue, 135000); // 60000 + 45000 + 30000
  assert.strictEqual(sales.summary.total_delivery_fees, 10000);

  // Check breakdown by order type
  const dineIn = sales.by_order_type.find(t => t.order_type === 'dine_in');
  assert.strictEqual(dineIn.order_count, 1);
  assert.strictEqual(dineIn.total_revenue, 60000);

  // Check breakdown by channel
  const posChannel = sales.by_channel.find(c => c.order_channel === 'pos_cashier');
  assert.strictEqual(posChannel.order_count, 1);
});

// ==============================================================================
// Reporting 3 — Payment Report Service (Cash vs Midtrans Settlement)
// ==============================================================================
test('Reporting 3 — Payment Report: aggregates settled funds per provider', () => {
  const payment = PaymentReportService.getPaymentReport({ brand_id: 'brand_rep' });
  assert.strictEqual(payment.summary.cash_settled, 60000);
  assert.strictEqual(payment.summary.midtrans_settled, 75000); // 45000 + 30000
  assert.strictEqual(payment.summary.total_settled, 135000);
});

// ==============================================================================
// Reporting 4 — Inventory Report Service (Low-Stock Alerting & Multi-Tenant Scoping - NEW-01)
// ==============================================================================
test('Reporting 4 — Inventory Report: detects low stock items below threshold with strict brand_id multi-tenant isolation (NEW-01)', () => {
  // Seed a second brand with low stock to test cross-tenant isolation
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_rep_other', 'org_rep', 'Other Brand', 'other-brand')`).run();
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_other_1', 'brand_rep_other', 'Other Branch', 'other-br', '62899999999', 'Jl. Lain', 0, 0)`).run();
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_other', 'brand_rep_other', 'Kategori Lain', 'kat-lain')`).run();
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active) VALUES ('prod_other_1', 'brand_rep_other', 'cat_other', 'Other Product', 'other-p', 20000, 'lock', 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, low_stock_threshold) VALUES ('branch_other_1', 'prod_other_1', 1, 10)`).run();

  // Query inventory report for brand_rep (without branch_id)
  const invBrand = InventoryReportService.getInventoryReport({ brand_id: 'brand_rep' });
  
  // Must ONLY return low stock items belonging to brand_rep, zero items from brand_rep_other
  assert.strictEqual(invBrand.low_stock_alerts.length, 1);
  assert.strictEqual(invBrand.low_stock_alerts[0].product_id, 'prod_rep_1');
  assert.strictEqual(invBrand.low_stock_alerts[0].current_stock, 3);
  assert.strictEqual(invBrand.low_stock_alerts[0].low_stock_threshold, 5);

  // Query for branch_rep_1 explicitly
  const invBranch = InventoryReportService.getInventoryReport({ brand_id: 'brand_rep', branch_id: 'branch_rep_1' });
  assert.strictEqual(invBranch.low_stock_alerts.length, 1);
  assert.strictEqual(invBranch.low_stock_alerts[0].product_id, 'prod_rep_1');
});

// ==============================================================================
// Reporting 5 — POS Shift Report Service (Cashier Accuracy & Multi-Tenant Scoping)
// ==============================================================================
test('Reporting 5 — Shift Report: aggregates shift performance and variance with brand_id scoping', () => {
  const shiftReport = PosShiftReportService.getShiftReport({ brand_id: 'brand_rep', branch_id: 'branch_rep_1' });
  assert.strictEqual(shiftReport.summary.total_shifts, 1);
  assert.strictEqual(shiftReport.summary.total_cash_sales, 60000);
  assert.strictEqual(shiftReport.summary.total_variance, 0);
});

// ==============================================================================
// Reporting 6 — Product & Category Performance
// ==============================================================================
test('Reporting 6 — Product Report: identifies top selling items and category sales', () => {
  const prodReport = ProductReportService.getProductReport({ brand_id: 'brand_rep' });
  assert.strictEqual(prodReport.top_products[0].product_id, 'prod_rep_1');
  assert.strictEqual(prodReport.top_products[0].total_units_sold, 4); // 2 + 1 + 1
  assert.strictEqual(prodReport.top_products[0].total_gross_sales, 120000);
});

// ==============================================================================
// Reporting 7 — Multi-Branch Comparison Leaderboard & Universal Engine Router
// ==============================================================================
test('Reporting 7 — Branch Comparison & Universal Router: compares branch leaderboard and handles routing', () => {
  const comparison = ReportingEngine.generateReport('branches', { brand_id: 'brand_rep' });
  assert.strictEqual(comparison.branches.length, 2);
  assert.strictEqual(comparison.branches[0].branch_id, 'branch_rep_1');
  assert.strictEqual(comparison.branches[0].total_revenue, 105000); // 60000 + 45000
  assert.strictEqual(comparison.branches[1].branch_id, 'branch_rep_2');
  assert.strictEqual(comparison.branches[1].total_revenue, 30000);
});
