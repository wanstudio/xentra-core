'use strict';

const crypto = require('crypto');
const InventoryRepository = require('../../../core/data/repositories/InventoryRepository');
const CostResolutionService = require('./CostResolutionService');

const inventoryRepository = new InventoryRepository();
const EPSILON = 0.000001;

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
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw fail(code);
  return number;
}

function movementMutationId(sourceReference, productId) {
  return 'sale_' + crypto.createHash('sha256')
    .update(sourceReference + ':' + productId)
    .digest('hex')
    .slice(0, 24);
}

function movementId(mutationId) {
  return 'mov_' + crypto.createHash('sha256')
    .update(mutationId)
    .digest('hex')
    .slice(0, 24);
}

function normalizeRequirements(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw fail('SALE_REQUIREMENTS_REQUIRED');
  }

  const map = new Map();
  for (const input of requirements) {
    if (!input || typeof input !== 'object') throw fail('SALE_REQUIREMENT_INVALID');

    const productId = text(input.product_id, 'PRODUCT_NOT_FOUND');
    const quantity = positive(input.quantity, 'INVALID_QUANTITY');
    const name = text(input.product_name || productId, 'PRODUCT_NOT_FOUND');

    const existing = map.get(productId);
    if (existing) {
      existing.quantity += quantity;
      existing.product_name = existing.product_name || name;
    } else {
      map.set(productId, {
        product_id: productId,
        product_name: name,
        quantity
      });
    }
  }

  return Array.from(map.values());
}

