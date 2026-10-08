'use strict';

const crypto = require('crypto');
const InventoryRepository = require('../../../core/data/repositories/InventoryRepository');
const UomRepository = require('../../../core/data/repositories/UomRepository');
const CostResolutionService = require('./CostResolutionService');

const inventoryRepository = new InventoryRepository();
const uomRepository = new UomRepository();

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

function movementMutationId(postingId, identityId, role) {
  return 'prm_' + crypto.createHash('sha256')
    .update(postingId + ':' + role + ':' + identityId)
    .digest('hex')
    .slice(0, 24);
}

function movementId(mutationId) {
  return 'mov_' + crypto.createHash('sha256').update(mutationId).digest('hex').slice(0, 24);
}

function assertSameOrganization(locationIds, repository) {
  const unique = [];
  for (const id of locationIds) {
    if (!unique.includes(String(id))) unique.push(String(id));
  }

  let organizationId = null;
  for (const locationId of unique) {
    const location = repository.findStockLocation(locationId);
    if (!location || Number(location.is_active) !== 1) throw fail('STOCK_LOCATION_INVALID');
    if (organizationId == null) organizationId = String(location.organization_id);
    if (organizationId !== String(location.organization_id)) throw fail('STOCK_LOCATION_SCOPE_INVALID');
  }
  return organizationId;
}

function assertProductStockUom(productId, repository) {
  const product = repository.findProductForValuation(productId);
  if (!product || Number(product.is_active) !== 1) throw fail('PRODUCT_NOT_FOUND');
  const row = repository.db.queryOne(
    'SELECT product_stock_uom_id FROM products WHERE id = ?',
    [productId]
  );
  const uom = row && row.product_stock_uom_id ? uomRepository.findById(row.product_stock_uom_id) : null;
  if (!uom || Number(uom.is_active) !== 1) throw fail('PRODUCT_STOCK_UOM_UNRESOLVED');
  return { product, uom };
}

/**
 * Inventory-owned physical posting for Production completion.
 *
 * Caller owns the surrounding database transaction. This service never creates
 * a competing transaction and never writes Production-owned tables.
 */
