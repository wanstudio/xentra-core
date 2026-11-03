'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const KitchenWasteService = require('../domains/inventory/services/KitchenWasteService');
const { ensureKitchenWasteSchema } = require('../domains/inventory/schema/KitchenWasteSchema');

test('Kitchen Waste Spoilage Suite', async (t) => {
  ensureKitchenWasteSchema(db);

  test.before(() => {
    // Org, brand, branch
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_waste_test', 'Holding Waste', 'org-waste-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_waste_test', 'org_waste_test', 'Brand Waste', 'brand-waste-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_waste_test', 'brand_waste_test', 'Branch Waste', 'branch-waste-test', 'Jl. Waste', 0, 0)`).run();

    // Stock location
    db.prepare(`INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES ('sl_waste_test', 'org_waste_test', 'branch_waste_test', 'LOC-WASTE', 'Gudang Waste', 'BRANCH', 1)`).run();

    // UOM & Material
    db.prepare(`INSERT OR IGNORE INTO uom_categories (id, name, code) VALUES ('uom_cat_m', 'Mass', 'mass')`).run();
    db.prepare(`INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, is_active) VALUES ('uom_kg', 'uom_cat_m', 'kg', 'Kilogram', 1.0, 1, 1)`).run();
    db.prepare(`INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES 
      ('mat_ayam_goreng_mentah', 'org_waste_test', 'MAT-WASTE-AYAM', 'Ayam Potong Waste', 'uom_kg', 'ACTIVE')
    `).run();

    // Initial balance: 10 kg, unit cost 25000
    db.prepare(`INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES
      ('sl_waste_test', 'mat_ayam_goreng_mentah', 10.0, 250000.0, 25000.0, 'AVAILABLE', 1)
    `).run();

    // Product (Finished Good)
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_waste_test', 'brand_waste_test', 'Cat Waste', 'cat-waste')`).run();
    db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES 
      ('prod_aqua_botol', 'brand_waste_test', 'cat_waste_test', 'Aqua Botol 600ml', 'aqua-600', 5000, 1)
    `).run();
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES 
      ('branch_waste_test', 'prod_aqua_botol', 24, 1)
    `).run();
  });

  await t.test('1. Records kitchen waste for raw material (BURNT_COOKING_ERROR)', () => {
    // Waste 2 kg of chicken
    const result = KitchenWasteService.recordWaste({
      branchId: 'branch_waste_test',
      itemType: 'MATERIAL',
      itemId: 'mat_ayam_goreng_mentah',
      quantity: 2.0,
      reasonCode: 'BURNT_COOKING_ERROR',
      notes: 'Gosong saat penggorengan jam makan siang',
      reportedBy: 'usr_chef_01'
    }, db);

    assert.strictEqual(result.success, true);
    assert.ok(result.waste_log_id);
    assert.strictEqual(result.quantity_wasted, 2.0);
    assert.strictEqual(result.new_stock, 8.0);
    assert.strictEqual(result.cost_amount, 50000.0); // 2 kg * 25000

    // Check balance in db
    const bal = db.prepare('SELECT quantity_base, carrying_value FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get('sl_waste_test', 'mat_ayam_goreng_mentah');
    assert.strictEqual(bal.quantity_base, 8.0);
    assert.strictEqual(bal.carrying_value, 200000.0);

    // Check material_stock_movements
    const mov = db.prepare('SELECT movement_type, quantity_base, total_cost FROM material_stock_movements WHERE source_reference = ?').get(result.waste_log_id);
    assert.ok(mov);
    assert.strictEqual(mov.movement_type, 'WASTE');
    assert.strictEqual(mov.quantity_base, -2.0);
    assert.strictEqual(mov.total_cost, -50000.0);
  });

  await t.test('2. Records waste for finished retail product (DROPPED_CONTAMINATED)', () => {
    // 2 bottles of Aqua dropped and leaked
    const result = KitchenWasteService.recordWaste({
      branchId: 'branch_waste_test',
      itemType: 'PRODUCT',
      itemId: 'prod_aqua_botol',
      quantity: 2,
      reasonCode: 'DROPPED_CONTAMINATED',
      notes: 'Pecah jatuh dari rak kulkas',
      reportedBy: 'usr_waiter_01'
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.new_stock, 22); // 24 - 2

    const bp = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_waste_test', 'prod_aqua_botol');
    assert.strictEqual(bp.stock, 22);
  });

  await t.test('3. Rejects invalid quantity and unknown reason code', () => {
    assert.throws(() => {
      KitchenWasteService.recordWaste({
        branchId: 'branch_waste_test',
        itemId: 'mat_ayam_goreng_mentah',
        quantity: -5,
        reportedBy: 'usr_chef_01'
      }, db);
    }, /quantity must be a positive number/);

    assert.throws(() => {
      KitchenWasteService.recordWaste({
        branchId: 'branch_waste_test',
        itemId: 'mat_ayam_goreng_mentah',
        quantity: 1,
        reasonCode: 'INVALID_REASON',
        reportedBy: 'usr_chef_01'
      }, db);
    }, /reasonCode tidak valid/);
  });

  await t.test('4. getBranchWasteLogs retrieves chronological waste records', () => {
    const logs = KitchenWasteService.getBranchWasteLogs({ branchId: 'branch_waste_test', limit: 10 }, db);
    assert.ok(Array.isArray(logs) && logs.length >= 2);
    const burntLog = logs.find(l => l.reason_code === 'BURNT_COOKING_ERROR');
    assert.ok(burntLog);
    assert.strictEqual(burntLog.item_name, 'Ayam Potong Waste');
  });
});
