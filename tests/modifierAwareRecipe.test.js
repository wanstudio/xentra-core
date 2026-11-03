'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const RecipeConsumptionService = require('../domains/inventory/services/RecipeConsumptionService');
const { ensureTheoreticalConsumptionSchema } = require('../domains/inventory/schema/TheoreticalConsumptionSchema');

test('Modifier-Aware Recipe Suite', async (t) => {
  ensureTheoreticalConsumptionSchema(db);

  test.before(() => {
    // Org, brand, branch
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_mod_test', 'Holding Mod', 'org-mod-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_mod_test', 'org_mod_test', 'Brand Mod', 'brand-mod-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_mod_test', 'brand_mod_test', 'Branch Mod', 'branch-mod-test', 'Jl. Mod', 0, 0)`).run();

    // UOMs
    db.prepare(`INSERT OR IGNORE INTO uom_categories (id, name, code) VALUES ('uom_cat_m', 'Mass', 'mass'), ('uom_cat_c', 'Count', 'count')`).run();
    db.prepare(`INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, is_active) VALUES 
      ('uom_kg', 'uom_cat_m', 'kg', 'Kilogram', 1.0, 1, 1),
      ('uom_g', 'uom_cat_m', 'g', 'Gram', 0.001, 1, 1),
      ('uom_pcs', 'uom_cat_c', 'pcs', 'Pieces', 1.0, 0, 1)
    `).run();

    // Materials: Nutrisari sachet, Es Batu, Gula Pasir
    db.prepare(`INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES 
      ('mat_nutri_sachet', 'org_mod_test', 'MAT-NUTRI-S', 'Nutrisari Jeruk Sachet', 'uom_pcs', 'ACTIVE'),
      ('mat_es_batu', 'org_mod_test', 'MAT-ES', 'Es Batu Kristal', 'uom_kg', 'ACTIVE'),
      ('mat_gula_pasir', 'org_mod_test', 'MAT-GULA', 'Gula Cair Tebu', 'uom_kg', 'ACTIVE')
    `).run();

    // Product: Nutrisari Segar
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_mod_test', 'brand_mod_test', 'Minuman', 'minuman')`).run();
    db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES 
      ('prod_nutrisari_jeruk', 'brand_mod_test', 'cat_mod_test', 'Nutrisari Jeruk Segar', 'nutrisari-jeruk', 7000, 1)
    `).run();

    // Production Item & Recipe
    db.prepare(`INSERT OR IGNORE INTO production_items (id, organization_id, output_product_id, production_item_code, name, status) VALUES 
      ('pi_nutrisari', 'org_mod_test', 'prod_nutrisari_jeruk', 'PI-NUTRI', 'Nutrisari Cup', 'ACTIVE')
    `).run();

    db.prepare(`INSERT OR IGNORE INTO recipes (id, production_item_id, name, status) VALUES 
      ('rec_nutrisari', 'pi_nutrisari', 'Resep Nutrisari Dingin Segar', 'ACTIVE')
    `).run();

    db.prepare(`INSERT OR IGNORE INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id) VALUES 
      ('rv_nutrisari_v1', 'rec_nutrisari', 1, 'PUBLISHED', 1, 'uom_pcs')
    `).run();

    // Recipe: 1 sachet nutrisari + 50g es batu + 20g gula pasir per 1 porsi (yield = 1)
    db.prepare(`INSERT OR IGNORE INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order) VALUES 
      ('rc_n_1', 'rv_nutrisari_v1', 'mat_nutri_sachet', 1.0, 'uom_pcs', 1),
      ('rc_n_2', 'rv_nutrisari_v1', 'mat_es_batu', 50.0, 'uom_g', 2),
      ('rc_n_3', 'rv_nutrisari_v1', 'mat_gula_pasir', 20.0, 'uom_g', 3)
    `).run();
  });

  await t.test('1. Normal order (Default / Dingin) consumes all components including ice and sugar', () => {
    const testOrderId = 'test_order_default_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-DEFAULT',
      branch_id: 'branch_mod_test',
      items: [
        {
          product_id: 'prod_nutrisari_jeruk',
          quantity: 2,
          modifiers_snapshot: [{ group_name: 'Suhu', option_name: 'Dingin Normal' }]
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.records_inserted, 3);

    const rows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    const sachetRow = rows.find(r => r.material_id === 'mat_nutri_sachet');
    const esRow = rows.find(r => r.material_id === 'mat_es_batu');
    const gulaRow = rows.find(r => r.material_id === 'mat_gula_pasir');

    assert.strictEqual(sachetRow.consumed_base_qty, 2.0); // 2 pcs
    assert.ok(Math.abs(esRow.consumed_base_qty - 0.1) < 0.0001); // 2 * 50g = 100g = 0.1 kg
    assert.ok(Math.abs(gulaRow.consumed_base_qty - 0.04) < 0.0001); // 2 * 20g = 40g = 0.04 kg

    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });

  await t.test('2. Modifier "Hangat / No Ice" SKIPS ice completely while keeping sachet and sugar', () => {
    const testOrderId = 'test_order_hot_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-HOT',
      branch_id: 'branch_mod_test',
      items: [
        {
          product_id: 'prod_nutrisari_jeruk',
          quantity: 2,
          modifiers_snapshot: [{ group_name: 'Suhu', option_name: 'Hangat' }]
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    // Ice must be skipped! So only 2 records inserted (sachet & gula)
    assert.strictEqual(result.records_inserted, 2);

    const rows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    const esRow = rows.find(r => r.material_id === 'mat_es_batu');
    assert.strictEqual(esRow, undefined, 'Es Batu should be completely skipped for Hangat');

    const sachetRow = rows.find(r => r.material_id === 'mat_nutri_sachet');
    assert.strictEqual(sachetRow.consumed_base_qty, 2.0);

    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });

  await t.test('3. Modifier "Less Sugar / Sedikit Gula" cuts sugar consumption by 50%', () => {
    const testOrderId = 'test_order_less_sugar_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-LESS-SUGAR',
      branch_id: 'branch_mod_test',
      items: [
        {
          product_id: 'prod_nutrisari_jeruk',
          quantity: 2,
          modifiers_snapshot: [
            { group_name: 'Suhu', option_name: 'Dingin' },
            { group_name: 'Gula', option_name: 'Less Sugar (50%)' }
          ]
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.records_inserted, 3);

    const rows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    const gulaRow = rows.find(r => r.material_id === 'mat_gula_pasir');
    // Normal 2 orders = 0.04 kg. 50% less sugar = 0.02 kg!
    assert.ok(Math.abs(gulaRow.consumed_base_qty - 0.02) < 0.0001, `Expected 0.02 kg, got ${gulaRow.consumed_base_qty}`);

    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });
});
