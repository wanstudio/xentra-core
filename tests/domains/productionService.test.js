'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ProductionService } = require('../../domains/production');

const ORG = 'org_production_v1_test';
const BRAND = 'brand_production_v1_test';
const BRANCH = 'branch_production_v1_test';
const INPUT_LOCATION = 'loc_production_input_v1';
const OUTPUT_LOCATION = 'loc_production_output_v1';
let MATERIAL = null;
const PRODUCT = 'prod_production_v1';

let batchId;

test.before(async () => {
  await db.readyPromise;

  db.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)'
  ).run(ORG, 'Production Test Org', 'production-v1-test-org');

  db.prepare(
    'INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)'
  ).run(BRAND, ORG, 'Production Test Brand', 'production-v1-test-brand');

  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(BRANCH, BRAND, 'Production Test Branch', 'production-v1-test-branch', 'Test', 0, 0);

  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(INPUT_LOCATION, ORG, BRANCH, 'PROD-IN', 'Production Input', 'BRANCH');

  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(OUTPUT_LOCATION, ORG, BRANCH, 'PROD-OUT', 'Production Output', 'BRANCH');

  db.prepare(
    'INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active, sku, product_stock_uom_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(PRODUCT, BRAND, 'Production Output Product', 'production-output-product', 0, 'PROD-V1-001', 'uom_pcs');

  const MaterialService = require('../../domains/material/services/MaterialService');
  const material = MaterialService.createMaterial({
    organizationId: ORG,
    materialCode: 'MAT-PROD-001',
    name: 'Production Test Material',
    baseUomId: 'uom_kg',
    status: 'ACTIVE'
  });
  assert.equal(material.status, 'ACTIVE');
  MATERIAL = material.id;

  // Seed an authoritative incoming Material Stock state at Rp10,000/kg.
  db.prepare(
    'INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 10, 100000, 10000, ?, 1)'
  ).run(INPUT_LOCATION, MATERIAL, 'AVAILABLE');

  db.prepare(
    "INSERT INTO material_stock_movements (id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, actor_id, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 10000, 100000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'PROD-SEED', ?, 1, '2026-10-08T08:00:00.000Z', 'test', 'v1')"
  ).run('mov_prod_seed', INPUT_LOCATION, MATERIAL, 'prod-seed-mut');

  const item = ProductionService.createProductionItem({
    organizationId: ORG,
    outputProductId: PRODUCT,
    productionItemCode: 'PI-PROD-001',
    name: 'Production Test Item',
    status: 'ACTIVE'
  });

  ProductionService.addProductionLocation({
    productionItemId: item.id,
    stockLocationId: OUTPUT_LOCATION
  });

  const recipe = ProductionService.createRecipe({
    productionItemId: item.id,
    name: 'Production Test Recipe'
  });

  ProductionService.activateRecipe({ recipeId: recipe.id });

  const version = ProductionService.createRecipeVersion({
    recipeId: recipe.id,
    plannedYieldQuantity: 10,
    yieldUomId: 'uom_pcs',
    components: [{
      material_id: MATERIAL,
      planned_quantity: 1,
      planned_uom_id: 'uom_kg'
    }]
  });

  ProductionService.publishRecipeVersion({
    recipeVersionId: version.recipe_version.id
  });

  const batch = ProductionService.createProductionBatch({
    outputProductId: PRODUCT,
    productionStockLocationId: OUTPUT_LOCATION,
    inputStockLocationId: INPUT_LOCATION,
    outputStockLocationId: OUTPUT_LOCATION,
    plannedOutputQuantity: 10,
    createdBy: 'creator'
  });
  batchId = batch.id;

  ProductionService.planProductionBatch({ productionBatchId: batch.id });
  ProductionService.startProductionBatch({ productionBatchId: batch.id, startedBy: 'operator' });
});