class InventorySalePostingService {
  /**
   * Posts the canonical Product Stock mutation for a confirmed sale.
   *
   * Returns LEGACY_COMPATIBILITY_REQUIRED without changing stock when the
   * branch has no unambiguous canonical Branch Stock Location or a required
   * Product Stock balance has not yet been migrated into the cost-bearing model.
   *
   * The caller owns the surrounding DB transaction.
   */
  static postCanonicalSale({
    branchId,
    requirements,
    sourceType = 'SALE',
    sourceReference,
    actorId = null,
    postingTimestamp,
    repository = inventoryRepository,
    dbTransactionProvided = false,
    manageTransaction = false
  }) {
    const normalizedBranchId = text(branchId, 'BRANCH_REQUIRED');
    const reference = text(sourceReference, 'SALE_REFERENCE_REQUIRED');
    const timestamp = text(postingTimestamp, 'POSTING_TIMESTAMP_REQUIRED');
    const lines = normalizeRequirements(requirements);

    const locationResult = repository.findCanonicalProductStockLocation(normalizedBranchId);
    if (locationResult.status !== 'AVAILABLE') {
      return {
        status: 'LEGACY_COMPATIBILITY_REQUIRED',
        reason: locationResult.status === 'AMBIGUOUS'
          ? 'CANONICAL_BRANCH_STOCK_LOCATION_AMBIGUOUS'
          : 'CANONICAL_BRANCH_STOCK_LOCATION_NOT_FOUND',
        stock_location_id: null,
        deducted_items: [],
        cost_lines: []
      };
    }

    const stockLocationId = locationResult.location.id;

    // Validate the complete canonical requirement set before any mutation.
    const existingMovements = [];
    let hasLegacyRequirement = false;

    const ownsTransaction = Boolean(manageTransaction && !dbTransactionProvided);
    if (ownsTransaction) repository.beginTransaction();

    try {

    for (const line of lines) {
      const product = repository.findProductForValuation(line.product_id);
      if (!product || Number(product.is_active) !== 1) {
        throw fail('PRODUCT_NOT_FOUND');
      }
      if (String(product.organization_id) !== String(locationResult.location.organization_id)) {
        throw fail('PRODUCT_ORGANIZATION_SCOPE_INVALID');
      }

      const existingBalance = repository.findProductValuationBalance({
        stockLocationId,
        productId: line.product_id
      });

      if (!existingBalance) {
        hasLegacyRequirement = true;
        continue;
      }

      const mutationId = movementMutationId(reference, line.product_id);
      const existingMovement = repository.findProductValuationMovementByPostingMutationId(mutationId);

      if (existingMovement) {
        existingMovements.push({ line, existingMovement });
      } else if (
        existingBalance &&
        (
          Number(existingBalance.quantity) < 0 ||
          Number(existingBalance.carrying_value) < 0 ||
          String(existingBalance.cost_availability_status || '').toUpperCase() === 'UNAVAILABLE'
        )
      ) {
        throw fail('VALUATION_STATE_INVALID');
      }
    }

    if (existingMovements.length > 0 && existingMovements.length !== lines.length) {
      throw fail('SALE_POSTING_INCOMPLETE');
    }

    if (existingMovements.length === lines.length) {
      const costLines = existingMovements.map(({ line, existingMovement }) => ({
        source_item_reference: line.source_item_reference || null,
        product_id: line.product_id,
        quantity: Math.abs(Number(existingMovement.quantity)),
        unit_cost: Math.abs(Number(existingMovement.unit_cost)),
        total_cost: Math.abs(Number(existingMovement.total_cost)),
        currency_code: existingMovement.currency_code,
        inventory_movement_id: existingMovement.id,
        posting_mutation_id: existingMovement.posting_mutation_id
      }));

      const currencies = new Set(costLines.map(line => String(line.currency_code || '').toUpperCase()).filter(Boolean));
      if (currencies.size > 1) throw fail('COST_CURRENCY_MISMATCH');

      return {
        status: 'AVAILABLE',
        idempotent: true,
        stock_location_id: stockLocationId,
        source_reference: reference,
        source_type: sourceType,
        currency_code: currencies.size === 1 ? Array.from(currencies)[0] : null,
        total_cost: costLines.reduce((sum, line) => sum + line.total_cost, 0),
        deducted_items: costLines.map(line => ({
          product_id: line.product_id,
          quantity: line.quantity
        })),
        cost_lines: costLines
      };
    }

    if (hasLegacyRequirement) {
      return {
        status: 'LEGACY_COMPATIBILITY_REQUIRED',
        reason: 'PRODUCT_STOCK_BALANCE_NOT_CANONICAL',
        stock_location_id: stockLocationId,
        deducted_items: [],
        cost_lines: []
      };
    }

    const costLines = [];
    const deductedItems = [];
    let currency = null;
    let totalCost = 0;

    for (const line of lines) {
      const mutationId = movementMutationId(reference, line.product_id);
      const resolution = CostResolutionService.resolveOutboundCost({
        stockLocationId,
        stockIdentityType: 'PRODUCT',
        stockIdentityId: line.product_id,
        quantityBase: line.quantity,
        postingReference: reference,
        postingMutationId: mutationId,
        postingTimestamp: timestamp,
        sourceType,
        repository
      });

      if (resolution.status !== 'AVAILABLE') throw fail('COST_UNAVAILABLE');

      if (currency && currency !== resolution.currency_code) {
        throw fail('COST_CURRENCY_MISMATCH');
      }
      currency = resolution.currency_code;

      const balance = repository.findProductValuationBalance({
        stockLocationId,
        productId: line.product_id
      });

      const transition = CostResolutionService.applyOutboundTransition({
        balance,
        quantityBase: resolution.quantity_base
      });

      const updated = repository.updateProductValuationBalance({
        stockLocationId,
        productId: line.product_id,
        quantity: transition.quantity,
        carryingValue: transition.carrying_value,
        movingAverageUnitCost: transition.moving_average_unit_cost,
        costAvailabilityStatus: transition.cost_availability_status,
        valuationVersion: transition.valuation_version,
        updatedAt: timestamp
      });

      if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      const postedMovementId = movementId(mutationId);
      const movement = repository.insertProductValuationMovement({
        id: postedMovementId,
        stockLocationId,
        productId: line.product_id,
        movementType: 'SALE',
        quantity: -resolution.quantity_base,
        previousQuantity: Number(balance.quantity),
        currentQuantity: transition.quantity,
        unitCost: resolution.unit_cost,
        totalCost: -resolution.total_cost,
        currencyCode: resolution.currency_code,
        costBasisType: 'CURRENT_MOVING_AVERAGE',
        sourceType,
        sourceReference: reference,
        postingMutationId: mutationId,
        valuationVersion: transition.valuation_version,
        postingTimestamp: timestamp,
        resolverVersion: resolution.resolver_version,
        actorId
      });

      if (!movement || movement.changes !== 1) throw fail('VALUATION_STATE_INVALID');

      costLines.push({
        product_id: line.product_id,
        quantity: resolution.quantity_base,
        unit_cost: resolution.unit_cost,
        total_cost: resolution.total_cost,
        currency_code: resolution.currency_code,
        inventory_movement_id: postedMovementId,
        posting_mutation_id: mutationId,
        source_item_reference: line.source_item_reference || null
      });

      deductedItems.push({
        product_id: line.product_id,
        product_name: line.product_name,
        quantity: resolution.quantity_base,
        previous_stock: Number(balance.quantity),
        current_stock: transition.quantity
      });

      totalCost += resolution.total_cost;
    }

    const result = {
      status: 'AVAILABLE',
      idempotent: false,
      stock_location_id: stockLocationId,
      source_reference: reference,
      source_type: sourceType,
      currency_code: currency,
      total_cost: totalCost,
      deducted_items: deductedItems,
      cost_lines: costLines
    };

    if (ownsTransaction) repository.commitTransaction();
    return result;
    } catch (error) {
      if (ownsTransaction) {
        try { repository.rollbackTransaction(); } catch (_) {}
      }
      throw error;
    }
  }
}

module.exports = InventorySalePostingService;
