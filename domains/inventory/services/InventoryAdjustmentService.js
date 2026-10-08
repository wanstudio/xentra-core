'use strict';

const crypto = require('crypto');
const InventoryRepository = require('../../../core/data/repositories/InventoryRepository');
const CostResolutionService = require('./CostResolutionService');

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

function finiteNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw fail(code);
  return number;
}

function positive(value, code) {
  const number = finiteNumber(value, code);
  if (number <= 0) throw fail(code);
  return number;
}

function movementMutationId(mutationId) {
  return 'adjust_' + crypto.createHash('sha256').update(String(mutationId)).digest('hex').slice(0, 24);
}

function movementId(mutationId) {
  return 'mov_' + crypto.createHash('sha256').update(String(mutationId)).digest('hex').slice(0, 24);
}

class InventoryAdjustmentService {
  /**
   * Canonical Product Stock adjustment boundary.
   *
   * Positive adjustments require explicit incoming unit cost + currency.
   * Negative adjustments use the current Moving Average outbound cost.
   *
   * When the branch has no unambiguous canonical Stock Location or the Product
   * Stock Balance has not yet been migrated, this returns a migration seam
   * without touching the legacy pool.
   */
  static postProductAdjustment({
    branchId,
    productId,
    movementType,
    quantity,
    mutationId,
    unitCost = null,
    currencyCode = null,
    actorId = null,
    notes = '',
    postingTimestamp,
    repository = inventoryRepository
  }) {
    const branch = text(branchId, 'BRANCH_REQUIRED');
    const product = text(productId, 'PRODUCT_REQUIRED');
    const type = text(movementType, 'MOVEMENT_TYPE_REQUIRED').toUpperCase();
    const qty = finiteNumber(quantity, 'INVALID_QUANTITY');
    const timestamp = text(postingTimestamp, 'POSTING_TIMESTAMP_REQUIRED');
    const clientMutationId = text(mutationId, 'MUTATION_ID_REQUIRED');

    if (!['AUDIT_ADJUSTMENT', 'WASTE_SPOILAGE'].includes(type)) {
      throw fail('INVALID_MOVEMENT_TYPE');
    }
    if (qty === 0) throw fail('INVALID_QUANTITY');
    if (type === 'WASTE_SPOILAGE' && qty > 0) throw fail('INVALID_QUANTITY');

    const locationResult = repository.findCanonicalProductStockLocation(branch);
    if (locationResult.status !== 'AVAILABLE') {
      return {
        status: 'LEGACY_COMPATIBILITY_REQUIRED',
        reason: locationResult.status === 'AMBIGUOUS'
          ? 'CANONICAL_BRANCH_STOCK_LOCATION_AMBIGUOUS'
          : 'CANONICAL_BRANCH_STOCK_LOCATION_NOT_FOUND',
        stock_location_id: null
      };
    }

    const stockLocationId = locationResult.location.id;
    const productIdentity = repository.findProductForValuation(product);
    if (!productIdentity || Number(productIdentity.is_active) !== 1) {
      throw fail('PRODUCT_NOT_FOUND');
    }
    if (String(productIdentity.organization_id) !== String(locationResult.location.organization_id)) {
      throw fail('PRODUCT_ORGANIZATION_SCOPE_INVALID');
    }

    const balance = repository.findProductValuationBalance({
      stockLocationId,
      productId: product
    });
    if (!balance) {
      return {
        status: 'LEGACY_COMPATIBILITY_REQUIRED',
        reason: 'PRODUCT_STOCK_BALANCE_NOT_CANONICAL',
        stock_location_id: stockLocationId
      };
    }

    const postingMutationId = movementMutationId(clientMutationId);
    const existing = repository.findProductValuationMovementByPostingMutationId(postingMutationId);
    if (existing) {
      if (
        String(existing.stock_location_id) !== String(stockLocationId) ||
        String(existing.product_id) !== String(product) ||
        String(existing.movement_type).toUpperCase() !== type
      ) {
        throw fail('MUTATION_ID_REUSED');
      }

      return {
        status: 'AVAILABLE',
        idempotent: true,
        stock_location_id: stockLocationId,
        product_id: product,
        movement_type: existing.movement_type,
        quantity: Number(existing.quantity),
        unit_cost: Number(existing.unit_cost),
        total_cost: Number(existing.total_cost),
        currency_code: existing.currency_code,
        posting_mutation_id: existing.posting_mutation_id,
        inventory_movement_id: existing.id,
        valuation_version: Number(existing.valuation_version)
      };
    }

    const ownsTransaction = true;
    repository.beginTransaction();
    try {
      // Re-read after transaction begins so the mutation uses the latest locked state.
      const lockedBalance = repository.findProductValuationBalance({
        stockLocationId,
        productId: product
      });
      if (!lockedBalance) throw fail('VALUATION_STATE_INVALID');

      let resolution;
      let transition;
      let totalCost;
      let resolvedUnitCost;
      let resolvedCurrency;
      let costBasisType;

      if (qty > 0) {
        const incomingUnitCost = positive(unitCost, 'INBOUND_COST_UNRESOLVED');
        resolvedCurrency = text(currencyCode, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();

        resolution = CostResolutionService.resolveInboundValuation({
          stockLocationId,
          stockIdentityType: 'PRODUCT',
          stockIdentityId: product,
          quantityBase: qty,
          costBasisType: 'COUNT_CORRECTION',
          incomingUnitCost,
          incomingTotalCost: qty * incomingUnitCost,
          sourceType: 'MANUAL_ADJUSTMENT',
          sourceReference: clientMutationId,
          postingMutationId,
          postingTimestamp: timestamp,
          currencyCode: resolvedCurrency,
          repository
        });

        transition = CostResolutionService.applyInboundTransition({
          balance: lockedBalance,
          quantityBase: resolution.quantity_base,
          totalCost: resolution.total_cost,
          nextStatus: resolution.status
        });

        resolvedUnitCost = resolution.unit_cost;
        totalCost = resolution.total_cost;
        costBasisType = 'COUNT_CORRECTION';
      } else {
        resolution = CostResolutionService.resolveOutboundCost({
          stockLocationId,
          stockIdentityType: 'PRODUCT',
          stockIdentityId: product,
          quantityBase: Math.abs(qty),
          postingReference: clientMutationId,
          postingMutationId,
          postingTimestamp: timestamp,
          sourceType: 'MANUAL_ADJUSTMENT',
          repository
        });

        transition = CostResolutionService.applyOutboundTransition({
          balance: lockedBalance,
          quantityBase: resolution.quantity_base
        });

        resolvedUnitCost = resolution.unit_cost;
        totalCost = resolution.total_cost;
        resolvedCurrency = resolution.currency_code;
        costBasisType = 'CURRENT_MOVING_AVERAGE';
      }

      const updated = repository.updateProductValuationBalance({
        stockLocationId,
        productId: product,
        quantity: transition.quantity,
        carryingValue: transition.carrying_value,
        movingAverageUnitCost: transition.moving_average_unit_cost,
        costAvailabilityStatus: transition.cost_availability_status,
        valuationVersion: transition.valuation_version,
        updatedAt: timestamp
      });
      if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      const signedQuantity = qty > 0 ? qty : -Math.abs(qty);
      const movement = repository.insertProductValuationMovement({
        id: movementId(clientMutationId),
        stockLocationId,
        productId: product,
        movementType: type === 'WASTE_SPOILAGE' ? 'WASTE' : (qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'),
        quantity: signedQuantity,
        previousQuantity: Number(lockedBalance.quantity),
        currentQuantity: Number(transition.quantity),
        unitCost: resolvedUnitCost,
        totalCost: qty > 0 ? totalCost : -totalCost,
        currencyCode: resolvedCurrency,
        costBasisType,
        sourceType: 'MANUAL_ADJUSTMENT',
        sourceReference: clientMutationId,
        postingMutationId,
        valuationVersion: transition.valuation_version,
        postingTimestamp: timestamp,
        resolverVersion: resolution.resolver_version,
        actorId,
        notes
      });
      if (!movement || movement.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      repository.commitTransaction();

      return {
        status: resolution.status || 'AVAILABLE',
        idempotent: false,
        stock_location_id: stockLocationId,
        product_id: product,
        movement_type: type === 'WASTE_SPOILAGE' ? 'WASTE' : (qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'),
        quantity: signedQuantity,
        previous_stock: Number(lockedBalance.quantity),
        current_stock: Number(transition.quantity),
        unit_cost: resolvedUnitCost,
        total_cost: qty > 0 ? totalCost : -totalCost,
        currency_code: resolvedCurrency,
        posting_mutation_id: postingMutationId,
        inventory_movement_id: movementId(clientMutationId),
        valuation_version: transition.valuation_version
      };
    } catch (error) {
      if (ownsTransaction) {
        try { repository.rollbackTransaction(); } catch (_) {}
      }
      throw error;
    }
  }

  static _legacyResult(stockLocationId) {
    return {
      status: 'LEGACY_COMPATIBILITY_REQUIRED',
      reason: 'PRODUCT_STOCK_BALANCE_NOT_CANONICAL',
      stock_location_id: stockLocationId
    };
  }
}

module.exports = InventoryAdjustmentService;
