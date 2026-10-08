'use strict';

const crypto = require('crypto');
const ProductionRepository = require('../../../core/data/repositories/ProductionRepository');
const MaterialRepository = require('../../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../../core/data/repositories/UomRepository');
const InventoryRepository = require('../../../core/data/repositories/InventoryRepository');
const UomConversionService = require('../../uom/services/UomConversionService');
const CostResolutionService = require('../../inventory/services/CostResolutionService');

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

function movementMutationId(productionPostingId, lineId, role) {
  return 'prm_' + crypto.createHash('sha256')
    .update(productionPostingId + ':' + role + ':' + lineId)
    .digest('hex')
    .slice(0, 24);
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
    const result = repository.updateBatchStatus({ id: batch.id, status: 'PLANNED', actorField: 'started_by', actorId: null, timestamp: new Date().toISOString() });
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
    const batch = repository.findProductionBatch(productionBatchId);
    if (!batch) throw fail('PRODUCTION_BATCH_NOT_FOUND');
    const postingId = text(productionPostingId, 'PRODUCTION_POSTING_ID_REQUIRED');

    const replay = repository.findProductionBatchByPostingId(postingId);
    if (replay) {
      if (String(replay.id) !== String(batch.id) || replay.status !== 'COMPLETED') throw fail('PRODUCTION_POSTING_IDENTITY_MISMATCH');
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
    const { product, uom: outputUom } = assertProductStockUom(productionItem.output_product_id);
    if (String(product.id) !== String(productionItem.output_product_id)) throw fail('PRODUCTION_OUTPUT_PRODUCT_MISMATCH');
    const actualOutput = assertOutputQuantity({ quantity: actualOutputQuantity, uom: outputUom });

    if (!Array.isArray(actualConsumptions) || actualConsumptions.length === 0) {
      throw fail('ACTUAL_CONSUMPTION_REQUIRED');
    }

    const targetCurrency = currencyCode(currency);
    assertSameOrganization(batch.input_stock_location_id, batch.output_stock_location_id, inventory);

    const duplicateMaterials = new Set();
    const normalized = [];
    for (const input of actualConsumptions) {
      const materialId = text(input.material_id, 'MATERIAL_NOT_FOUND');
      if (duplicateMaterials.has(materialId)) throw fail('ACTUAL_CONSUMPTION_DUPLICATE');
      duplicateMaterials.add(materialId);

      const material = materialRepository.findById(materialId);
      if (!material || material.status !== 'ACTIVE') throw fail('MATERIAL_NOT_FOUND');
      const sourceUomId = text(input.source_uom_id, 'SOURCE_UOM_REQUIRED');
      const sourceQuantity = positive(input.actual_quantity, 'INVALID_CONSUMPTION_QUANTITY');
      const converted = UomConversionService.resolveBaseQuantity({
        materialId,
        sourceUomId,
        quantity: sourceQuantity,
        repository: uomRepository
      });
      const materialBase = uomRepository.findById(material.base_uom_id);
      if (!materialBase) throw fail('BASE_UOM_UNRESOLVED');

      normalized.push({
        materialId,
        sourceUomId,
        sourceQuantity,
        baseQuantity: converted.target_quantity,
        baseUomId: materialBase.id
      });
    }

    const recipeVersion = repository.findRecipeVersion(batch.recipe_version_id);
    if (!recipeVersion || recipeVersion.status === 'RETIRED') throw fail('RECIPE_VERSION_UNAVAILABLE');
    const recipe = repository.findRecipeByProductionItemId(batch.production_item_id);
    if (!recipe || String(recipeVersion.recipe_id) !== String(recipe.id)) throw fail('RECIPE_VERSION_MISMATCH');

    const components = repository.findRecipeComponents(batch.recipe_version_id);
    const componentMaterialIds = new Set(components.map(component => String(component.material_id)));
    for (const line of normalized) {
      if (!componentMaterialIds.has(String(line.materialId))) throw fail('ACTUAL_CONSUMPTION_NOT_IN_RECIPE');
    }

    const now = new Date().toISOString();

    repository.beginTransaction();
    try {
      const resolvedCosts = [];
      let actualMaterialCost = 0;
      let resolvedCurrency = targetCurrency;

      for (const line of normalized) {
        const resolution = CostResolutionService.resolveOutboundCost({
          stockLocationId: batch.input_stock_location_id,
          stockIdentityType: 'MATERIAL',
          stockIdentityId: line.materialId,
          quantityBase: line.baseQuantity,
          postingReference: batch.id,
          postingMutationId: movementMutationId(postingId, line.materialId, 'MATERIAL'),
          postingTimestamp: now,
          currencyCode: resolvedCurrency,
          sourceType: 'PRODUCTION_BATCH',
          repository: inventory
        });

        if (resolution.status !== 'AVAILABLE') throw fail('COST_UNAVAILABLE');
        if (String(resolution.currency_code) !== String(resolvedCurrency)) {
          throw fail('PRODUCTION_COST_CURRENCY_MISMATCH');
        }

        const balance = inventory.findMaterialValuationBalance({
          stockLocationId: batch.input_stock_location_id,
          materialId: line.materialId
        });
        const transition = CostResolutionService.applyOutboundTransition({
          balance,
          quantityBase: resolution.quantity_base
        });

        const updated = inventory.updateMaterialValuationBalance({
          stockLocationId: batch.input_stock_location_id,
          materialId: line.materialId,
          quantityBase: transition.quantity,
          carryingValue: transition.carrying_value,
          movingAverageUnitCost: transition.moving_average_unit_cost,
          costAvailabilityStatus: transition.cost_availability_status,
          valuationVersion: transition.valuation_version,
          updatedAt: now
        });
        if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');

        const movementIdValue = 'mov_' + crypto.createHash('sha256').update(postingId + ':' + line.materialId).digest('hex').slice(0, 24);
        const movement = inventory.insertMaterialValuationMovement({
          id: movementIdValue,
          stockLocationId: batch.input_stock_location_id,
          materialId: line.materialId,
          movementType: 'PRODUCTION_ISSUE',
          quantityBase: -resolution.quantity_base,
          previousQuantity: balance.quantity_base,
          currentQuantity: transition.quantity,
          unitCost: resolution.unit_cost,
          totalCost: -resolution.total_cost,
          currencyCode: resolution.currency_code,
          costBasisType: 'CURRENT_MOVING_AVERAGE',
          sourceType: 'PRODUCTION_BATCH',
          sourceReference: batch.id,
          postingMutationId: movementMutationId(postingId, line.materialId, 'MATERIAL'),
          valuationVersion: transition.valuation_version,
          postingTimestamp: now,
          resolverVersion: resolution.resolver_version,
          actorId: completedBy
        });
        if (!movement || movement.changes !== 1) throw fail('VALUATION_STATE_INVALID');

        actualMaterialCost += resolution.total_cost;
        resolvedCosts.push({
          materialId: line.materialId,
          sourceUomId: line.sourceUomId,
          sourceQuantity: line.sourceQuantity,
          baseQuantity: resolution.quantity_base,
          unitCost: resolution.unit_cost,
          totalCost: resolution.total_cost,
          currencyCode: resolution.currency_code,
          inventoryMovementId: movementIdValue,
          inputStockLocationId: batch.input_stock_location_id
        });
      }

      const outputUnitCost = actualMaterialCost / actualOutput;
      const outputResolution = CostResolutionService.resolveInboundValuation({
        stockLocationId: batch.output_stock_location_id,
        stockIdentityType: 'PRODUCT',
        stockIdentityId: product.id,
        quantityBase: actualOutput,
        costBasisType: 'PRODUCTION_OUTPUT',
        incomingUnitCost: outputUnitCost,
        incomingTotalCost: actualMaterialCost,
        sourceType: 'PRODUCTION_BATCH',
        sourceReference: batch.id,
        postingMutationId: movementMutationId(postingId, product.id, 'PRODUCT_OUTPUT'),
        postingTimestamp: now,
        currencyCode: resolvedCurrency,
        repository: inventory
      });

      const productBalance = inventory.findProductValuationBalance({
        stockLocationId: batch.output_stock_location_id,
        productId: product.id
      });
      const productTransition = CostResolutionService.applyInboundTransition({
        balance: productBalance,
        quantityBase: actualOutput,
        totalCost: actualMaterialCost,
        nextStatus: outputResolution.status
      });

      if (productBalance) {
        const updated = inventory.updateProductValuationBalance({
          stockLocationId: batch.output_stock_location_id,
          productId: product.id,
          quantity: productTransition.quantity,
          carryingValue: productTransition.carrying_value,
          movingAverageUnitCost: productTransition.moving_average_unit_cost,
          costAvailabilityStatus: productTransition.cost_availability_status,
          valuationVersion: productTransition.valuation_version,
          updatedAt: now
        });
        if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');
      } else {
        inventory.insertProductValuationBalance({
          stockLocationId: batch.output_stock_location_id,
          productId: product.id,
          quantity: productTransition.quantity,
          carryingValue: productTransition.carrying_value,
          movingAverageUnitCost: productTransition.moving_average_unit_cost,
          costAvailabilityStatus: productTransition.cost_availability_status,
          valuationVersion: productTransition.valuation_version,
          createdAt: now,
          updatedAt: now
        });
      }

      const outputMovementId = movementMutationId(postingId, product.id, 'PRODUCT_OUTPUT');
      const outputMovement = inventory.insertProductValuationMovement({
        id: 'mov_' + crypto.createHash('sha256').update(outputMovementId).digest('hex').slice(0, 24),
        stockLocationId: batch.output_stock_location_id,
        productId: product.id,
        movementType: 'PRODUCTION_OUTPUT',
        quantity: actualOutput,
        previousQuantity: productBalance ? Number(productBalance.quantity) : 0,
        currentQuantity: productTransition.quantity,
        unitCost: outputUnitCost,
        totalCost: actualMaterialCost,
        currencyCode: resolvedCurrency,
        costBasisType: 'PRODUCTION_OUTPUT',
        sourceType: 'PRODUCTION_BATCH',
        sourceReference: batch.id,
        postingMutationId: outputMovementId,
        valuationVersion: productTransition.valuation_version,
        postingTimestamp: now,
        resolverVersion: outputResolution.resolver_version,
        actorId: completedBy
      });
      if (!outputMovement || outputMovement.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      const snapshotId = id('pcs_');
      repository.insertProductionCostSnapshot({
        id: snapshotId,
        productionBatchId: batch.id,
        productionPostingId: postingId,
        actualMaterialCost,
        actualOutputQuantity: actualOutput,
        productionOutputUnitCost: outputUnitCost,
        currencyCode: resolvedCurrency,
        status: 'AVAILABLE',
        createdAt: now
      });

      for (const line of resolvedCosts) {
        repository.insertProductionBatchConsumption({
          id: id('pbc_'),
          productionBatchId: batch.id,
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
        id: batch.id,
        actualOutputQuantity: actualOutput,
        productionPostingId: postingId,
        timestamp: now
      });
      const completed = repository.updateBatchStatus({
        id: batch.id,
        status: 'COMPLETED',
        actorField: 'completed_by',
        actorId: completedBy,
        timestamp: now
      });
      if (!completed || completed.changes !== 1) throw fail('PRODUCTION_BATCH_STATUS_INVALID');

      repository.commitTransaction();

      return {
        success: true,
        idempotent: false,
        production_batch_id: batch.id,
        production_posting_id: postingId,
        actual_material_cost: actualMaterialCost,
        actual_output_quantity: actualOutput,
        production_output_unit_cost: outputUnitCost,
        currency_code: resolvedCurrency,
        snapshot_id: snapshotId,
        consumptions: resolvedCosts
      };
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }
  }
}

module.exports = ProductionService;