class InventoryProductionPostingService {
  static postProductionCompletion({
    productionBatchId,
    productionPostingId,
    inputStockLocationId,
    outputStockLocationId,
    outputProductId,
    actualOutputQuantity,
    normalizedConsumptions,
    currency,
    actorId = null,
    postingTimestamp,
    repository = inventoryRepository
  }) {
    const batchId = text(productionBatchId, 'PRODUCTION_BATCH_ID_REQUIRED');
    const postingId = text(productionPostingId, 'PRODUCTION_POSTING_ID_REQUIRED');
    const inputLocationId = text(inputStockLocationId, 'INPUT_STOCK_LOCATION_REQUIRED');
    const outputLocationId = text(outputStockLocationId, 'OUTPUT_STOCK_LOCATION_REQUIRED');
    const targetCurrency = currencyCode(currency);
    const timestamp = text(postingTimestamp, 'POSTING_TIMESTAMP_REQUIRED');

    if (!Array.isArray(normalizedConsumptions) || normalizedConsumptions.length === 0) {
      throw fail('ACTUAL_CONSUMPTION_REQUIRED');
    }

    assertSameOrganization([inputLocationId, outputLocationId], repository);

    const { product, uom: outputUom } = assertProductStockUom(outputProductId, repository);
    const outputQty = positive(actualOutputQuantity, 'INVALID_OUTPUT_QUANTITY');
    const precision = Math.min(6, Math.max(0, Number(outputUom.quantity_precision)));
    if (Math.abs(outputQty - Number(outputQty.toFixed(precision))) > 1e-9) {
      throw fail('INVALID_OUTPUT_QUANTITY');
    }
    if (Number(outputUom.allows_fraction) !== 1 && Math.abs(outputQty - Math.round(outputQty)) > 1e-9) {
      throw fail('PRODUCT_STOCK_UOM_FRACTION_NOT_ALLOWED');
    }

    const resolvedCosts = [];
    let actualMaterialCost = 0;

    for (const line of normalizedConsumptions) {
      const resolution = CostResolutionService.resolveOutboundCost({
        stockLocationId: inputLocationId,
        stockIdentityType: 'MATERIAL',
        stockIdentityId: line.materialId,
        quantityBase: line.baseQuantity,
        postingReference: batchId,
        postingMutationId: movementMutationId(postingId, line.materialId, 'MATERIAL'),
        postingTimestamp: timestamp,
        currencyCode: targetCurrency,
        sourceType: 'PRODUCTION_BATCH',
        repository
      });

      if (resolution.status !== 'AVAILABLE') throw fail('COST_UNAVAILABLE');
      if (String(resolution.currency_code) !== targetCurrency) {
        throw fail('PRODUCTION_COST_CURRENCY_MISMATCH');
      }

      const balance = repository.findMaterialValuationBalance({
        stockLocationId: inputLocationId,
        materialId: line.materialId
      });

      const transition = CostResolutionService.applyOutboundTransition({
        balance,
        quantityBase: resolution.quantity_base
      });

      const updated = repository.updateMaterialValuationBalance({
        stockLocationId: inputLocationId,
        materialId: line.materialId,
        quantityBase: transition.quantity,
        carryingValue: transition.carrying_value,
        movingAverageUnitCost: transition.moving_average_unit_cost,
        costAvailabilityStatus: transition.cost_availability_status,
        valuationVersion: transition.valuation_version,
        updatedAt: timestamp
      });
      if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      const mutationId = movementMutationId(postingId, line.materialId, 'MATERIAL');
      const movementIdValue = movementId(mutationId);
      const movement = repository.insertMaterialValuationMovement({
        id: movementIdValue,
        stockLocationId: inputLocationId,
        materialId: line.materialId,
        movementType: 'PRODUCTION_ISSUE',
        quantityBase: -resolution.quantity_base,
        previousQuantity: Number(balance.quantity_base),
        currentQuantity: transition.quantity,
        unitCost: resolution.unit_cost,
        totalCost: -resolution.total_cost,
        currencyCode: resolution.currency_code,
        costBasisType: 'CURRENT_MOVING_AVERAGE',
        sourceType: 'PRODUCTION_BATCH',
        sourceReference: batchId,
        postingMutationId: mutationId,
        valuationVersion: transition.valuation_version,
        postingTimestamp: timestamp,
        resolverVersion: resolution.resolver_version,
        actorId
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
        inputStockLocationId: inputLocationId
      });
    }

    const outputUnitCost = actualMaterialCost / outputQty;
    const outputMutationId = movementMutationId(postingId, product.id, 'PRODUCT_OUTPUT');

    const outputResolution = CostResolutionService.resolveInboundValuation({
      stockLocationId: outputLocationId,
      stockIdentityType: 'PRODUCT',
      stockIdentityId: product.id,
      quantityBase: outputQty,
      costBasisType: 'PRODUCTION_OUTPUT',
      incomingUnitCost: outputUnitCost,
      incomingTotalCost: actualMaterialCost,
      sourceType: 'PRODUCTION_BATCH',
      sourceReference: batchId,
      postingMutationId: outputMutationId,
      postingTimestamp: timestamp,
      currencyCode: targetCurrency,
      repository
    });

    const productBalance = repository.findProductValuationBalance({
      stockLocationId: outputLocationId,
      productId: product.id
    });

    const productTransition = CostResolutionService.applyInboundTransition({
      balance: productBalance,
      quantityBase: outputQty,
      totalCost: actualMaterialCost,
      nextStatus: outputResolution.status
    });

    if (productBalance) {
      const updated = repository.updateProductValuationBalance({
        stockLocationId: outputLocationId,
        productId: product.id,
        quantity: productTransition.quantity,
        carryingValue: productTransition.carrying_value,
        movingAverageUnitCost: productTransition.moving_average_unit_cost,
        costAvailabilityStatus: productTransition.cost_availability_status,
        valuationVersion: productTransition.valuation_version,
        updatedAt: timestamp
      });
      if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');
    } else {
      repository.insertProductValuationBalance({
        stockLocationId: outputLocationId,
        productId: product.id,
        quantity: productTransition.quantity,
        carryingValue: productTransition.carrying_value,
        movingAverageUnitCost: productTransition.moving_average_unit_cost,
        costAvailabilityStatus: productTransition.cost_availability_status,
        valuationVersion: productTransition.valuation_version,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const outputMovementId = movementId(outputMutationId);
    const outputMovement = repository.insertProductValuationMovement({
      id: outputMovementId,
      stockLocationId: outputLocationId,
      productId: product.id,
      movementType: 'PRODUCTION_OUTPUT',
      quantity: outputQty,
      previousQuantity: productBalance ? Number(productBalance.quantity) : 0,
      currentQuantity: productTransition.quantity,
      unitCost: outputUnitCost,
      totalCost: actualMaterialCost,
      currencyCode: targetCurrency,
      costBasisType: 'PRODUCTION_OUTPUT',
      sourceType: 'PRODUCTION_BATCH',
      sourceReference: batchId,
      postingMutationId: outputMutationId,
      valuationVersion: productTransition.valuation_version,
      postingTimestamp: timestamp,
      resolverVersion: outputResolution.resolver_version,
      actorId
    });
    if (!outputMovement || outputMovement.changes !== 1) throw fail('VALUATION_STATE_INVALID');

    return {
      actualMaterialCost,
      actualOutputQuantity: outputQty,
      productionOutputUnitCost: outputUnitCost,
      currencyCode: targetCurrency,
      resolvedCosts,
      outputMovementId
    };
  }
}

module.exports = InventoryProductionPostingService;
