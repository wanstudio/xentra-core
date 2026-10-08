'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { MenuCompositionCostService } = require('../../domains/costing');
const ProductionRepository = require('../../core/data/repositories/ProductionRepository');

const ORG = 'org_menu_cost_v1';
const BRAND = 'brand_menu_cost_v1';
const BRANCH = 'branch_menu_cost_v1';
const LOCATION = 'loc_menu_cost_v1';
const PRODUCT_PURCHASED = 'prod_menu_cost_purchased';
const PRODUCT_PRODUCED = 'prod_menu_cost_produced';
const PRODUCT_THEORETICAL = 'prod_menu_cost_theoretical';
const MATERIAL_THEORETICAL = 'mat_menu_cost_theoretical';
const MENU_ACTUAL = 'menu_cost_actual_v1';
const MENU_THEORETICAL = 'menu_cost_theoretical_v1';

test.before(async () => {
  await db.readyPromise;

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Menu Cost Test Org', 'menu-cost-test-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Menu Cost Test Brand', 'menu-cost-test-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(BRANCH, BRAND, 'Menu Cost Test Branch', 'menu-cost-test-branch', 'Test', 0, 0);
  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(LOCATION, ORG, BRANCH, 'MENU-COST', 'Menu Cost Location', 'BRANCH');

  db.prepare(
    'INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active, sku, product_stock_uom_id) VALUES (?, ?, ?, ?, 0, 1, ?, ?), (?, ?, ?, ?, 0, 1, ?, ?), (?, ?, ?, ?, 0, 1, ?, ?)'
  ).run(
    PRODUCT_PURCHASED, BRAND, 'Purchased Component', 'purchased-component', 'MC-P-001', 'uom_pcs',
    PRODUCT_PRODUCED, BRAND, 'Produced Component', 'produced-component', 'MC-R-001', 'uom_pcs',
    PRODUCT_THEORETICAL, BRAND, 'Theoretical Component', 'theoretical-component', 'MC-T-001', 'uom_pcs'
  );

  // Purchased Product: current Product Stock carrying cost = Rp5,000/pcs.
  db.prepare(
    "INSERT INTO product_stock_balances (stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 10, 50000, 5000, 'AVAILABLE', 1)"
  ).run(LOCATION, PRODUCT_PURCHASED);
  db.prepare(
    "INSERT INTO product_stock_movements (id, stock_location_id, product_id, movement_type, quantity, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 5000, 50000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'MC-P-SEED', ?, 1, '2026-10-08T08:00:00.000Z', 'v1')"
  ).run('mov_mc_purchased', LOCATION, PRODUCT_PURCHASED, 'mc-purchased-mut');

  // Produced Product with an actual Production Output cost snapshot = Rp4,000/pcs.
  db.prepare(
    "INSERT INTO production_items (id, organization_id, output_product_id, production_item_code, name, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')"
  ).run('pi_mc_actual', ORG, PRODUCT_PRODUCED, 'PI-MC-ACTUAL', 'Actual Produced');
  db.prepare(
    "INSERT INTO production_item_locations (id, production_item_id, stock_location_id, is_active) VALUES (?, ?, ?, 1)"
  ).run('pil_mc_actual', 'pi_mc_actual', LOCATION);
  db.prepare(
    "INSERT INTO recipes (id, production_item_id, name, status) VALUES (?, ?, ?, 'ACTIVE')"
  ).run('rec_mc_actual', 'pi_mc_actual', 'Actual Recipe');
  db.prepare(
    "INSERT INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id) VALUES (?, ?, 1, 'PUBLISHED', 10, ?)"
  ).run('rv_mc_actual', 'rec_mc_actual', 'uom_pcs');
  db.prepare(
    "INSERT INTO production_batches (id, organization_id, production_item_id, recipe_version_id, production_stock_location_id, input_stock_location_id, output_stock_location_id, planned_output_quantity, actual_output_quantity, status, production_posting_id) VALUES (?, ?, ?, ?, ?, ?, ?, 10, 10, 'COMPLETED', ?)"
  ).run('pb_mc_actual', ORG, 'pi_mc_actual', 'rv_mc_actual', LOCATION, LOCATION, LOCATION, 'mc-production-posting');
  db.prepare(
    "INSERT INTO production_cost_snapshots (id, production_batch_id, production_posting_id, actual_material_cost, actual_output_quantity, production_output_unit_cost, currency_code, cost_availability_status) VALUES (?, ?, ?, 40000, 10, 4000, 'IDR', 'AVAILABLE')"
  ).run('pcs_mc_actual', 'pb_mc_actual', 'mc-production-posting');

  // Theoretical Product: route + recipe + Material moving-average cost.
  db.prepare(
    "INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')"
  ).run(MATERIAL_THEORETICAL, ORG, 'MAT-MC-T', 'Theoretical Material', 'uom_kg');

  db.prepare(
    "INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 100, 1000000, 10000, 'AVAILABLE', 1)"
  ).run(LOCATION, MATERIAL_THEORETICAL);
  db.prepare(
    "INSERT INTO material_stock_movements (id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 100, 0, 100, 10000, 1000000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'MC-T-SEED', ?, 1, '2026-10-08T08:00:00.000Z', 'v1')"
  ).run('mov_mc_theoretical', LOCATION, MATERIAL_THEORETICAL, 'mc-theoretical-mut');

  db.prepare(
    "INSERT INTO production_items (id, organization_id, output_product_id, production_item_code, name, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')"
  ).run('pi_mc_theoretical', ORG, PRODUCT_THEORETICAL, 'PI-MC-THEORETICAL', 'Theoretical Produced');
  db.prepare(
    "INSERT INTO production_item_locations (id, production_item_id, stock_location_id, is_active) VALUES (?, ?, ?, 1)"
  ).run('pil_mc_theoretical', 'pi_mc_theoretical', LOCATION);
  db.prepare(
    "INSERT INTO recipes (id, production_item_id, name, status) VALUES (?, ?, ?, 'ACTIVE')"
  ).run('rec_mc_theoretical', 'pi_mc_theoretical', 'Theoretical Recipe');
  db.prepare(
    "INSERT INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id) VALUES (?, ?, 1, 'PUBLISHED', 10, ?)"
  ).run('rv_mc_theoretical', 'rec_mc_theoretical', 'uom_pcs');
  db.prepare(
    "INSERT INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order) VALUES (?, ?, ?, 2, ?, 0)"
  ).run('rc_mc_theoretical', 'rv_mc_theoretical', MATERIAL_THEORETICAL, 'uom_kg');

  // Menus and compositions.
  db.prepare(
    "INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Menu Cost', 'menu-cost', 1)"
  ).run('cat_menu_cost_v1', BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO menu_titles (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Cost Test', 'cost-test', 1)"
  ).run('title_menu_cost_v1', BRAND);

  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, category_id, title_id, selling_price, status) VALUES (?, ?, ?, ?, 50000, 'ACTIVE'), (?, ?, ?, ?, 50000, 'ACTIVE')"
  ).run(
    MENU_ACTUAL, BRAND, 'cat_menu_cost_v1', 'title_menu_cost_v1',
    MENU_THEORETICAL, BRAND, 'cat_menu_cost_v1', 'title_menu_cost_v1'
  );
  db.prepare(
    "INSERT OR REPLACE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 2, 0), (?, ?, 1, 1)"
  ).run(
    MENU_ACTUAL, PRODUCT_PRODUCED,
    MENU_ACTUAL, PRODUCT_PURCHASED
  );
  db.prepare(
    "INSERT OR REPLACE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 3, 0)"
  ).run(MENU_THEORETICAL, PRODUCT_THEORETICAL);
});

