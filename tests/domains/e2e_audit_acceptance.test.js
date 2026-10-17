'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const db = require('../../server/database/db');
const registerAdminBranchOperationsRoutes = require('../../server/routes/admin-branch-operations');
const InventoryStockService = require('../../domains/inventory/services/InventoryStockService');

const { OrderPlacementService } = require('../../domains/commerce');
const { ReplenishmentService } = require('../../domains/procurement');

test('E2E Audit Acceptance: Verifies all 8 business lifecycle scenarios', async (t) => {
  const orgId = 'org_audit_test_' + Date.now();
  const foreignOrgId = 'org_foreign_' + Date.now();
  const brandId = 'brand_audit_test_' + Date.now();
  const branchId = 'branch_audit_test_' + Date.now();
  const locationId = 'loc_audit_' + Date.now();

  // 0. Seed Organizations, Brands, Branch, Location, UOMs
  db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, 'Audit Test Org', ?)").run(orgId, 'org-audit-' + Date.now());
  db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, 'Foreign Org', ?)").run(foreignOrgId, 'org-foreign-' + Date.now());
  db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Audit Brand', ?)").run(brandId, orgId, 'brand-audit-' + Date.now());
  db.prepare("INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, daily_petty_cash_limit) VALUES (?, ?, 'Branch Audit', ?, 'Jl. Audit 1', 0, 0, 10000000)").run(
    branchId, brandId, 'branch-audit-' + Date.now()
  );
  db.prepare("INSERT INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, 'LOC-AUDIT', 'Gudang Audit', 'BRANCH', 1)").run(
    locationId, orgId, branchId
  );

  // UOMs
  db.prepare("INSERT OR IGNORE INTO uom_categories (id, name) VALUES ('cat_count', 'Count'), ('cat_mass', 'Mass')").run();
  db.prepare("INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, quantity_precision, allows_fraction, is_active) VALUES ('uom_pcs', 'cat_count', 'pcs', 'Pcs', 1, 0, 0, 1)").run();
  db.prepare("INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, quantity_precision, allows_fraction, is_active) VALUES ('uom_kg', 'cat_mass', 'kg', 'Kilogram', 1, 3, 1, 1)").run();
  db.prepare("INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, quantity_precision, allows_fraction, is_active) VALUES ('uom_g', 'cat_mass', 'g', 'Gram', 0.001, 3, 1, 1)").run();

  // Retail product: Air Mineral
  const mineralWaterId = 'prod_mineral_' + Date.now();
  db.prepare(`
    INSERT INTO products (id, brand_id, name, slug, sku, price, cost_price, inventory_type, fulfillment_type, is_active, product_stock_uom_id)
    VALUES (?, ?, 'Air Mineral 600ml', ?, 'SKU-WATER-600', 5000, 2500, 'DIRECT', 'BY_STOCK', 1, 'uom_pcs')
  `).run(mineralWaterId, brandId, 'air-mineral-' + Date.now());
  db.prepare("INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, 5000, 0, 1)").run(branchId, mineralWaterId);

  // Cooked product: Ayam Goreng Siap Saji
  const cookedChickenId = 'prod_ayam_matang_' + Date.now();
  db.prepare(`
    INSERT INTO products (id, brand_id, name, slug, sku, price, cost_price, inventory_type, fulfillment_type, is_active, product_stock_uom_id)
    VALUES (?, ?, 'Ayam Goreng Porsi', ?, 'SKU-AYAM-MATANG', 25000, 12000, 'DIRECT', 'BY_STOCK', 1, 'uom_pcs')
  `).run(cookedChickenId, brandId, 'ayam-goreng-porsi-' + Date.now());
  db.prepare("INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, 25000, 0, 1)").run(branchId, cookedChickenId);

  // Raw material: Daging Ayam Mentah
  const rawChickenMatId = 'mat_ayam_mentah_' + Date.now();
  db.prepare(`
    INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status)
    VALUES (?, ?, 'MAT-AYAM', 'Daging Ayam Mentah', 'uom_kg', 'ACTIVE')
  `).run(rawChickenMatId, orgId);

  // Foreign material in foreign organization
  const foreignMatId = 'mat_foreign_' + Date.now();
  db.prepare(`
    INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status)
    VALUES (?, ?, 'MAT-FOREIGN', 'Bahan Asing Luar Org', 'uom_kg', 'ACTIVE')
  `).run(foreignMatId, foreignOrgId);

  // Recipe for Ayam Goreng: 1 portion needs 0.2 kg ayam mentah
  const { ProductionService } = require('../../domains/production');
  const ProductionRepository = require('../../core/data/repositories/ProductionRepository');
  const productionRepo = new ProductionRepository();

  const prodItem = ProductionService.createProductionItem({
    organizationId: orgId,
    outputProductId: cookedChickenId,
    productionItemCode: 'PRD-AYAM-' + Date.now(),
    name: 'Produksi Ayam Goreng',
    repository: productionRepo
  });
  ProductionService.activateProductionItem({ productionItemId: prodItem.id, repository: productionRepo });
  ProductionService.addProductionLocation({ productionItemId: prodItem.id, stockLocationId: locationId, repository: productionRepo });

  const recipe = ProductionService.createRecipe({
    productionItemId: prodItem.id,
    name: 'Resep Standar Ayam Goreng',
    repository: productionRepo
  });
  ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepo });

  const recipeVersion = ProductionService.createRecipeVersion({
    recipeId: recipe.id,
    plannedYieldQuantity: 1,
    yieldUomId: 'uom_pcs',
    components: [
      { material_id: rawChickenMatId, planned_quantity: 0.2, planned_uom_id: 'uom_kg', sort_order: 0 }
    ],
    repository: productionRepo
  });
  ProductionService.publishRecipeVersion({ recipeVersionId: recipeVersion.recipe_version.id, repository: productionRepo });

  // Setup express test app
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'usr_audit_owner', role: 'owner', branchId: branchId, organization_id: orgId };
    req.brand_id = brandId;
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
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // =========================================================================
    // SCENARIO 1: Beli dan terima 12 botol air mineral
    // Must increment ready-to-sell stock by 12, without creating fake materials
    // =========================================================================
    await t.test('Scenario 1: Beli dan terima 12 botol air mineral', async () => {
      const res = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'stl_water_' + Date.now(),
          cash_advance: 100000,
          items: [{
            item_type: 'PRODUCT',
            product_id: mineralWaterId,
            material_id: mineralWaterId,
            quantity: 12,
            unit_price: 2500,
            name: 'Air Mineral 600ml'
          }]
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify product_stock_balances
      const psb = db.prepare('SELECT quantity, moving_average_unit_cost, carrying_value FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, mineralWaterId);
      assert.ok(psb, 'product_stock_balances must exist for mineral water');
      assert.equal(Number(psb.quantity), 12);
      assert.equal(Number(psb.moving_average_unit_cost), 2500);

      // Verify branch_product_inventory
      const bpi = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      assert.ok(bpi, 'branch_product_inventory must exist');
      assert.equal(Number(bpi.stock_qty), 12);

      // Verify NO fake material was created
      const fakeMat = db.prepare("SELECT * FROM materials WHERE organization_id = ? AND name LIKE '%Air Mineral%'").get(orgId);
      assert.equal(fakeMat, undefined, 'Must NEVER create a fake material for retail products');
    });

    // =========================================================================
    // SCENARIO 2: Jual 3 botol air mineral
    // Must reduce product stock to 9 across all ledgers & /inventory screen
    // =========================================================================
    await t.test('Scenario 2: Jual 3 botol air mineral', async () => {
      const saleResult = OrderPlacementService.deductComposedStock({
        order: {
          id: 'ord_water_1',
          branch_id: branchId
        },
        requirements: [{
          product_id: mineralWaterId,
          product_name: 'Air Mineral 600ml',
          quantity: 3
        }],
        sourceType: 'ORDER',
        referenceId: 'pos_ref_water_1',
        actorId: 'cashier_audit'
      });

      assert.equal(saleResult.success, true);

      // Check canonical product_stock_balances
      const psb = db.prepare('SELECT quantity FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, mineralWaterId);
      assert.equal(Number(psb.quantity), 9, 'product_stock_balances must be 9');

      // Check operational branch_product_inventory
      const bpi = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      assert.equal(Number(bpi.stock_qty), 9, 'branch_product_inventory must be in lockstep at 9');

      // Check GET /admin/branches/:id/inventory endpoint
      const invRes = await fetch(`${baseUrl}/admin/branches/${branchId}/inventory`);
      assert.equal(invRes.status, 200);
      const invData = await invRes.json();
      const item = invData.inventory.find(i => i.product_id === mineralWaterId);
      assert.ok(item, 'Mineral water must be in inventory endpoint');
      assert.equal(Number(item.stock), 9, 'GET /inventory must return 9');
    });

    // =========================================================================
    // SCENARIO 3: Beli bahan ayam dan selesaikan batch masak 20 porsi
    // Raw materials decrease by recipe; cooked chicken portions increase by 20
    // =========================================================================
    await t.test('Scenario 3: Beli bahan ayam dan selesaikan batch masak 20 porsi', async () => {
      // 3a. Beli 10 kg ayam mentah @ 40,000/kg
      const settleMatRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'stl_chicken_' + Date.now(),
          cash_advance: 500000,
          items: [{
            item_type: 'MATERIAL',
            material_id: rawChickenMatId,
            quantity: 10,
            unit_price: 40000,
            name: 'Daging Ayam Mentah'
          }]
        })
      });
      assert.equal(settleMatRes.status, 200);

      const msbBefore = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(locationId, rawChickenMatId);
      assert.equal(Number(msbBefore.quantity_base), 10);

      // 3b. Masak 20 porsi ayam goreng (butuh 20 * 0.2 = 4 kg ayam mentah)
      const cookRes = await fetch(`${baseUrl}/admin/branches/${branchId}/inventory/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: cookedChickenId,
          portions: 20,
          notes: 'Batch Ayam Pagi'
        })
      });

      assert.equal(cookRes.status, 200);
      const cookData = await cookRes.json();
      assert.equal(cookData.success, true);
      assert.equal(cookData.portions_prepared, 20);

      // Check material decreased by 4 kg -> remaining 6 kg
      const msbAfter = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(locationId, rawChickenMatId);
      assert.equal(Number(msbAfter.quantity_base), 6);

      // Check cooked chicken portions increased to 20
      const psbChicken = db.prepare('SELECT quantity FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, cookedChickenId);
      assert.equal(Number(psbChicken.quantity), 20);

      const bpiChicken = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, cookedChickenId);
      assert.equal(Number(bpiChicken.stock_qty), 20);
    });

    // =========================================================================
    // SCENARIO 4: Jual 5 porsi dari hasil batch
    // Cooked portions become 15; raw materials are NOT deducted again!
    // =========================================================================
    await t.test('Scenario 4: Jual 5 porsi dari hasil batch', async () => {
      const saleResult = OrderPlacementService.deductComposedStock({
        order: {
          id: 'ord_chicken_1',
          branch_id: branchId
        },
        requirements: [{
          product_id: cookedChickenId,
          product_name: 'Ayam Goreng Porsi',
          quantity: 5
        }],
        sourceType: 'ORDER',
        referenceId: 'pos_ref_chicken_1',
        actorId: 'cashier_audit'
      });

      assert.equal(saleResult.success, true);

      // Cooked portions must decrease from 20 to 15 in both ledgers
      const psbChicken = db.prepare('SELECT quantity FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, cookedChickenId);
      assert.equal(Number(psbChicken.quantity), 15);

      const bpiChicken = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, cookedChickenId);
      assert.equal(Number(bpiChicken.stock_qty), 15);

      // Raw material must REMAIN 6 kg (no double deduction)
      const msbAfter = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(locationId, rawChickenMatId);
      assert.equal(Number(msbAfter.quantity_base), 6, 'Raw material must NEVER be deducted again on cooked portion sale');
    });

    // =========================================================================
    // SCENARIO 5: PO sedang dalam perjalanan
    // Checklist reduces suggested qty by on_order_base_qty
    // =========================================================================
    await t.test('Scenario 5: PO sedang dalam perjalanan mengurangi rekomendasi belanja', async () => {
      // Current stock of raw chicken is 6 kg.
      // Set minimum threshold = 18 kg, target = 20 kg.
      // Without PO, deficit is 20 - 6 = 14 kg.
      // With 10 kg PO in-transit, effective stock is 6 + 10 = 16 kg <= 18 kg (low).
      // Suggested qty is 20 - 16 = 4 kg.
      db.prepare(`
        INSERT OR REPLACE INTO inventory_reorder_policies (stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity)
        VALUES (?, 'MATERIAL', ?, 18, 20)
      `).run(locationId, rawChickenMatId);

      // Without PO, deficit is target (20) - current (6) = 14 kg.
      // Now create a Supplier PO for 10 kg in-transit (ORDERED).
      const supplierId = 'sup_test_' + Date.now();
      const supMatId = 'sm_test_' + Date.now();
      const poId = 'po_test_' + Date.now();

      db.prepare("INSERT INTO suppliers (id, organization_id, supplier_code, name, status) VALUES (?, ?, 'SUP-1', 'PT Supplier Ayam', 'ACTIVE')").run(supplierId, orgId);
      db.prepare("INSERT INTO supplier_materials (id, supplier_id, material_id) VALUES (?, ?, ?)").run(supMatId, supplierId, rawChickenMatId);
      db.prepare(`
        INSERT INTO purchase_orders (id, organization_id, supplier_id, destination_stock_location_id, status)
        VALUES (?, ?, ?, ?, 'ORDERED')
      `).run(poId, orgId, supplierId, locationId);
      db.prepare(`
        INSERT INTO purchase_order_lines (id, purchase_order_id, supplier_material_id, ordered_purchase_quantity, purchase_uom_id, resolved_base_quantity, unit_price, currency_code, base_quantity_per_purchase_unit, received_base_quantity)
        VALUES ('pol_1', ?, ?, 10, 'uom_kg', 10, 40000, 'IDR', 1, 0)
      `).run(poId, supMatId);

      // Call GET /purchasing/checklist
      const checkRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/checklist`);
      assert.equal(checkRes.status, 200);
      const checkData = await checkRes.json();
      const chickenItem = checkData.items.find(i => i.material_id === rawChickenMatId);
      assert.ok(chickenItem, 'Raw chicken must be in checklist');
      assert.equal(chickenItem.current_stock, 6);
      assert.equal(chickenItem.on_order_qty, 10, 'Must recognize 10 kg in-transit PO');
      assert.equal(chickenItem.effective_stock, 16, 'Effective stock must be 6 + 10 = 16 kg');
      // Target is 20, effective stock is 16 -> suggested quantity is 4 kg (not 14 kg!)
      assert.equal(chickenItem.suggested_qty, 4, 'Suggested quantity must be 20 - 16 = 4 kg');
    });

    // =========================================================================
    // SCENARIO 6: Request penerimaan diulang (Idempotency)
    // Re-posting with same idempotency key must not double-post stock or cost
    // =========================================================================
    await t.test('Scenario 6: Request penerimaan diulang tidak menambah stok dua kali', async () => {
      const key = 'stl_idempotent_' + Date.now();

      // First settle call
      const res1 = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: key,
          cash_advance: 50000,
          items: [{
            item_type: 'PRODUCT',
            product_id: mineralWaterId,
            quantity: 5,
            unit_price: 2500,
            name: 'Air Mineral 600ml'
          }]
        })
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.equal(data1.success, true);

      const bpiAfter1 = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      const stock1 = Number(bpiAfter1.stock_qty);

      // Repeat settle call with the exact same idempotency key
      const res2 = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: key,
          cash_advance: 50000,
          items: [{
            item_type: 'PRODUCT',
            product_id: mineralWaterId,
            quantity: 5,
            unit_price: 2500,
            name: 'Air Mineral 600ml'
          }]
        })
      });

      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.idempotent, true, 'Server must return idempotent: true');

      const bpiAfter2 = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      assert.equal(Number(bpiAfter2.stock_qty), stock1, 'Stock must NOT be incremented twice');
    });

    // =========================================================================
    // SCENARIO 7: BM memakai ID material milik organisasi lain
    // Must reject request with 403 before any mutation occurs
    // =========================================================================
    await t.test('Scenario 7: Penolakan material ID lintas organisasi', async () => {
      const foreignRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'stl_foreign_' + Date.now(),
          cash_advance: 50000,
          items: [{
            item_type: 'MATERIAL',
            material_id: foreignMatId,
            quantity: 5,
            unit_price: 10000,
            name: 'Bahan Asing'
          }]
        })
      });

      assert.equal(foreignRes.status, 403, 'Must reject cross-organization material with 403');
      const data = await foreignRes.json();
      assert.equal(data.error, 'CROSS_ORGANIZATION_MATERIAL_FORBIDDEN');
    });

    // =========================================================================
    // SCENARIO 8: Konversi satuan tidak tersedia
    // ReplenishmentService must reject invalid conversion instead of silent 1:1
    // =========================================================================
    await t.test('Scenario 8: Konversi satuan tidak kompatibel memicu error', async () => {
      const badProdId = 'prod_bad_' + Date.now();
      db.prepare(`
        INSERT INTO products (id, brand_id, name, slug, sku, price, is_active, product_stock_uom_id)
        VALUES (?, ?, 'Bad Product', ?, 'SKU-BAD', 10000, 1, 'uom_pcs')
      `).run(badProdId, brandId, 'bad-prod-' + Date.now());

      const badProdItem = ProductionService.createProductionItem({
        organizationId: orgId,
        outputProductId: badProdId,
        productionItemCode: 'PRD-BAD-' + Date.now(),
        name: 'Bad Production',
        repository: productionRepo
      });
      ProductionService.activateProductionItem({ productionItemId: badProdItem.id, repository: productionRepo });
      ProductionService.addProductionLocation({ productionItemId: badProdItem.id, stockLocationId: locationId, repository: productionRepo });

      const badRecipe = ProductionService.createRecipe({
        productionItemId: badProdItem.id,
        name: 'Bad Recipe',
        repository: productionRepo
      });
      ProductionService.activateRecipe({ recipeId: badRecipe.id, repository: productionRepo });

      const badRecipeVersion = ProductionService.createRecipeVersion({
        recipeId: badRecipe.id,
        plannedYieldQuantity: 1,
        yieldUomId: 'uom_pcs',
        components: [
          { material_id: rawChickenMatId, planned_quantity: 5, planned_uom_id: 'uom_kg', sort_order: 0 }
        ],
        repository: productionRepo
      });
      ProductionService.publishRecipeVersion({ recipeVersionId: badRecipeVersion.recipe_version.id, repository: productionRepo });

      // Simulate incompatible UOM in component
      db.prepare("UPDATE recipe_components SET planned_uom_id = 'uom_pcs' WHERE recipe_version_id = ?").run(badRecipeVersion.recipe_version.id);

      assert.throws(() => {
        ReplenishmentService.calculateReplenishment({
          organizationId: orgId,
          stockLocationId: locationId
        });
      }, /UOM_CONVERSION_FAILED|UOM_CATEGORY_MISMATCH/, 'Must fail explicitly when UOM conversion is incompatible, never fallback 1:1');
    });

    // =========================================================================
    // SCENARIO 9: Penyesuaian stok produk (opname) menyelaraskan saldo kanonis dan operasional
    // =========================================================================
    await t.test('Scenario 9: Penyesuaian stok produk (opname) menyelaraskan saldo kanonis dan operasional', async () => {
      // Current stock before adjustment was 14 (12 - 3 + 5 from Scenario 6)
      const bpiBefore = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      const prevStock = Number(bpiBefore.stock_qty); // 14

      const adjustRes = await fetch(`${baseUrl}/admin/branches/${branchId}/inventory/${mineralWaterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movement_type: 'audit_adjustment',
          quantity: 2,
          notes: 'Opname fisik audit botol air mineral'
        })
      });

      assert.equal(adjustRes.status, 200, 'Adjustment must succeed');
      const adjustData = await adjustRes.json();
      assert.equal(adjustData.success, true);

      // Verify both ledgers match: 14 + 2 = 16
      const expectedAdjusted = prevStock + 2;
      const bpi = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      assert.equal(Number(bpi.stock_qty), expectedAdjusted, 'Operational stock must be ' + expectedAdjusted);

      const psb = db.prepare('SELECT quantity FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, mineralWaterId);
      assert.equal(Number(psb.quantity), expectedAdjusted, 'Canonical stock must be ' + expectedAdjusted);

      // Verify purchasing checklist reads 16
      const chkRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/checklist`);
      assert.equal(chkRes.status, 200);
      const chkData = await chkRes.json();
      const waterItem = chkData.items.find(i => i.material_id === mineralWaterId || i.product_id === mineralWaterId);
      assert.ok(waterItem, 'Mineral water must be in checklist');
      assert.equal(waterItem.current_stock, expectedAdjusted, 'Checklist current_stock must read canonical ' + expectedAdjusted);

      // Deduct 1 via sale
      const saleResult = OrderPlacementService.deductComposedStock({
        order: { branch_id: branchId, id: 'ord_opname_sale' },
        requirements: [{
          product_id: mineralWaterId,
          product_name: 'Air Mineral 600ml',
          quantity: 1
        }],
        referenceId: 'ref_opname_sale',
        actorId: 'kasir_opname',
        notes: 'Penjualan setelah opname'
      });
      assert.equal(saleResult.success, true);

      // Verify lockstep: both must be expectedAdjusted - 1
      const expectedAfterSale = expectedAdjusted - 1;
      const bpiAfter = db.prepare('SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?').get(branchId, mineralWaterId);
      const psbAfter = db.prepare('SELECT quantity FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?').get(locationId, mineralWaterId);
      assert.equal(Number(bpiAfter.stock_qty), expectedAfterSale, 'Operational stock must be exactly ' + expectedAfterSale);
      assert.equal(Number(psbAfter.quantity), expectedAfterSale, 'Canonical stock must be exactly ' + expectedAfterSale);
    });
  } finally {
    server.close();
  }
});
