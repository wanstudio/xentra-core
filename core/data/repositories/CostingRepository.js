'use strict';

const DataAccess = require('../DataAccess');

class CostingRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findMenu({ brandId, menuId }) {
    return this.db.queryOne(
      'SELECT id, brand_id, title_id, status, selling_price FROM menus WHERE id = ? AND brand_id = ?',
      [menuId, brandId]
    );
  }

  listMenuItems({ brandId, menuId }) {
    return this.db.queryMany(
      'SELECT mi.menu_id, mi.product_id, mi.quantity, mi.sort_order, p.name AS product_name, p.sku, p.is_active FROM menu_items mi JOIN menus m ON m.id = mi.menu_id AND m.brand_id = ? JOIN products p ON p.id = mi.product_id AND p.brand_id = m.brand_id WHERE mi.menu_id = ? ORDER BY mi.sort_order, mi.product_id',
      [brandId, menuId]
    );
  }

  findProduct(productId) {
    return this.db.queryOne(
      'SELECT id, brand_id, name, sku, product_stock_uom_id, is_active FROM products WHERE id = ?',
      [productId]
    );
  }

  findProductBalance({ stockLocationId, productId }) {
    return this.db.queryOne(
      'SELECT stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?',
      [stockLocationId, productId]
    );
  }

  findProductionRoute({ productId, stockLocationId }) {
    return this.db.queryMany(
      "SELECT pi.id, pi.organization_id, pi.output_product_id, pi.status, pil.stock_location_id FROM production_items pi JOIN production_item_locations pil ON pil.production_item_id = pi.id WHERE pi.output_product_id = ? AND pil.stock_location_id = ? AND pi.status = 'ACTIVE' AND pil.is_active = 1 ORDER BY pi.id",
      [productId, stockLocationId]
    );
  }

  findRecipeByProductionItemId(productionItemId) {
    return this.db.queryOne(
      'SELECT id, production_item_id, status FROM recipes WHERE production_item_id = ?',
      [productionItemId]
    );
  }

  findPublishedRecipeVersion(recipeId) {
    return this.db.queryOne(
      "SELECT id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id FROM recipe_versions WHERE recipe_id = ? AND status = 'PUBLISHED' ORDER BY version_number DESC LIMIT 1",
      [recipeId]
    );
  }

  findRecipeComponents(recipeVersionId) {
    return this.db.queryMany(
      'SELECT id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order FROM recipe_components WHERE recipe_version_id = ? ORDER BY sort_order, id',
      [recipeVersionId]
    );
  }

  findMaterial(materialId) {
    return this.db.queryOne(
      'SELECT id, organization_id, base_uom_id, status FROM materials WHERE id = ?',
      [materialId]
    );
  }

  findMaterialBalance({ stockLocationId, materialId }) {
    return this.db.queryOne(
      'SELECT stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?',
      [stockLocationId, materialId]
    );
  }

  findLatestMaterialMovement({ stockLocationId, materialId }) {
    return this.db.queryOne(
      "SELECT id, currency_code, posting_timestamp, valuation_version FROM material_stock_movements WHERE stock_location_id = ? AND material_id = ? ORDER BY valuation_version DESC LIMIT 1",
      [stockLocationId, materialId]
    );
  }

  findLatestProductionCostSnapshot({ productId, stockLocationId }) {
    return this.db.queryOne(
      "SELECT pcs.id, pcs.production_batch_id, pcs.production_posting_id, pcs.actual_material_cost, pcs.actual_output_quantity, pcs.production_output_unit_cost, pcs.currency_code, pcs.cost_availability_status, pcs.created_at FROM production_cost_snapshots pcs JOIN production_batches pb ON pb.id = pcs.production_batch_id JOIN production_items pi ON pi.id = pb.production_item_id WHERE pi.output_product_id = ? AND pb.output_stock_location_id = ? AND pcs.cost_availability_status = 'AVAILABLE' ORDER BY pcs.created_at DESC, pcs.id DESC LIMIT 1",
      [productId, stockLocationId]
    );
  }

  findUom(uomId) {
    return this.db.queryOne(
      'SELECT id, category_id, code, name, conversion_factor, allows_fraction, quantity_precision, is_active FROM uoms WHERE id = ?',
      [uomId]
    );
  }
}

module.exports = CostingRepository;
