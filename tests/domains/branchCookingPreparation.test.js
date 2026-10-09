'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const db = require('../../server/database/db');
const { ProductionService } = require('../../domains/production');
const InventoryStockService = require('../../domains/inventory/services/InventoryStockService');

const ORG = 'org_cooking_test';
const BRAND = 'brand_cooking_test';
const BRANCH = 'branch_cooking_test';
const LOCATION = 'loc_cooking_branch';
const PRODUCT = 'prod_cooking_ayam';
let MATERIAL_AYAM = null;
let MATERIAL_BUMBU = null;

test.before(async () => {
  await db.readyPromise;

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(ORG, 'Cooking Test Org', 'cooking-test-org');
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(BRAND, ORG, 'Cooking Test Brand', 'cooking-test-brand');
  db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    BRANCH, BRAND, 'Cooking Test Branch', 'cooking-test-branch', 'Jl. Masak 1', 0, 0
  );

  db.prepare('INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(
    LOCATION, ORG, BRANCH, 'SL-COOKING', 'Gudang Cabang Masak', 'BRANCH'
  );

  db.prepare('INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active, sku, product_stock_uom_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(
    PRODUCT, BRAND, 'Ayam Tulang Lunak Kremes', 'ayam-tulang-lunak', 25000, 'SKU-AYAM-01', 'uom_pcs'
  );

  db.prepare('INSERT OR IGNORE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 0, 5)').run(
    BRANCH, PRODUCT
  );

  const MaterialService = require('../../domains/material/services/MaterialService');
  const mat1 = MaterialService.createMaterial({
    organizationId: ORG,
    materialCode: 'MAT-AYAM-MENTAH',
    name: 'Ayam Broiler Utuh',
    baseUomId: 'uom_pcs',
    status: 'ACTIVE'
  });
  MATERIAL_AYAM = mat1.id;

  const mat2 = MaterialService.createMaterial({
    organizationId: ORG,
    materialCode: 'MAT-BUMBU-UNGKEP',
    name: 'Bumbu Ungkep Kuning',
    baseUomId: 'uom_g',
    status: 'ACTIVE'
  });
  MATERIAL_BUMBU = mat2.id;

  // Seed material stock: 10 ekor ayam, 1000g bumbu with movements for valuation continuity
  db.prepare('INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 10, 350000, 35000, ?, 1)').run(
    LOCATION, MATERIAL_AYAM, 'AVAILABLE'
  );
  db.prepare("INSERT INTO material_stock_movements (id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, actor_id, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 35000, 350000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'SEED-AYAM', ?, 1, '2026-10-09T08:00:00.000Z', 'test', 'v1')").run(
    'mov_ayam_seed', LOCATION, MATERIAL_AYAM, 'mut-ayam-seed'
  );

  db.prepare('INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 1000, 50000, 50, ?, 1)').run(
    LOCATION, MATERIAL_BUMBU, 'AVAILABLE'
  );
  db.prepare("INSERT INTO material_stock_movements (id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, actor_id, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 1000, 0, 1000, 50, 50000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'SEED-BUMBU', ?, 1, '2026-10-09T08:00:00.000Z', 'test', 'v1')").run(
    'mov_bumbu_seed', LOCATION, MATERIAL_BUMBU, 'mut-bumbu-seed'
  );

  // Setup recipe: 10 porsi output butuh 2 ekor ayam & 200g bumbu
  const ProductionRepository = require('../../core/data/repositories/ProductionRepository');
  const productionRepo = new ProductionRepository();

  const prodItem = ProductionService.createProductionItem({
    organizationId: ORG,
    outputProductId: PRODUCT,
    productionItemCode: 'PRD-AYAM-01',
    name: 'Resep Ayam Tulang Lunak Kremes',
    repository: productionRepo
  });
  ProductionService.activateProductionItem({ productionItemId: prodItem.id, repository: productionRepo });
  ProductionService.addProductionLocation({ productionItemId: prodItem.id, stockLocationId: LOCATION, repository: productionRepo });

  const recipe = ProductionService.createRecipe({
    productionItemId: prodItem.id,
    name: 'Resep Standar Ayam Tulang Lunak 10 Porsi',
    repository: productionRepo
  });
  ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepo });

  const recipeVersion = ProductionService.createRecipeVersion({
    recipeId: recipe.id,
    plannedYieldQuantity: 10,
    yieldUomId: 'uom_pcs',
    components: [
      { material_id: MATERIAL_AYAM, planned_quantity: 2, planned_uom_id: 'uom_pcs', sort_order: 0 },
      { material_id: MATERIAL_BUMBU, planned_quantity: 200, planned_uom_id: 'uom_g', sort_order: 1 }
    ],
    repository: productionRepo
  });
  ProductionService.publishRecipeVersion({ recipeVersionId: recipeVersion.recipe_version.id, repository: productionRepo });
});

test('Cooking preparation consumes raw materials proportionally and increments product portions atomically', async () => {
  const express = require('express');
  const registerAdminBranchOperationsRoutes = require('../../server/routes/admin-branch-operations');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'user_bm_1', role: 'branch_manager', branchId: BRANCH, organization_id: ORG };
    req.brand_id = BRAND;
    next();
  });

  const router = express.Router();
  registerAdminBranchOperationsRoutes(router, {
    db,
    requireAuth: () => (req, res, next) => next(),
    InventoryStockService
  });
  app.use(router);

  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Get branch recipes with material stock
    const recipesRes = await fetch(`http://127.0.0.1:${port}/admin/branches/${BRANCH}/inventory/recipes`);
    assert.equal(recipesRes.status, 200);
    const recipesData = await recipesRes.json();
    assert.equal(recipesData.success, true);
    assert.equal(recipesData.recipes.length, 1);
    assert.equal(recipesData.recipes[0].output_product_id, PRODUCT);
    assert.equal(recipesData.recipes[0].components.length, 2);

    // 2. Cook 20 portions (requires 4 ayam & 400g bumbu)
    const prepareRes = await fetch(`http://127.0.0.1:${port}/admin/branches/${BRANCH}/inventory/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: PRODUCT,
        portions: 20,
        notes: 'Batch pagi koki Budi'
      })
    });
    assert.equal(prepareRes.status, 200);
    const prepareData = await prepareRes.json();
    assert.equal(prepareData.success, true);
    assert.equal(prepareData.portions_prepared, 20);
    assert.equal(prepareData.current_stock, 20);

    // Check material balances in DB (10 - 4 = 6 ayam; 1000 - 400 = 600g bumbu)
    const ayamBal = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(LOCATION, MATERIAL_AYAM);
    const bumbuBal = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(LOCATION, MATERIAL_BUMBU);
    assert.equal(ayamBal.quantity_base, 6);
    assert.equal(bumbuBal.quantity_base, 600);

    // 3. Try cooking 50 portions (requires 10 ayam, but only 6 available -> should reject)
    const excessRes = await fetch(`http://127.0.0.1:${port}/admin/branches/${BRANCH}/inventory/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: PRODUCT,
        portions: 50
      })
    });
    assert.equal(excessRes.status, 400);
    const excessData = await excessRes.json();
    assert.equal(excessData.success, false);
    assert.equal(excessData.error, 'INSUFFICIENT_MATERIAL_STOCK');

    // Portions and materials must remain intact after rejection
    const stockAfter = InventoryStockService.getStock(BRANCH, PRODUCT);
    assert.equal(stockAfter, 20);
  } finally {
    server.close();
  }
});