test('Menu Composition Cost — ACTUAL_OUTPUT uses the latest Production Output Unit Cost without fallback', () => {
  const result = MenuCompositionCostService.calculateMenuCompositionCost({
    brandId: BRAND,
    menuId: MENU_ACTUAL,
    stockLocationId: LOCATION,
    basis: 'ACTUAL_OUTPUT'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.currency_code, 'IDR');
  assert.equal(result.total_cost, 13000);
  assert.equal(result.components.length, 2);
  assert.equal(result.components[0].unit_cost, 4000);
  assert.equal(result.components[0].total_cost, 8000);
  assert.equal(result.components[1].unit_cost, 5000);
  assert.equal(result.components[1].total_cost, 5000);
});

test('Menu Composition Cost — THEORETICAL_RECIPE resolves current Material Moving Average through Recipe Version', () => {
  const result = MenuCompositionCostService.calculateMenuCompositionCost({
    brandId: BRAND,
    menuId: MENU_THEORETICAL,
    stockLocationId: LOCATION,
    basis: 'THEORETICAL_RECIPE'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.currency_code, 'IDR');
  assert.equal(result.total_cost, 6000);
  assert.equal(result.components[0].unit_cost, 2000);
  assert.equal(result.components[0].total_cost, 6000);
  assert.equal(result.components[0].source, 'THEORETICAL_RECIPE');
});

test('Menu Composition Cost — explicit basis is mandatory and no hidden fallback is allowed', () => {
  assert.throws(
    () => MenuCompositionCostService.calculateMenuCompositionCost({
      brandId: BRAND,
      menuId: MENU_ACTUAL,
      stockLocationId: LOCATION
    }),
    error => error && error.code === 'MENU_COST_BASIS_REQUIRED'
  );

  const unavailable = MenuCompositionCostService.resolveProductUnitCost({
    productId: PRODUCT_PRODUCED,
    stockLocationId: LOCATION,
    basis: 'ACTUAL_OUTPUT'
  });

  db.prepare('DELETE FROM production_cost_snapshots WHERE id = ?').run('pcs_mc_actual');
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.reason, 'PRODUCTION_ACTUAL_OUTPUT_COST_UNAVAILABLE');
});

test('Menu Composition Cost — cross-currency composition fails closed', () => {
  db.prepare(
    "INSERT OR REPLACE INTO product_stock_movements (id, stock_location_id, product_id, movement_type, quantity, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, 'ADJUSTMENT_IN', 1, 10, 11, 5000, 5000, 'USD', 'MOVING_AVERAGE', 'COUNT_CORRECTION', 'TEST', 'MC-CURRENCY', ?, 2, '2026-10-08T09:00:00.000Z', 'v1')"
  ).run('mov_mc_currency', LOCATION, PRODUCT_PURCHASED, 'mc-currency-mut');

  assert.throws(() => MenuCompositionCostService.calculateMenuCompositionCost({
    brandId: BRAND,
    menuId: MENU_ACTUAL,
    stockLocationId: LOCATION,
    basis: 'ACTUAL_OUTPUT'
  }), error => error && error.code === 'COST_CURRENCY_MISMATCH');
});

test('Menu Composition Cost — invalid basis is rejected', () => {
  assert.throws(
    () => MenuCompositionCostService.resolveProductUnitCost({
      productId: PRODUCT_PRODUCED,
      stockLocationId: LOCATION,
      basis: 'LATEST_COST'
    }),
    error => error && error.code === 'MENU_COST_BASIS_INVALID'
  );
});
