'use strict';

const crypto = require('crypto');
const ProductionRepository = require('../../../core/data/repositories/ProductionRepository');
const MaterialRepository = require('../../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../../core/data/repositories/UomRepository');
const InventoryRepository = require('../../../core/data/repositories/InventoryRepository');
const UomConversionService = require('../../uom/services/UomConversionService');
const InventoryProductionPostingService = require('../../inventory/services/InventoryProductionPostingService');

const productionRepository = new ProductionRepository();
const materialRepository = new MaterialRepository();
const uomRepository = new UomRepository();
const inventoryRepository = new InventoryRepository();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, code) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw fail(code);
  return result;
}

function positive(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw fail(code);
  return n;
}

function currencyCode(value) {
  const code = text(value, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw fail('CURRENCY_BASIS_UNRESOLVED');
  return code;
}

function id(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function assertProductStockUom(productId, repo = inventoryRepository) {
  const product = repo.db.queryOne(
    'SELECT id, brand_id, product_stock_uom_id, is_active FROM products WHERE id = ?',
    [productId]
  );
  if (!product || Number(product.is_active) !== 1) throw fail('PRODUCT_NOT_FOUND');

  const uom = product.product_stock_uom_id ? uomRepository.findById(product.product_stock_uom_id) : null;
  if (!uom || Number(uom.is_active) !== 1) throw fail('PRODUCT_STOCK_UOM_UNRESOLVED');
  return { product, uom };
}

function assertOutputQuantity({ quantity, uom }) {
  const value = positive(quantity, 'INVALID_OUTPUT_QUANTITY');
  const precision = Number(uom.quantity_precision);
  const rounded = Number(value.toFixed(Math.min(6, Math.max(0, precision))));
  if (Math.abs(value - rounded) > 1e-9) throw fail('INVALID_OUTPUT_QUANTITY');

  if (Number(uom.allows_fraction) !== 1 && Math.abs(value - Math.round(value)) > 1e-9) {
    throw fail('PRODUCT_STOCK_UOM_FRACTION_NOT_ALLOWED');
  }
  return value;
}

function assertSameOrganization(locationAId, locationBId, repository = inventoryRepository) {
  const a = repository.findStockLocation(locationAId);
  const b = repository.findStockLocation(locationBId);
  if (!a || Number(a.is_active) !== 1 || !b || Number(b.is_active) !== 1) throw fail('STOCK_LOCATION_INVALID');
  if (String(a.organization_id) !== String(b.organization_id)) throw fail('STOCK_LOCATION_SCOPE_INVALID');
  return a.organization_id;
}

class ProductionService {
  static createProductionItem({
    organizationId,
    outputProductId,
    productionItemCode,
    name,
    status = 'DRAFT',
    repository = productionRepository
  }) {
    const orgId = text(organizationId, 'ORGANIZATION_REQUIRED');
    const productId = text(outputProductId, 'PRODUCT_NOT_FOUND');
    const code = text(productionItemCode, 'PRODUCTION_ITEM_CODE_REQUIRED');
    const itemName = text(name, 'PRODUCTION_ITEM_NAME_REQUIRED');
    const lifecycle = String(status || 'DRAFT').toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(lifecycle)) throw fail('PRODUCTION_ITEM_STATUS_INVALID');

    const product = inventoryRepository.findProductForValuation(productId);
    if (!product || Number(product.is_active) !== 1) throw fail('PRODUCT_NOT_FOUND');
    if (String(product.organization_id) !== orgId) throw fail('PRODUCTION_ITEM_ORG_SCOPE_INVALID');

    const createdAt = new Date().toISOString();
    const itemId = id('pi_');
    repository.insertProductionItem({
      id: itemId,
      organizationId: orgId,
      outputProductId: productId,
      productionItemCode: code,
      name: itemName,
      status: lifecycle,
      createdAt,
      updatedAt: createdAt
    });
    return repository.findProductionItem(itemId);
  }

  static activateProductionItem({ productionItemId, repository = productionRepository }) {
    const item = repository.findProductionItem(productionItemId);
    if (!item || item.status === 'ARCHIVED') throw fail('PRODUCTION_ITEM_NOT_FOUND');
    const now = new Date().toISOString();
    const result = repository.updateProductionItemStatus({ id: productionItemId, status: 'ACTIVE', updatedAt: now });
    if (!result || result.changes !== 1) throw fail('PRODUCTION_ITEM_STATUS_INVALID');
    return repository.findProductionItem(productionItemId);
  }

  static addProductionLocation({
    productionItemId,
    stockLocationId,
    repository = productionRepository
  }) {
    const item = repository.findProductionItem(productionItemId);
    if (!item || item.status === 'ARCHIVED') throw fail('PRODUCTION_ITEM_NOT_FOUND');
    const location = inventoryRepository.findStockLocation(stockLocationId);
    if (!location || Number(location.is_active) !== 1) throw fail('STOCK_LOCATION_INVALID');
    if (String(item.organization_id) !== String(location.organization_id)) throw fail('PRODUCTION_LOCATION_SCOPE_INVALID');

    const now = new Date().toISOString();
    const rowId = id('pil_');
    repository.insertProductionItemLocation({
      id: rowId,
      productionItemId,
      stockLocationId,
      createdAt: now,
      updatedAt: now
    });
    return repository.db.queryOne('SELECT * FROM production_item_locations WHERE id = ?', [rowId]);
  }

  static createRecipe({
    productionItemId,
    name,
    repository = productionRepository
  }) {
    const item = repository.findProductionItem(productionItemId);
    if (!item || item.status === 'ARCHIVED') throw fail('PRODUCTION_ITEM_NOT_FOUND');
    if (repository.findRecipeByProductionItemId(productionItemId)) throw fail('RECIPE_ALREADY_EXISTS');

    const now = new Date().toISOString();
    const recipeId = id('rec_');
    repository.insertRecipe({
      id: recipeId,
      productionItemId,
      name: text(name, 'RECIPE_NAME_REQUIRED'),
      createdAt: now,
      updatedAt: now
    });
    return repository.findRecipeByProductionItemId(productionItemId);
  }

  static activateRecipe({ recipeId, repository = productionRepository }) {
    const recipe = repository.db.queryOne('SELECT * FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe || recipe.status === 'ARCHIVED') throw fail('RECIPE_NOT_FOUND');
    const now = new Date().toISOString();
    const result = repository.updateRecipeStatus({ id: recipeId, status: 'ACTIVE', updatedAt: now });
    if (!result || result.changes !== 1) throw fail('RECIPE_STATUS_INVALID');
    return repository.findRecipeByProductionItemId(recipe.production_item_id);
  }

  static createRecipeVersion({
    recipeId,
    plannedYieldQuantity,
    yieldUomId,
    components = [],
    repository = productionRepository
  }) {
    const recipe = repository.db.queryOne('SELECT r.*, pi.organization_id, pi.output_product_id FROM recipes r JOIN production_items pi ON pi.id = r.production_item_id WHERE r.id = ?', [recipeId]);
    if (!recipe || recipe.status === 'ARCHIVED') throw fail('RECIPE_NOT_FOUND');

    const yieldUom = uomRepository.findById(yieldUomId);
    if (!yieldUom || Number(yieldUom.is_active) !== 1) throw fail('YIELD_UOM_INVALID');

    const outputProduct = inventoryRepository.findProductForValuation(recipe.output_product_id);
    if (!outputProduct || Number(outputProduct.is_active) !== 1) throw fail('PRODUCT_NOT_FOUND');
    const outputUomRow = inventoryRepository.db.queryOne(
      'SELECT product_stock_uom_id FROM products WHERE id = ?',
      [recipe.output_product_id]
    );
    const outputUom = outputUomRow && outputUomRow.product_stock_uom_id
      ? uomRepository.findById(outputUomRow.product_stock_uom_id)
      : null;
    if (!outputUom || Number(outputUom.is_active) !== 1) throw fail('PRODUCT_STOCK_UOM_UNRESOLVED');
    if (String(yieldUom.category_id) !== String(outputUom.category_id)) {
      throw fail('YIELD_UOM_CATEGORY_MISMATCH');
    }

    const yieldQty = positive(plannedYieldQuantity, 'INVALID_YIELD_QUANTITY');

    const last = repository.db.queryOne(
      'SELECT MAX(version_number) AS version_number FROM recipe_versions WHERE recipe_id = ?',
      [recipeId]
    );
    const versionNumber = Number(last && last.version_number || 0) + 1;
    const versionId = id('rv_');
    const now = new Date().toISOString();

    repository.beginTransaction();
    try {
      repository.insertRecipeVersion({
        id: versionId,
        recipeId,
        versionNumber,
        plannedYieldQuantity: yieldQty,
        yieldUomId,
        createdAt: now,
        updatedAt: now
      });

      const seen = new Set();
      for (const component of components) {
        const materialId = text(component.material_id, 'MATERIAL_NOT_FOUND');
        if (seen.has(materialId)) throw fail('RECIPE_COMPONENT_DUPLICATE');
        seen.add(materialId);

        const material = materialRepository.findById(materialId);
        if (!material || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND');
        if (String(material.organization_id) !== String(recipe.organization_id)) throw fail('MATERIAL_ORG_SCOPE_INVALID');

        const componentUom = uomRepository.findById(component.planned_uom_id);
        if (!componentUom || Number(componentUom.is_active) !== 1) throw fail('RECIPE_COMPONENT_UOM_INVALID');
        const materialBaseUom = uomRepository.findById(material.base_uom_id);
        if (!materialBaseUom || Number(materialBaseUom.is_active) !== 1) throw fail('BASE_UOM_UNRESOLVED');
        if (String(componentUom.category_id) !== String(materialBaseUom.category_id)) {
          throw fail('RECIPE_COMPONENT_UOM_CATEGORY_MISMATCH');
        }

        repository.insertRecipeComponent({
          id: id('rc_'),
          recipeVersionId: versionId,
          materialId,
          plannedQuantity: positive(component.planned_quantity, 'INVALID_RECIPE_COMPONENT_QUANTITY'),
          plannedUomId: componentUom.id,
          sortOrder: Number.isFinite(Number(component.sort_order)) ? Number(component.sort_order) : 0
        });
      }

      repository.commitTransaction();
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }

    return {
      recipe_version: repository.findRecipeVersion(versionId),
      components: repository.findRecipeComponents(versionId)
    };
  }

  static publishRecipeVersion({ recipeVersionId, repository = productionRepository }) {
    const version = repository.findRecipeVersion(recipeVersionId);
    if (!version || version.status !== 'DRAFT') throw fail('RECIPE_VERSION_STATUS_INVALID');
    const components = repository.findRecipeComponents(recipeVersionId);
    if (components.length === 0) throw fail('RECIPE_COMPONENTS_REQUIRED');

    const now = new Date().toISOString();
    const result = repository.publishRecipeVersion({
      id: recipeVersionId,
      updatedAt: now,
      publishedAt: now
    });
    if (!result || result.changes !== 1) throw fail('RECIPE_VERSION_STATUS_INVALID');
    return repository.findRecipeVersion(recipeVersionId);
  }

  static createProductionBatch({
    outputProductId,
    productionStockLocationId,
    inputStockLocationId,
    outputStockLocationId = null,
    plannedOutputQuantity,
    createdBy = null,
    repository = productionRepository
  }) {
    const productId = text(outputProductId, 'PRODUCT_NOT_FOUND');
    const productionLocationId = text(productionStockLocationId, 'PRODUCTION_LOCATION_REQUIRED');
    const inputLocationId = text(inputStockLocationId, 'INPUT_STOCK_LOCATION_REQUIRED');
    const outputLocationId = text(outputStockLocationId || productionLocationId, 'OUTPUT_STOCK_LOCATION_REQUIRED');
    const orgId = assertSameOrganization(productionLocationId, inputLocationId);
    assertSameOrganization(productionLocationId, outputLocationId);

    const routes = repository.findProductionItemByProductAndLocation(productId, productionLocationId);
    if (routes.length === 0) throw fail('PRODUCTION_ROUTE_NOT_FOUND');
    if (routes.length > 1) throw fail('PRODUCTION_ROUTE_AMBIGUOUS');

    const item = routes[0];
    const recipe = repository.findRecipeByProductionItemId(item.id);
    if (!recipe || recipe.status !== 'ACTIVE') throw fail('RECIPE_NOT_ACTIVE');
    const version = repository.findPublishedRecipeVersion(recipe.id);
    if (!version) throw fail('RECIPE_VERSION_NOT_PUBLISHED');

    const { uom } = assertProductStockUom(productId);
    const plannedQty = assertOutputQuantity({ quantity: plannedOutputQuantity, uom });
    const now = new Date().toISOString();
    const batchId = id('pb_');

    repository.insertProductionBatch({
      id: batchId,
      organizationId: orgId,
      productionItemId: item.id,
      recipeVersionId: version.id,
      productionStockLocationId: productionLocationId,
      inputStockLocationId: inputLocationId,
      outputStockLocationId: outputLocationId,
      plannedOutputQuantity: plannedQty,
      createdBy,
      createdAt: now,
      updatedAt: now
    });

    return repository.findProductionBatch(batchId);
  }

  static planProductionBatch({ productionBatchId, repository = productionRepository }) {
    const batch = repository.findProductionBatch(productionBatchId);
    if (!batch || batch.status !== 'DRAFT') throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    const result = repository.updateProductionBatchPlan({
      id: batch.id,
      timestamp: new Date().toISOString()
    });
    if (!result || result.changes !== 1) throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    return repository.findProductionBatch(batch.id);
  }

  static startProductionBatch({ productionBatchId, startedBy = null, repository = productionRepository }) {
    const batch = repository.findProductionBatch(productionBatchId);
    if (!batch || batch.status !== 'PLANNED') throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    const now = new Date().toISOString();
    const result = repository.updateBatchStatus({ id: batch.id, status: 'IN_PROGRESS', actorField: 'started_by', actorId: startedBy, timestamp: now });
    if (!result || result.changes !== 1) throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    return repository.findProductionBatch(batch.id);
  }

  static cancelProductionBatch({ productionBatchId, cancelledBy = null, reason, repository = productionRepository }) {
    const batch = repository.findProductionBatch(productionBatchId);
    if (!batch || !['DRAFT', 'PLANNED', 'IN_PROGRESS'].includes(batch.status)) throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    const now = new Date().toISOString();
    const result = repository.updateBatchStatus({ id: batch.id, status: 'CANCELLED', actorField: 'cancelled_by', actorId: cancelledBy, timestamp: now, reason: text(reason, 'CANCELLATION_REASON_REQUIRED') });
    if (!result || result.changes !== 1) throw fail('PRODUCTION_BATCH_STATUS_INVALID');
    return repository.findProductionBatch(batch.id);
  }

  static completeProductionBatch({
    productionBatchId,
    productionPostingId,
    actualOutputQuantity,
    actualConsumptions = [],
    currency,
    completedBy = null,
    repository = productionRepository,
    inventory = inventoryRepository
  }) {
    const postingId = text(productionPostingId, 'PRODUCTION_POSTING_ID_REQUIRED');
    const batch = repository.findProductionBatch(productionBatchId);
    if (!batch) throw fail('PRODUCTION_BATCH_NOT_FOUND');

    const replay = repository.findProductionBatchByPostingId(postingId);
    if (replay) {
      if (String(replay.id) !== String(batch.id) || replay.status !== 'COMPLETED') {
        throw fail('PRODUCTION_POSTING_IDENTITY_MISMATCH');
      }
      const snapshot = repository.findProductionCostSnapshot(replay.id);
      return {
        success: true,
        idempotent: true,
        production_batch_id: replay.id,
        production_posting_id: postingId,
        snapshot,
        consumptions: repository.findProductionBatchConsumptions(replay.id)
      };
    }

    if (batch.status !== 'IN_PROGRESS') throw fail('PRODUCTION_BATCH_STATUS_INVALID');

    const productionItem = repository.findProductionItem(batch.production_item_id);
    if (!productionItem) throw fail('PRODUCTION_ITEM_NOT_FOUND');

    const currentRoute = repository.findProductionItemByProductAndLocation(
      productionItem.output_product_id,
      batch.production_stock_location_id
    );
    if (
      currentRoute.length !== 1 ||
      String(currentRoute[0].id) !== String(batch.production_item_id)
    ) {
      throw fail('PRODUCTION_ROUTE_INVALID');
    }

    const recipeVersion = repository.findRecipeVersion(batch.recipe_version_id);
    if (!recipeVersion || recipeVersion.status === 'RETIRED') {
      throw fail('RECIPE_VERSION_UNAVAILABLE');
    }

    const recipe = repository.findRecipeByProductionItemId(batch.production_item_id);
    if (!recipe || String(recipeVersion.recipe_id) !== String(recipe.id)) {
      throw fail('RECIPE_VERSION_MISMATCH');
    }

    const materialComponents = repository.findRecipeComponents(batch.recipe_version_id);
    const componentMaterialIds = new Set(
      materialComponents.map(component => String(component.material_id))
    );

    if (!Array.isArray(actualConsumptions) || actualConsumptions.length === 0) {
      throw fail('ACTUAL_CONSUMPTION_REQUIRED');
    }

    const duplicateMaterials = new Set();
    const normalized = [];

    for (const input of actualConsumptions) {
      const materialId = text(input.material_id, 'MATERIAL_NOT_FOUND');
      if (duplicateMaterials.has(materialId)) throw fail('ACTUAL_CONSUMPTION_DUPLICATE');
      duplicateMaterials.add(materialId);

      if (!componentMaterialIds.has(materialId)) {
        throw fail('ACTUAL_CONSUMPTION_NOT_IN_RECIPE');
      }

      const material = materialRepository.findById(materialId);
      if (!material || material.status !== 'ACTIVE') throw fail('MATERIAL_NOT_FOUND');

      const sourceUomId = text(input.source_uom_id, 'SOURCE_UOM_REQUIRED');
      const sourceQuantity = positive(
        input.actual_quantity,
        'INVALID_CONSUMPTION_QUANTITY'
      );

      const converted = UomConversionService.resolveBaseQuantity({
        materialId,
        sourceUomId,
        quantity: sourceQuantity,
        repository: uomRepository
      });

      const materialBase = uomRepository.findById(material.base_uom_id);
      if (!materialBase || Number(materialBase.is_active) !== 1) {
        throw fail('BASE_UOM_UNRESOLVED');
      }

      normalized.push({
        materialId,
        sourceUomId,
        sourceQuantity,
        baseQuantity: converted.target_quantity
      });
    }

    const outputProduct = inventory.findProductForValuation(productionItem.output_product_id);
    if (!outputProduct || Number(outputProduct.is_active) !== 1) {
      throw fail('PRODUCTION_OUTPUT_PRODUCT_INVALID');
    }

    const outputUomRow = inventory.db.queryOne(
      'SELECT product_stock_uom_id FROM products WHERE id = ?',
      [productionItem.output_product_id]
    );
    const outputUom = outputUomRow && outputUomRow.product_stock_uom_id
      ? uomRepository.findById(outputUomRow.product_stock_uom_id)
      : null;
    if (!outputUom || Number(outputUom.is_active) !== 1) {
      throw fail('PRODUCT_STOCK_UOM_UNRESOLVED');
    }

    const actualOutput = positive(actualOutputQuantity, 'INVALID_OUTPUT_QUANTITY');
    const outputPrecision = Math.min(6, Math.max(0, Number(outputUom.quantity_precision)));
    if (Math.abs(actualOutput - Number(actualOutput.toFixed(outputPrecision))) > 1e-9) {
      throw fail('INVALID_OUTPUT_QUANTITY');
    }
    if (
      Number(outputUom.allows_fraction) !== 1 &&
      Math.abs(actualOutput - Math.round(actualOutput)) > 1e-9
    ) {
      throw fail('PRODUCT_STOCK_UOM_FRACTION_NOT_ALLOWED');
    }

    const targetCurrency = currencyCode(currency);
    const now = new Date().toISOString();

    // One DB transaction owns both Inventory physical mutations and the
    // Production historical cost snapshot.
    repository.beginTransaction();
    try {
      // Re-read the Batch after transaction acquisition so a stale pre-check
      // cannot turn into a second completion under a concurrent request.
      const lockedBatch = repository.findProductionBatch(batch.id);
      if (!lockedBatch || lockedBatch.status !== 'IN_PROGRESS') {
        throw fail('PRODUCTION_BATCH_STATUS_INVALID');
      }
      if (lockedBatch.production_posting_id) {
        throw fail('PRODUCTION_POSTING_ALREADY_APPLIED');
      }

      const posting = InventoryProductionPostingService.postProductionCompletion({
        productionBatchId: lockedBatch.id,
        productionPostingId: postingId,
        inputStockLocationId: lockedBatch.input_stock_location_id,
        outputStockLocationId: lockedBatch.output_stock_location_id,
        outputProductId: productionItem.output_product_id,
        actualOutputQuantity: actualOutput,
        normalizedConsumptions: normalized,
        currency: targetCurrency,
        actorId: completedBy,
        postingTimestamp: now,
        repository: inventory
      });

      const snapshotId = id('pcs_');
      repository.insertProductionCostSnapshot({
        id: snapshotId,
        productionBatchId: lockedBatch.id,
        productionPostingId: postingId,
        actualMaterialCost: posting.actualMaterialCost,
        actualOutputQuantity: posting.actualOutputQuantity,
        productionOutputUnitCost: posting.productionOutputUnitCost,
        currencyCode: posting.currencyCode,
        status: 'AVAILABLE',
        createdAt: now
      });

      for (const line of posting.resolvedCosts) {
        repository.insertProductionBatchConsumption({
          id: id('pbc_'),
          productionBatchId: lockedBatch.id,
          materialId: line.materialId,
          inputStockLocationId: line.inputStockLocationId,
          sourceUomId: line.sourceUomId,
          actualSourceQuantity: line.sourceQuantity,
          actualBaseQuantity: line.baseQuantity,
          resolvedUnitCost: line.unitCost,
          totalCost: line.totalCost,
          currencyCode: line.currencyCode,
          inventoryMovementId: line.inventoryMovementId,
          createdAt: now
        });

        repository.insertProductionCostSnapshotLine({
          id: id('pcsl_'),
          productionCostSnapshotId: snapshotId,
          materialId: line.materialId,
          inputStockLocationId: line.inputStockLocationId,
          actualBaseQuantity: line.baseQuantity,
          resolvedUnitCost: line.unitCost,
          totalCost: line.totalCost,
          currencyCode: line.currencyCode,
          inventoryMovementId: line.inventoryMovementId,
          createdAt: now
        });
      }

      repository.setBatchActualOutput({
        id: lockedBatch.id,
        actualOutputQuantity: posting.actualOutputQuantity,
        productionPostingId: postingId,
        timestamp: now
      });

      const completed = repository.updateBatchStatus({
        id: lockedBatch.id,
        status: 'COMPLETED',
        actorField: 'completed_by',
        actorId: completedBy,
        timestamp: now
      });

      if (!completed || completed.changes !== 1) {
        throw fail('PRODUCTION_BATCH_STATUS_INVALID');
      }

      repository.commitTransaction();

      return {
        success: true,
        idempotent: false,
        production_batch_id: lockedBatch.id,
        production_posting_id: postingId,
        actual_material_cost: posting.actualMaterialCost,
        actual_output_quantity: posting.actualOutputQuantity,
        production_output_unit_cost: posting.productionOutputUnitCost,
        currency_code: posting.currencyCode,
        snapshot_id: snapshotId,
        consumptions: posting.resolvedCosts
      };
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }
  }
}

module.exports = ProductionService;
