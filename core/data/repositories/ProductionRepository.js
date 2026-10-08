'use strict';

const DataAccess = require('../DataAccess');

class ProductionRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
  }

  findProductionItem(id) {
    return this.db.queryOne(
      'SELECT * FROM production_items WHERE id = ?',
      [id]
    );
  }

  findProductionItemByProductAndLocation(productId, stockLocationId) {
    return this.db.queryMany(
      `SELECT pi.id, pi.organization_id, pi.output_product_id, pi.production_item_code,
              pi.name, pi.status, pil.stock_location_id
         FROM production_items pi
         JOIN production_item_locations pil ON pil.production_item_id = pi.id
        WHERE pi.output_product_id = ?
          AND pil.stock_location_id = ?
          AND pi.status = 'ACTIVE'
          AND pil.is_active = 1
        ORDER BY pi.id`,
      [productId, stockLocationId]
    );
  }

  findRecipeByProductionItemId(productionItemId) {
    return this.db.queryOne(
      'SELECT * FROM recipes WHERE production_item_id = ?',
      [productionItemId]
    );
  }

  findRecipeVersion(id) {
    return this.db.queryOne(
      'SELECT * FROM recipe_versions WHERE id = ?',
      [id]
    );
  }

  findPublishedRecipeVersion(recipeId) {
    return this.db.queryOne(
      "SELECT * FROM recipe_versions WHERE recipe_id = ? AND status = 'PUBLISHED' ORDER BY version_number DESC LIMIT 1",
      [recipeId]
    );
  }

  findRecipeComponents(recipeVersionId) {
    return this.db.queryMany(
      'SELECT * FROM recipe_components WHERE recipe_version_id = ? ORDER BY sort_order, id',
      [recipeVersionId]
    );
  }

  findProductionBatch(id) {
    return this.db.queryOne(
      'SELECT * FROM production_batches WHERE id = ?',
      [id]
    );
  }

  findProductionBatchByPostingId(postingId) {
    return this.db.queryOne(
      'SELECT * FROM production_batches WHERE production_posting_id = ?',
      [postingId]
    );
  }

  findProductionBatchConsumptions(batchId) {
    return this.db.queryMany(
      'SELECT * FROM production_batch_material_consumptions WHERE production_batch_id = ? ORDER BY id',
      [batchId]
    );
  }

  findProductionCostSnapshot(batchId) {
    return this.db.queryOne(
      'SELECT * FROM production_cost_snapshots WHERE production_batch_id = ?',
      [batchId]
    );
  }

  findProductionCostSnapshotLines(snapshotId) {
    return this.db.queryMany(
      'SELECT * FROM production_cost_snapshot_lines WHERE production_cost_snapshot_id = ? ORDER BY id',
      [snapshotId]
    );
  }

  insertProductionItem({ id, organizationId, outputProductId, productionItemCode, name, status = 'DRAFT', createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO production_items (id, organization_id, output_product_id, production_item_code, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, organizationId, outputProductId, productionItemCode, name, status, createdAt, updatedAt]
    );
  }

  insertProductionItemLocation({ id, productionItemId, stockLocationId, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO production_item_locations (id, production_item_id, stock_location_id, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      [id, productionItemId, stockLocationId, createdAt, updatedAt]
    );
  }

  insertRecipe({ id, productionItemId, name, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO recipes (id, production_item_id, name, status, created_at, updated_at) VALUES (?, ?, ?, \'DRAFT\', ?, ?)',
      [id, productionItemId, name, createdAt, updatedAt]
    );
  }

  insertRecipeVersion({ id, recipeId, versionNumber, plannedYieldQuantity, yieldUomId, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id, created_at, updated_at) VALUES (?, ?, ?, \'DRAFT\', ?, ?, ?, ?)',
      [id, recipeId, versionNumber, plannedYieldQuantity, yieldUomId, createdAt, updatedAt]
    );
  }

  insertRecipeComponent({ id, recipeVersionId, materialId, plannedQuantity, plannedUomId, sortOrder }) {
    return this.db.execute(
      'INSERT INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, recipeVersionId, materialId, plannedQuantity, plannedUomId, sortOrder]
    );
  }

  insertProductionBatch({ id, organizationId, productionItemId, recipeVersionId, productionStockLocationId, inputStockLocationId, outputStockLocationId, plannedOutputQuantity, createdBy, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO production_batches (id, organization_id, production_item_id, recipe_version_id, production_stock_location_id, input_stock_location_id, output_stock_location_id, planned_output_quantity, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, organizationId, productionItemId, recipeVersionId, productionStockLocationId, inputStockLocationId, outputStockLocationId, plannedOutputQuantity, createdBy, createdAt, updatedAt]
    );
  }

  updateProductionItemStatus({ id, status, updatedAt }) {
    return this.db.execute(
      'UPDATE production_items SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id]
    );
  }

  updateRecipeStatus({ id, status, updatedAt }) {
    return this.db.execute(
      'UPDATE recipes SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id]
    );
  }

  publishRecipeVersion({ id, updatedAt, publishedAt }) {
    return this.db.execute(
      "UPDATE recipe_versions SET status = 'PUBLISHED', published_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'",
      [publishedAt, updatedAt, id]
    );
  }

  updateBatchStatus({ id, status, actorField, actorId, timestamp, reason = null }) {
    const allowedActorFields = new Set(['started_by', 'completed_by', 'cancelled_by']);
    if (!allowedActorFields.has(actorField)) throw new Error('INVALID_ACTOR_FIELD');
    let sql = 'UPDATE production_batches SET status = ?, updated_at = ?';
    const params = [status, timestamp];
    if (actorField === 'started_by') {
      sql += ', started_at = ?, started_by = ?';
      params.push(timestamp, actorId);
    } else if (actorField === 'completed_by') {
      sql += ', completed_at = ?, completed_by = ?';
      params.push(timestamp, actorId);
    } else {
      sql += ', cancelled_at = ?, cancelled_by = ?, cancelled_reason = ?';
      params.push(timestamp, actorId, reason);
    }
    sql += ' WHERE id = ?';
    params.push(id);
    return this.db.execute(sql, params);
  }

  setBatchActualOutput({ id, actualOutputQuantity, productionPostingId, timestamp }) {
    return this.db.execute(
      'UPDATE production_batches SET actual_output_quantity = ?, production_posting_id = ?, updated_at = ? WHERE id = ?',
      [actualOutputQuantity, productionPostingId, timestamp, id]
    );
  }

  insertProductionBatchConsumption({
    id,
    productionBatchId,
    materialId,
    inputStockLocationId,
    sourceUomId,
    actualSourceQuantity,
    actualBaseQuantity,
    resolvedUnitCost,
    totalCost,
    currencyCode,
    inventoryMovementId,
    createdAt
  }) {
    return this.db.execute(
      'INSERT INTO production_batch_material_consumptions (id, production_batch_id, material_id, input_stock_location_id, source_uom_id, actual_source_quantity, actual_base_quantity, resolved_unit_cost, total_cost, currency_code, inventory_movement_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, productionBatchId, materialId, inputStockLocationId, sourceUomId, actualSourceQuantity, actualBaseQuantity, resolvedUnitCost, totalCost, currencyCode, inventoryMovementId, createdAt]
    );
  }

  insertProductionCostSnapshot({ id, productionBatchId, productionPostingId, actualMaterialCost, actualOutputQuantity, productionOutputUnitCost, currencyCode, status = 'AVAILABLE', createdAt }) {
    return this.db.execute(
      'INSERT INTO production_cost_snapshots (id, production_batch_id, production_posting_id, actual_material_cost, actual_output_quantity, production_output_unit_cost, currency_code, cost_availability_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, productionBatchId, productionPostingId, actualMaterialCost, actualOutputQuantity, productionOutputUnitCost, currencyCode, status, createdAt]
    );
  }

  insertProductionCostSnapshotLine({ id, productionCostSnapshotId, materialId, inputStockLocationId, actualBaseQuantity, resolvedUnitCost, totalCost, currencyCode, inventoryMovementId, createdAt }) {
    return this.db.execute(
      'INSERT INTO production_cost_snapshot_lines (id, production_cost_snapshot_id, material_id, input_stock_location_id, actual_base_quantity, resolved_unit_cost, total_cost, currency_code, inventory_movement_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, productionCostSnapshotId, materialId, inputStockLocationId, actualBaseQuantity, resolvedUnitCost, totalCost, currencyCode, inventoryMovementId, createdAt]
    );
  }
}

module.exports = ProductionRepository;
