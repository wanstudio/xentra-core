'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const ShiftMaterialAuditService = require('../domains/inventory/services/ShiftMaterialAuditService');
const { ensureShiftMaterialAuditSchema } = require('../domains/inventory/schema/ShiftMaterialAuditSchema');
const { ensureTheoreticalConsumptionSchema } = require('../domains/inventory/schema/TheoreticalConsumptionSchema');

test('Blind Shift Material Audit Suite', async (t) => {
  ensureShiftMaterialAuditSchema(db);
  ensureTheoreticalConsumptionSchema(db);

  test.before(() => {
    // Basic org, brand, branch
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_audit_test', 'Holding Audit', 'org-audit-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_audit_test', 'org_audit_test', 'Brand Audit', 'brand-audit-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, whatsapp_number) VALUES ('branch_audit_test', 'brand_audit_test', 'Branch Audit', 'branch-audit-test', 'Jl. Audit No 1', -6.2, 106.8, '628888')`).run();

    // Stock location
    db.prepare(`INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES ('sl_audit_test', 'org_audit_test', 'branch_audit_test', 'LOC-AUDIT', 'Gudang Audit', 'BRANCH', 1)`).run();

    // UOM & Material
    db.prepare(`INSERT OR IGNORE INTO uom_categories (id, name, code) VALUES ('uom_cat_m', 'Mass', 'mass')`).run();
    db.prepare(`INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, is_active) VALUES ('uom_kg', 'uom_cat_m', 'kg', 'Kilogram', 1.0, 1, 1)`).run();
    db.prepare(`INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES 
      ('mat_nutrisari_sachet', 'org_audit_test', 'MAT-NUTRI', 'Nutrisari Jeruk Sachet', 'uom_kg', 'ACTIVE'),
      ('mat_ayam_karkas', 'org_audit_test', 'MAT-AYAM', 'Daging Ayam Karkas', 'uom_kg', 'ACTIVE')
    `).run();

    // Seed initial balance in material_stock_balances
    db.prepare(`INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES
      ('sl_audit_test', 'mat_nutrisari_sachet', 50.0, 50000.0, 1000.0, 'AVAILABLE', 1),
      ('sl_audit_test', 'mat_ayam_karkas', 20.0, 600000.0, 30000.0, 'AVAILABLE', 1)
    `).run();

    // Create a mock shift
    db.prepare(`INSERT OR REPLACE INTO pos_shifts (id, branch_id, cashier_id, starting_float, status, opened_at) VALUES 
      ('shift_audit_01', 'branch_audit_test', 'usr_cashier_01', 100000, 'open', datetime('now', '-4 hours'))
    `).run();

    // Mock theoretical consumptions recorded during this shift
    db.prepare(`INSERT OR REPLACE INTO order_recipe_consumptions (id, order_id, order_number, branch_id, product_id, product_name, recipe_id, recipe_version_id, material_id, material_name, consumed_base_qty, base_uom_id, base_uom_code, created_at) VALUES
      ('orc_test_1', 'ord_1', '#OD-1', 'branch_audit_test', 'p1', 'Es Nutrisari', 'r1', 'rv1', 'mat_nutrisari_sachet', 'Nutrisari Jeruk Sachet', 10.0, 'uom_kg', 'kg', datetime('now', '-2 hours')),
      ('orc_test_2', 'ord_2', '#OD-2', 'branch_audit_test', 'p2', 'Ayam Goreng', 'r2', 'rv2', 'mat_ayam_karkas', 'Daging Ayam Karkas', 5.0, 'uom_kg', 'kg', datetime('now', '-1 hours'))
    `).run();
  });

  await t.test('1. getBlindAuditChecklist returns checklist without exposing stock numbers', () => {
    const list = ShiftMaterialAuditService.getBlindAuditChecklist({ branchId: 'branch_audit_test' }, db);
    assert.ok(Array.isArray(list) && list.length >= 2);

    for (const item of list) {
      assert.ok(item.material_id);
      assert.ok(item.material_name);
      assert.ok(item.base_uom_code);
      // Ensure NO system stock numbers are leaked
      assert.strictEqual(item.quantity_base, undefined);
      assert.strictEqual(item.current_stock, undefined);
      assert.strictEqual(item.expected_qty, undefined);
    }
  });

  await t.test('2. submitShiftMaterialAudit correctly computes variance against theoretical consumption', () => {
    // Starting balance: Nutrisari 50 kg, consumed 10 kg -> expected = 40 kg
    // Actual input by staff: 38 kg (Deficit / Missing 2 kg)
    // Starting balance: Ayam 20 kg, consumed 5 kg -> expected = 15 kg
    // Actual input by staff: 15 kg (Balanced)
    const result = ShiftMaterialAuditService.submitShiftMaterialAudit({
      shiftId: 'shift_audit_01',
      branchId: 'branch_audit_test',
      actorId: 'usr_cashier_01',
      counts: [
        { material_id: 'mat_nutrisari_sachet', actual_qty: 38.0 },
        { material_id: 'mat_ayam_karkas', actual_qty: 15.0 }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.summary.total_items, 2);
    assert.strictEqual(result.summary.balanced, 1);
    assert.strictEqual(result.summary.deficit, 1);
    assert.strictEqual(result.summary.surplus, 0);

    const nutrisariAudit = result.audits.find(a => a.material_id === 'mat_nutrisari_sachet');
    assert.ok(nutrisariAudit);
    assert.strictEqual(nutrisariAudit.starting_qty, 50.0);
    assert.strictEqual(nutrisariAudit.consumed_qty, 10.0);
    assert.strictEqual(nutrisariAudit.expected_qty, 40.0);
    assert.strictEqual(nutrisariAudit.actual_qty, 38.0);
    assert.strictEqual(nutrisariAudit.variance_qty, -2.0);
    assert.strictEqual(nutrisariAudit.status, 'DEFICIT');

    const ayamAudit = result.audits.find(a => a.material_id === 'mat_ayam_karkas');
    assert.ok(ayamAudit);
    assert.strictEqual(ayamAudit.expected_qty, 15.0);
    assert.strictEqual(ayamAudit.actual_qty, 15.0);
    assert.strictEqual(ayamAudit.variance_qty, 0.0);
    assert.strictEqual(ayamAudit.status, 'BALANCED');
  });

  await t.test('3. getShiftAudits retrieves recorded audits for manager inspection', () => {
    const records = ShiftMaterialAuditService.getShiftAudits('shift_audit_01', db);
    assert.strictEqual(records.length, 2);
    const deficitRow = records.find(r => r.status === 'DEFICIT');
    assert.ok(deficitRow);
    assert.strictEqual(deficitRow.material_id, 'mat_nutrisari_sachet');
    assert.strictEqual(deficitRow.variance_qty, -2.0);
  });
});
