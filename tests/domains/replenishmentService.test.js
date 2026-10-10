'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ProcurementService, ReplenishmentService } = require('../../domains/procurement');
const { MaterialService } = require('../../domains/material');

const ORG = 'org_replenishment_test';
const BRAND = 'brand_replenishment_test';
const BRANCH = 'branch_replenishment_test';
const LOCATION = 'loc_replenishment_test';

let chickenMaterialId;
let chiliMaterialId;
let geprekProductId;
let recipeId;
let recipeVersionId;
let supplierId;
let supplierChickenId;
let supplierPackId;

test.before(async () => {
  await db.readyPromise;

  // 1. Entities dasar: Org, Brand, Branch, Stock Location
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Replenishment Test Org', 'replenishment-test-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Replenishment Test Brand', 'replenishment-test-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    BRANCH, BRAND, 'Replenishment Test Branch', 'replenishment-test-branch',
    '628111111199', 'Test', -5.4, 105.2
  );
  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(LOCATION, ORG, BRANCH, 'LOC-REP-1', 'Dapur Cabang Test', 'BRANCH');

  // 2. Materials: Ayam Mentah & Cabai Rawit (base uom: uom_kg)
  const chicken = MaterialService.createMaterial({
    organizationId: ORG,
    materialCode: 'RAW-AYAM-01',
    name: 'Ayam Mentah',
    baseUomId: 'uom_kg',
    status: 'ACTIVE'
  });
  chickenMaterialId = chicken.id;

  const chili = MaterialService.createMaterial({
    organizationId: ORG,
    materialCode: 'RAW-CBI-01',
    name: 'Cabai Rawit',
    baseUomId: 'uom_kg',
    status: 'ACTIVE'
  });
  chiliMaterialId = chili.id;

  // 3. Product Jadi: Ayam Geprek Siap Jual
  geprekProductId = 'prod_ayam_geprek_rep_test';
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, name, slug, sku, price, is_active, product_stock_uom_id)
    VALUES (?, ?, ?, 'ayam-geprek-rep-test', ?, ?, 1, 'uom_pcs')
  `).run(geprekProductId, BRAND, 'Ayam Geprek', 'SKU-GEPREK-01', 25000);

  // 4. Saldo dan Kebijakan Reorder Produk:
  // Current stock = 5 porsi, Min stock = 5 porsi, Target stock = 20 porsi -> Defisit = 15 porsi!
  db.prepare(`
    INSERT OR REPLACE INTO product_stock_balances (stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, updated_at)
    VALUES (?, ?, 5, 50000, 10000, 'AVAILABLE', datetime('now'))
  `).run(LOCATION, geprekProductId);

  db.prepare(`
    INSERT OR REPLACE INTO inventory_reorder_policies (stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity, created_at, updated_at)
    VALUES (?, 'PRODUCT', ?, 5, 20, datetime('now'), datetime('now'))
  `).run(LOCATION, geprekProductId);

  // 5. Saldo Bahan Baku Aktual:
  // Ayam Mentah ada 1 kg di dapur
  db.prepare(`
    INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, updated_at)
    VALUES (?, ?, 1, 35000, 35000, 'AVAILABLE', datetime('now'))
  `).run(LOCATION, chickenMaterialId);

  // 6. Resep Masakan:
  // 20 porsi Ayam Geprek butuh 4 kg Ayam Mentah dan 0.6 kg Cabai Rawit
  const prodItem = db.prepare(`
    INSERT INTO production_items (id, organization_id, output_product_id, production_item_code, name, status, created_at, updated_at)
    VALUES ('pi_geprek_01', ?, ?, 'PI-GEPREK', 'Ayam Geprek Batch', 'ACTIVE', datetime('now'), datetime('now'))
    RETURNING id
  `).get(ORG, geprekProductId);

  const recipe = db.prepare(`
    INSERT INTO recipes (id, production_item_id, name, status, created_at, updated_at)
    VALUES ('rec_geprek_01', ?, 'Resep Standar Ayam Geprek', 'ACTIVE', datetime('now'), datetime('now'))
    RETURNING id
  `).get(prodItem.id);
  recipeId = recipe.id;

  const version = db.prepare(`
    INSERT INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id, created_at, updated_at)
    VALUES ('rv_geprek_v1', ?, 1, 'PUBLISHED', 20, 'uom_pcs', datetime('now'), datetime('now'))
    RETURNING id
  `).get(recipeId);
  recipeVersionId = version.id;

  // Komponen resep:
  // - Ayam Mentah: 4 kg per 20 porsi
  // - Cabai: 0.6 kg per 20 porsi
  db.prepare(`
    INSERT INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order)
    VALUES ('rc_01', ?, ?, 4, 'uom_kg', 1)
  `).run(recipeVersionId, chickenMaterialId);
  db.prepare(`
    INSERT INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order)
    VALUES ('rc_02', ?, ?, 0.6, 'uom_kg', 2)
  `).run(recipeVersionId, chiliMaterialId);

  // 7. Supplier & Kemasan Supplier (Supplier Material Pack):
  // Ayam: 1 pack = 2.5 kg, Minimum Order Quantity (MOQ) = 2 pack
  const supplier = ProcurementService.createSupplier({
    organizationId: ORG,
    supplierCode: 'SUP-AYAM-01',
    name: 'PT Unggas Barokah',
    status: 'ACTIVE'
  });
  supplierId = supplier.id;

  const supMat = ProcurementService.createSupplierMaterial({
    supplierId,
    materialId: chickenMaterialId,
    supplierItemCode: 'PACK-AYAM-FROZEN'
  });
  supplierChickenId = supMat.id;

  const pack = ProcurementService.createSupplierMaterialPack({
    supplierMaterialId: supplierChickenId,
    name: 'Pack Ayam 2.5 kg',
    contentQuantityBase: 2.5,
    contentUomId: 'uom_kg',
    unitPrice: 100000,
    minimumOrderQuantity: 2,
    currencyCode: 'IDR'
  });
  supplierPackId = pack.id;
});

test.after(() => {
  try {
    db.prepare('DELETE FROM supplier_material_packs WHERE id = ?').run(supplierPackId);
    db.prepare('DELETE FROM supplier_materials WHERE id = ?').run(supplierChickenId);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplierId);
    db.prepare('DELETE FROM recipe_components WHERE recipe_version_id = ?').run(recipeVersionId);
    db.prepare('DELETE FROM recipe_versions WHERE id = ?').run(recipeVersionId);
    db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
    db.prepare('DELETE FROM production_items WHERE organization_id = ?').run(ORG);
    db.prepare('DELETE FROM inventory_reorder_policies WHERE stock_location_id = ?').run(LOCATION);
    db.prepare('DELETE FROM product_stock_balances WHERE stock_location_id = ?').run(LOCATION);
    db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ?').run(LOCATION);
    db.prepare('DELETE FROM products WHERE id = ?').run(geprekProductId);
    db.prepare('DELETE FROM materials WHERE organization_id = ?').run(ORG);
    db.prepare('DELETE FROM stock_locations WHERE id = ?').run(LOCATION);
    db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
    db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
  } catch (_) {}
});

test('ReplenishmentService calculates precise recipe explosion, deducts physical balance, and applies supplier pack MOQ', () => {
  const result = ReplenishmentService.calculateReplenishment({
    organizationId: ORG,
    stockLocationId: LOCATION
  });

  assert.equal(result.organization_id, ORG);
  assert.equal(result.stock_location_id, LOCATION);
  assert.ok(result.suggestions.length >= 1);

  // Cari saran untuk Ayam Mentah
  const chickenSuggestion = result.suggestions.find(s => s.material_id === chickenMaterialId);
  assert.ok(chickenSuggestion, 'Ayam Mentah harus masuk dalam saran pengadaan');

  // Defisit menu = 20 - 5 = 15 porsi.
  // Rasio resep ayam = 4 kg / 20 porsi = 0.2 kg/porsi.
  // Gross needed = 15 * 0.2 = 3.0 kg.
  assert.equal(chickenSuggestion.gross_quantity_needed, 3);

  // Stok fisik saat ini = 1 kg.
  assert.equal(chickenSuggestion.current_stock, 1);
  assert.equal(chickenSuggestion.effective_stock, 1);

  // Net Deficit = 3 - 1 = 2 kg.
  assert.equal(chickenSuggestion.net_deficit_quantity, 2);

  // Pack supplier = 2.5 kg.
  // Packs needed = ceil(2 / 2.5) = 1 pack.
  // Namun MOQ supplier = 2 pack!
  // Maka saran pembelian = max(1, 2) = 2 pack!
  assert.equal(chickenSuggestion.recommended_purchase_packs, 2);
  assert.equal(chickenSuggestion.recommended_purchase_base_quantity, 5); // 2 pack * 2.5 kg = 5 kg

  // Estimasi biaya = 2 pack * Rp 100.000 = Rp 200.000
  assert.equal(chickenSuggestion.estimated_cost, 200000);
  assert.equal(chickenSuggestion.supplier.minimum_order_quantity, 2);
  assert.equal(chickenSuggestion.supplier.supplier_name, 'PT Unggas Barokah');
});

test('ProcurementService.createPurchaseOrder rejects orders below supplier pack MOQ', () => {
  assert.throws(() => {
    ProcurementService.createPurchaseOrder({
      organizationId: ORG,
      supplierId,
      destinationStockLocationId: LOCATION,
      lines: [{
        supplier_material_id: supplierChickenId,
        supplier_pack_id: supplierPackId,
        ordered_purchase_quantity: 1 // MOQ adalah 2! Harus ditolak!
      }]
    });
  }, (err) => {
    assert.equal(err.message, 'SUPPLIER_PACK_MOQ_NOT_MET');
    return true;
  });
});