test('Production completion snapshots actual material cost and output unit cost atomically', () => {
  const result = ProductionService.completeProductionBatch({
    productionBatchId: batchId,
    productionPostingId: 'prod-posting-v1-001',
    actualOutputQuantity: 5,
    actualConsumptions: [{
      material_id: MATERIAL,
      actual_quantity: 2,
      source_uom_id: 'uom_kg'
    }],
    currency: 'IDR',
    completedBy: 'operator'
  });

  assert.equal(result.success, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.actual_material_cost, 20000);
  assert.equal(result.actual_output_quantity, 5);
  assert.equal(result.production_output_unit_cost, 4000);
  assert.equal(result.currency_code, 'IDR');

  const batch = db.prepare(
    'SELECT status, recipe_version_id, actual_output_quantity, production_posting_id FROM production_batches WHERE id = ?'
  ).get(batchId);
  assert.equal(batch.status, 'COMPLETED');
  assert.equal(Number(batch.actual_output_quantity), 5);
  assert.equal(batch.production_posting_id, 'prod-posting-v1-001');

  const materialBalance = db.prepare(
    'SELECT quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?'
  ).get(INPUT_LOCATION, MATERIAL);
  assert.equal(Number(materialBalance.quantity_base), 8);
  assert.equal(Number(materialBalance.carrying_value), 80000);
  assert.equal(Number(materialBalance.moving_average_unit_cost), 10000);
  assert.equal(materialBalance.cost_availability_status, 'AVAILABLE');
  assert.equal(Number(materialBalance.valuation_version), 2);

  const productBalance = db.prepare(
    'SELECT quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?'
  ).get(OUTPUT_LOCATION, PRODUCT);
  assert.equal(Number(productBalance.quantity), 5);
  assert.equal(Number(productBalance.carrying_value), 20000);
  assert.equal(Number(productBalance.moving_average_unit_cost), 4000);
  assert.equal(productBalance.cost_availability_status, 'AVAILABLE');
  assert.equal(Number(productBalance.valuation_version), 1);

  const snapshot = db.prepare(
    'SELECT actual_material_cost, actual_output_quantity, production_output_unit_cost, currency_code, cost_availability_status FROM production_cost_snapshots WHERE production_batch_id = ?'
  ).get(batchId);
  assert.equal(Number(snapshot.actual_material_cost), 20000);
  assert.equal(Number(snapshot.actual_output_quantity), 5);
  assert.equal(Number(snapshot.production_output_unit_cost), 4000);
  assert.equal(snapshot.currency_code, 'IDR');
  assert.equal(snapshot.cost_availability_status, 'AVAILABLE');

  const consumption = db.prepare(
    'SELECT actual_source_quantity, actual_base_quantity, resolved_unit_cost, total_cost, inventory_movement_id FROM production_batch_material_consumptions WHERE production_batch_id = ?'
  ).get(batchId);
  assert.equal(Number(consumption.actual_source_quantity), 2);
  assert.equal(Number(consumption.actual_base_quantity), 2);
  assert.equal(Number(consumption.resolved_unit_cost), 10000);
  assert.equal(Number(consumption.total_cost), 20000);

  const issue = db.prepare(
    "SELECT movement_type, quantity_base, total_cost, cost_basis_type FROM material_stock_movements WHERE id = ?"
  ).get(consumption.inventory_movement_id);
  assert.equal(issue.movement_type, 'PRODUCTION_ISSUE');
  assert.equal(Number(issue.quantity_base), -2);
  assert.equal(Number(issue.total_cost), -20000);
  assert.equal(issue.cost_basis_type, 'CURRENT_MOVING_AVERAGE');

  const output = db.prepare(
    "SELECT movement_type, quantity, total_cost, unit_cost, cost_basis_type FROM product_stock_movements WHERE source_reference = ?"
  ).get(batchId);
  assert.equal(output.movement_type, 'PRODUCTION_OUTPUT');
  assert.equal(Number(output.quantity), 5);
  assert.equal(Number(output.total_cost), 20000);
  assert.equal(Number(output.unit_cost), 4000);
  assert.equal(output.cost_basis_type, 'PRODUCTION_OUTPUT');
});

test('Production completion replay is idempotent and returns the original snapshot', () => {
  const replay = ProductionService.completeProductionBatch({
    productionBatchId: batchId,
    productionPostingId: 'prod-posting-v1-001',
    actualOutputQuantity: 999,
    actualConsumptions: [{
      material_id: MATERIAL,
      actual_quantity: 999,
      source_uom_id: 'uom_kg'
    }],
    currency: 'IDR',
    completedBy: 'operator'
  });

  assert.equal(replay.idempotent, true);
  assert.equal(Number(replay.snapshot.actual_material_cost), 20000);
  assert.equal(Number(replay.snapshot.production_output_unit_cost), 4000);

  const issueCount = db.prepare(
    "SELECT COUNT(*) AS count FROM material_stock_movements WHERE source_reference = ? AND movement_type = 'PRODUCTION_ISSUE'"
  ).get(batchId).count;
  const outputCount = db.prepare(
    "SELECT COUNT(*) AS count FROM product_stock_movements WHERE source_reference = ? AND movement_type = 'PRODUCTION_OUTPUT'"
  ).get(batchId).count;
  assert.equal(Number(issueCount), 1);
  assert.equal(Number(outputCount), 1);
});

test('Production completion with insufficient Material Stock does not create a snapshot or partial output', () => {
  const secondBatch = ProductionService.createProductionBatch({
    outputProductId: PRODUCT,
    productionStockLocationId: OUTPUT_LOCATION,
    inputStockLocationId: INPUT_LOCATION,
    outputStockLocationId: OUTPUT_LOCATION,
    plannedOutputQuantity: 10,
    createdBy: 'creator'
  });
  ProductionService.planProductionBatch({ productionBatchId: secondBatch.id });
  ProductionService.startProductionBatch({ productionBatchId: secondBatch.id, startedBy: 'operator' });

  assert.throws(
    () => ProductionService.completeProductionBatch({
      productionBatchId: secondBatch.id,
      productionPostingId: 'prod-posting-v1-002',
      actualOutputQuantity: 5,
      actualConsumptions: [{
        material_id: MATERIAL,
        actual_quantity: 100,
        source_uom_id: 'uom_kg'
      }],
      currency: 'IDR',
      completedBy: 'operator'
    }),
    error => error && error.code === 'INSUFFICIENT_STOCK'
  );

  const secondBatchState = db.prepare(
    'SELECT status FROM production_batches WHERE id = ?'
  ).get(secondBatch.id);
  assert.equal(secondBatchState.status, 'IN_PROGRESS');

  const snapshot = db.prepare(
    'SELECT id FROM production_cost_snapshots WHERE production_batch_id = ?'
  ).get(secondBatch.id);
  assert.equal(snapshot, undefined);

  const materialBalance = db.prepare(
    'SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?'
  ).get(INPUT_LOCATION, MATERIAL);
  assert.equal(Number(materialBalance.quantity_base), 8);
});

test('Published Recipe Version remains immutable after publication', () => {
  const batch = db.prepare(
    'SELECT recipe_version_id FROM production_batches WHERE id = ?'
  ).get(batchId);

  assert.throws(
    () => db.prepare(
      'UPDATE recipe_versions SET planned_yield_quantity = 99 WHERE id = ?'
    ).run(batch.recipe_version_id),
    /PUBLISHED_RECIPE_VERSION_IMMUTABLE/
  );
});
