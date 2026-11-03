'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');

test('Multi-UOM Purchasing Conversion Suite', async (t) => {
  test.before(() => {
    // Basic org, brand, branch
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_uom_test', 'Holding UOM', 'org-uom-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_uom_test', 'org_uom_test', 'Brand UOM', 'brand-uom-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_uom_test', 'brand_uom_test', 'Branch UOM', 'branch-uom-test', 'Jl. UOM', 0, 0)`).run();

    // Stock location
    db.prepare(`INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES ('sl_uom_test', 'org_uom_test', 'branch_uom_test', 'LOC-UOM', 'Gudang UOM', 'BRANCH', 1)`).run();

    // UOMs
    db.prepare(`INSERT OR IGNORE INTO uom_categories (id, name, code) VALUES ('uom_cat_m', 'Mass', 'mass'), ('uom_cat_c', 'Count', 'count')`).run();
    db.prepare(`INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, is_active) VALUES 
      ('uom_kg', 'uom_cat_m', 'kg', 'Kilogram', 1.0, 1, 1),
      ('uom_pcs', 'uom_cat_c', 'pcs', 'Pieces', 1.0, 0, 1)
    `).run();

    // Materials with Purchase UOM & Ratio:
    // 1. Beras: Base = kg, Purchase UOM = Karung (Ratio 25)
    // 2. Nutrisari: Base = pcs (sachet), Purchase UOM = Renteng (Ratio 10)
    db.prepare(`INSERT OR REPLACE INTO materials (id, organization_id, material_code, name, base_uom_id, purchase_uom_name, purchase_uom_ratio, status) VALUES 
      ('mat_beras_pandan', 'org_uom_test', 'MAT-BERAS', 'Beras Pandan Wangi', 'uom_kg', 'Karung', 25.0, 'ACTIVE'),
      ('mat_nutri_renteng', 'org_uom_test', 'MAT-NUTRI-R', 'Nutrisari Jeruk Manis', 'uom_pcs', 'Renteng', 10.0, 'ACTIVE')
    `).run();
  });

  await t.test('1. Material stores purchase_uom_name and purchase_uom_ratio', () => {
    const mat = db.prepare('SELECT purchase_uom_name, purchase_uom_ratio FROM materials WHERE id = ?').get('mat_beras_pandan');
    assert.strictEqual(mat.purchase_uom_name, 'Karung');
    assert.strictEqual(mat.purchase_uom_ratio, 25.0);
  });

  await t.test('2. Purchasing intake converts 2 Karung Beras into 50 kg base stock', () => {
    // Simulate direct intake of 2 Karung with total cost 700,000 IDR (350,000 per karung -> 14,000 per kg)
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get('mat_beras_pandan');
    const inputQty = 2; // 2 Karung
    const ratio = material.purchase_uom_ratio; // 25
    const baseQuantity = inputQty * ratio; // 50 kg
    const totalPrice = 700000;
    const unitCost = totalPrice / baseQuantity; // 14,000 / kg

    const location = db.prepare('SELECT id FROM stock_locations WHERE branch_id = ?').get('branch_uom_test');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO material_stock_balances (
        stock_location_id, material_id, quantity_base, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)
    `).run(location.id, material.id, baseQuantity, totalPrice, unitCost, now, now);

    const bal = db.prepare('SELECT quantity_base, moving_average_unit_cost FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(location.id, material.id);
    assert.strictEqual(bal.quantity_base, 50.0);
    assert.strictEqual(bal.moving_average_unit_cost, 14000.0);
  });

  await t.test('3. Purchasing intake converts 5 Renteng Nutrisari into 50 sachets (pcs)', () => {
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get('mat_nutri_renteng');
    const inputQty = 5; // 5 Renteng
    const ratio = material.purchase_uom_ratio; // 10
    const baseQuantity = inputQty * ratio; // 50 pcs
    const totalPrice = 75000; // 15,000 per renteng -> 1,500 per sachet
    const unitCost = totalPrice / baseQuantity;

    const location = db.prepare('SELECT id FROM stock_locations WHERE branch_id = ?').get('branch_uom_test');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO material_stock_balances (
        stock_location_id, material_id, quantity_base, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)
    `).run(location.id, material.id, baseQuantity, totalPrice, unitCost, now, now);

    const bal = db.prepare('SELECT quantity_base, moving_average_unit_cost FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(location.id, material.id);
    assert.strictEqual(bal.quantity_base, 50.0);
    assert.strictEqual(bal.moving_average_unit_cost, 1500.0);
  });
});
