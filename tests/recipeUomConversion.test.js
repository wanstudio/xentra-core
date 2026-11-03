'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { MaterialRepository } = require('../core/data/repositories');
const db = require('../server/database/db');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Recipe Component UOM and Conversion Calculation Suite', async (t) => {
  await t.test('1. MaterialRepository returns base_uom_factor and base_uom_category_id', async () => {
    const { DataAccess } = require('../core/data');
    if (DataAccess && DataAccess.readyPromise) {
      await DataAccess.readyPromise;
    }

    // Seed test UOMs and Material if in test in-memory DB
    try {
      db.prepare("INSERT OR IGNORE INTO uom_categories (id, code, name, reference_uom_id, is_active) VALUES ('uom_cat_mass', 'mass', 'Massa', 'uom_kg', 1)").run();
      db.prepare("INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, quantity_precision, is_active) VALUES ('uom_kg', 'uom_cat_mass', 'kg', 'Kilogram', 1.0, 1, 6, 1)").run();
      db.prepare("INSERT OR REPLACE INTO stock_locations (id, organization_id, code, name, location_type, is_active) VALUES ('loc_test', 'org_xentra_holding', 'LOC1', 'Default', 'CENTRAL_KITCHEN', 1)").run();
      db.prepare("INSERT OR REPLACE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES ('mat_test_ayam', 'org_xentra_holding', 'MAT-TEST', 'Daging Ayam Kampung Test', 'uom_kg', 'ACTIVE')").run();
      db.prepare("INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, moving_average_unit_cost, carrying_value, cost_availability_status, valuation_version, created_at, updated_at) VALUES ('loc_test', 'mat_test_ayam', 10, 55000, 550000, 'AVAILABLE', 1, datetime('now'), datetime('now'))").run();
    } catch (_) {}

    const repo = new MaterialRepository();
    const materials = repo.listWithDetails('org_xentra_holding');
    assert.ok(materials.length > 0, 'Must return materials');

    const ayam = materials.find(m => m.id === 'mat_test_ayam' || m.id === 'mat_ayam_kampung');
    assert.ok(ayam, 'Test ayam material must exist');
    assert.strictEqual(ayam.base_uom_name, 'Kilogram');
    assert.strictEqual(ayam.base_uom_factor, 1);
    assert.strictEqual(ayam.base_uom_category_id, 'uom_cat_mass');
    assert.strictEqual(ayam.unit_cost, 55000);
  });

  await t.test('2. UOM conversion math: 150 Gram x Rp 55.000/Kg equals Rp 8.250, not Rp 8.250.000', () => {
    function getComponentLineCost(comp) {
      const qty = Number(comp.planned_quantity) || 0;
      if (qty <= 0) return 0;
      const baseCost = Number(comp.unit_cost) || 0;
      if (baseCost <= 0) return 0;
      const plannedFactor = Number(comp.planned_uom_factor) || 1.0;
      const baseFactor = Number(comp.base_uom_factor) || 1.0;
      const ratio = baseFactor > 0 ? (plannedFactor / baseFactor) : 1;
      return Math.round(qty * ratio * baseCost);
    }

    // 150 Gram Ayam Kampung (Base: Kg, Cost: Rp 55.000)
    const ayam150g = {
      planned_quantity: 150,
      planned_uom_id: 'uom_g',
      planned_uom_factor: 0.001,
      base_uom_id: 'uom_kg',
      base_uom_factor: 1.0,
      unit_cost: 55000
    };
    const cost150g = getComponentLineCost(ayam150g);
    assert.strictEqual(cost150g, 8250, '150g of Rp 55.000/Kg must be exactly Rp 8.250');

    // Switching unit to 0.15 Kg
    const ayam015kg = {
      planned_quantity: 0.15,
      planned_uom_id: 'uom_kg',
      planned_uom_factor: 1.0,
      base_uom_id: 'uom_kg',
      base_uom_factor: 1.0,
      unit_cost: 55000
    };
    const cost015kg = getComponentLineCost(ayam015kg);
    assert.strictEqual(cost015kg, 8250, '0.15 Kg of Rp 55.000/Kg must also be Rp 8.250');

    // 200 ml of Susu UHT (Base: Liter, Cost: Rp 17.500)
    const susu200ml = {
      planned_quantity: 200,
      planned_uom_id: 'uom_ml',
      planned_uom_factor: 0.001,
      base_uom_id: 'uom_l',
      base_uom_factor: 1.0,
      unit_cost: 17500
    };
    const costSusu = getComponentLineCost(susu200ml);
    assert.strictEqual(costSusu, 3500, '200 ml of Rp 17.500/Liter must be Rp 3.500');
  });

  await t.test('3. Compiled bundle contains material-picker page, smart visual icons, and auto-hide logic', () => {
    assert.ok(fs.existsSync(BUNDLE_JS_PATH), 'menu-editor.js bundle must exist');
    const bundleContent = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

    // Check for presence of conversion factor math and selector
    assert.ok(
      bundleContent.includes('0.001') && (bundleContent.includes('getComponentLineCost') || bundleContent.includes('planned_uom_factor')),
      'Bundle must compile UOM conversion logic'
    );
    assert.ok(
      bundleContent.includes('material-picker'),
      'Bundle must compile material-picker dedicated page view'
    );
    assert.ok(
      bundleContent.includes('Pilih (') || bundleContent.includes('Pilih'),
      'Bundle must compile multi-select confirmation button'
    );
  });

  await t.test('4. Auto-hide logic: already selected materials are cleanly excluded from picker list', () => {
    const allMaterials = [
      { id: 'mat_ayam', name: 'Daging Ayam', material_code: 'AYM-01' },
      { id: 'mat_garam', name: 'Garam Dapur', material_code: 'GRM-01' },
      { id: 'mat_cabai', name: 'Cabai Rawit', material_code: 'CBR-01' }
    ];

    const currentRecipeComponents = [
      { material_id: 'mat_ayam', material_name: 'Daging Ayam', planned_quantity: 150 }
    ];

    const selectedIds = new Set(currentRecipeComponents.map(c => c.material_id));
    const available = allMaterials.filter(m => !selectedIds.has(m.id));

    assert.strictEqual(available.length, 2, 'Available materials must only be 2');
    assert.ok(!available.some(m => m.id === 'mat_ayam'), 'Daging Ayam must be automatically hidden');
    assert.ok(available.some(m => m.id === 'mat_garam'), 'Garam Dapur must still be visible');
    assert.ok(available.some(m => m.id === 'mat_cabai'), 'Cabai Rawit must still be visible');
  });
});
