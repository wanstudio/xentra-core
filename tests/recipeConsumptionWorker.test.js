'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { events } = require('../core');
const RecipeConsumptionService = require('../domains/inventory/services/RecipeConsumptionService');
const RecipeConsumptionWorker = require('../domains/inventory/workers/RecipeConsumptionWorker');
const { ensureTheoreticalConsumptionSchema } = require('../domains/inventory/schema/TheoreticalConsumptionSchema');

test('Theoretical Recipe Consumption Suite', async (t) => {
  ensureTheoreticalConsumptionSchema(db);

  // Seed fixture context for test (works in both file DB and :memory: test DB)
  test.before(() => {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_worker_test', 'Holding Test', 'org-worker-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_worker_test', 'org_worker_test', 'Brand Test', 'brand-worker-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_worker_test', 'brand_worker_test', 'Branch Worker Test', 'branch-worker-test', '628999999', 'Jl. Test', 0, 0)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_worker_test', 'brand_worker_test', 'Food', 'food')`).run();

    // UOMs
    db.prepare(`INSERT OR IGNORE INTO uom_categories (id, name, code) VALUES ('uom_cat_m', 'Mass', 'mass'), ('uom_cat_c', 'Count', 'count')`).run();
    db.prepare(`INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, is_active) VALUES 
      ('uom_test_kg', 'uom_cat_m', 'kg', 'Kilogram', 1.0, 1, 1),
      ('uom_test_g', 'uom_cat_m', 'g', 'Gram', 0.001, 1, 1),
      ('uom_test_pcs', 'uom_cat_c', 'pcs', 'Pieces', 1.0, 0, 1)
    `).run();

    // Material: Chicken
    db.prepare(`INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES 
      ('mat_test_chicken', 'org_worker_test', 'MAT-CHK', 'Daging Ayam Mentah', 'uom_kg', 'ACTIVE'),
      ('mat_test_bumbu', 'org_worker_test', 'MAT-BMB', 'Bumbu Racik', 'uom_kg', 'ACTIVE')
    `).run();

    // Product: Ayam Goreng
    db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES 
      ('prod_test_fried_chicken', 'brand_worker_test', 'cat_worker_test', 'Ayam Goreng Gurih', 'ayam-goreng-gurih', 20000, 1)
    `).run();

    // Production Item & Recipe
    db.prepare(`INSERT OR IGNORE INTO production_items (id, organization_id, output_product_id, production_item_code, name, status) VALUES 
      ('pi_test_chicken', 'org_worker_test', 'prod_test_fried_chicken', 'PI-CHK', 'Produksi Ayam Goreng', 'ACTIVE')
    `).run();

    db.prepare(`INSERT OR IGNORE INTO recipes (id, production_item_id, name, status) VALUES 
      ('rec_test_chicken', 'pi_test_chicken', 'Resep Ayam Goreng 10 Porsi', 'ACTIVE')
    `).run();

    db.prepare(`INSERT OR IGNORE INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id) VALUES 
      ('rv_test_chicken_v1', 'rec_test_chicken', 1, 'PUBLISHED', 10, 'uom_pcs')
    `).run();

    // Recipe Components: 2 kg ayam + 200 g bumbu for 10 pcs chicken
    db.prepare(`INSERT OR IGNORE INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order) VALUES 
      ('rc_test_1', 'rv_test_chicken_v1', 'mat_test_chicken', 2.0, 'uom_kg', 1),
      ('rc_test_2', 'rv_test_chicken_v1', 'mat_test_bumbu', 200.0, 'uom_g', 2)
    `).run();
  });

  await t.test('1. Schema is created and empty initially for new test order', () => {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM order_recipe_consumptions WHERE order_id = ?').get('test_order_nonexistent');
    assert.strictEqual(count.cnt, 0);
  });

  await t.test('2. Processes theoretical consumption for product with active published recipe', () => {
    const testOrderId = 'test_order_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-TEST-99',
      branch_id: 'branch_worker_test',
      items: [
        {
          product_id: 'prod_test_fried_chicken',
          product_name: 'Ayam Goreng Gurih',
          quantity: 2
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.records_inserted, 2, 'Should insert exactly 2 materials for chicken & bumbu');

    const insertedRows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    assert.strictEqual(insertedRows.length, 2);

    // Yield is 10 pcs. For 2 pcs ordered (ratio 0.2):
    // mat_test_chicken: 2.0 kg * 0.2 = 0.4 kg
    // mat_test_bumbu: 200 g = 0.2 kg * 0.2 = 0.04 kg
    const chickenRow = insertedRows.find(r => r.material_id === 'mat_test_chicken');
    assert.ok(chickenRow, 'mat_test_chicken should be recorded');
    assert.ok(Math.abs(chickenRow.consumed_base_qty - 0.4) < 0.0001, `Expected 0.4 kg, got ${chickenRow.consumed_base_qty}`);

    const bumbuRow = insertedRows.find(r => r.material_id === 'mat_test_bumbu');
    assert.ok(bumbuRow, 'mat_test_bumbu should be recorded');
    assert.ok(Math.abs(bumbuRow.consumed_base_qty - 0.04) < 0.0001, `Expected 0.04 kg, got ${bumbuRow.consumed_base_qty}`);

    // Cleanup test record
    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });

  await t.test('3. Idempotent: same order_id never inserts duplicates', () => {
    const testOrderId = 'test_order_idem_' + Date.now();
    const payload = {
      order_id: testOrderId,
      order_number: '#OD-IDEM',
      branch_id: 'branch_worker_test',
      items: [
        {
          product_id: 'prod_test_fried_chicken',
          product_name: 'Ayam Goreng Gurih',
          quantity: 1
        }
      ]
    };

    const firstRun = RecipeConsumptionService.processOrderTheoreticalConsumption(payload, db);
    assert.strictEqual(firstRun.success, true);
    assert.ok(firstRun.records_inserted > 0);

    const secondRun = RecipeConsumptionService.processOrderTheoreticalConsumption(payload, db);
    assert.strictEqual(secondRun.success, true);
    assert.strictEqual(secondRun.idempotent, true);
    assert.strictEqual(secondRun.records_inserted, 0);

    // Cleanup
    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });

  await t.test('4. Handles Composed Menu component snapshot correctly', () => {
    const testOrderId = 'test_order_composed_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-PAKET-1',
      branch_id: 'branch_worker_test',
      items: [
        {
          menu_id: 'menu_paket_ayam',
          product_name: 'Paket Ayam Hemat',
          quantity: 5,
          component_snapshot: [
            {
              product_id: 'prod_test_fried_chicken',
              product_name: 'Ayam Goreng Gurih',
              quantity: 1
            }
          ]
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.records_inserted, 2);

    // 5 portions = 5 * (2.0 / 10) = 1.0 kg chicken
    const insertedRows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    const chickenRow = insertedRows.find(r => r.material_id === 'mat_test_chicken');
    assert.ok(chickenRow);
    assert.ok(Math.abs(chickenRow.consumed_base_qty - 1.0) < 0.0001);

    // Cleanup
    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });

  await t.test('5. Non-recipe items (e.g. DIRECT or missing recipes) safely produce 0 consumption', () => {
    const testOrderId = 'test_order_nonrecipe_' + Date.now();
    const result = RecipeConsumptionService.processOrderTheoreticalConsumption({
      order_id: testOrderId,
      order_number: '#OD-NONRECIPE',
      branch_id: 'branch_worker_test',
      items: [
        {
          product_id: 'prod_coca_cola_direct_123',
          product_name: 'Coca Cola Kaleng',
          quantity: 5
        }
      ]
    }, db);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.records_inserted, 0);
  });

  await t.test('6. Worker initializes and catches commerce.order.placed event without blocking or error', async () => {
    RecipeConsumptionWorker.resetForTest();
    RecipeConsumptionWorker.init();

    const testOrderId = 'test_event_order_' + Date.now();

    await events.EventBus.publish({
      type: 'commerce.order.placed',
      producer: 'commerce',
      payload: {
        order_id: testOrderId,
        order_number: '#OD-EVENT-01',
        branch_id: 'branch_worker_test',
        items: [
          {
            product_id: 'prod_test_fried_chicken',
            product_name: 'Ayam Goreng Gurih',
            quantity: 1
          }
        ]
      }
    });

    // Allow asynchronous dispatch loop
    await new Promise(r => setTimeout(r, 50));

    const rows = db.prepare('SELECT * FROM order_recipe_consumptions WHERE order_id = ?').all(testOrderId);
    assert.strictEqual(rows.length, 2, 'Worker should have processed event and inserted consumption rows');

    // Cleanup
    db.prepare('DELETE FROM order_recipe_consumptions WHERE order_id = ?').run(testOrderId);
  });
});
