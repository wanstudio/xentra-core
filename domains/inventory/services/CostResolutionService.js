'use strict';

const { InventoryRepository } = require('../../../core/data/repositories');

const inventoryRepository = new InventoryRepository();

const STOCK_IDENTITY_TYPES = new Set(['MATERIAL', 'PRODUCT']);
const COST_BASIS_TYPES = new Set([
  'PURCHASE_RECEIPT',
  'PRODUCTION_OUTPUT',
  'TRANSFER_CARRIED',
  'OPENING_ACTUAL',
  'OPENING_ESTIMATE',
  'COUNT_CORRECTION'
]);
const RESOLVER_VERSION = 'v1';
const VALUATION_METHOD = 'MOVING_AVERAGE';
const QUANTITY_EPSILON = 1e-9;
const VALUE_EPSILON = 0.000001;

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertIdentityType(value) {
  const type = normalizeText(value).toUpperCase();
  if (!STOCK_IDENTITY_TYPES.has(type)) {
    throw fail('STOCK_IDENTITY_NOT_FOUND', 'STOCK_IDENTITY_NOT_FOUND');
  }
  return type;
}

function assertPositiveQuantity(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw fail('INVALID_QUANTITY', 'INVALID_QUANTITY');
  }

  // The UOM contract allows up to 6 decimal places for stock quantities.
  const rounded = Math.round(qty * 1000000) / 1000000;
  if (Math.abs(qty - rounded) > QUANTITY_EPSILON) {
    throw fail('INVALID_QUANTITY', 'INVALID_QUANTITY');
  }
  return rounded;
}

function assertCurrencyCode(value) {
  const currency = normalizeText(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw fail('CURRENCY_BASIS_UNRESOLVED', 'CURRENCY_BASIS_UNRESOLVED');
  }
  return currency;
}

function assertPostingTimestamp(value) {
  const timestamp = normalizeText(value);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
  }
  return timestamp;
}

function assertPostingReference(value) {
  const reference = normalizeText(value);
  if (!reference) {
    throw fail('SOURCE_REFERENCE_REQUIRED', 'SOURCE_REFERENCE_REQUIRED');
  }
  return reference;
}

function normalizeBalance(balance) {
  if (!balance) {
    return {
      quantity: 0,
      carryingValue: 0,
      movingAverageUnitCost: 0,
      costAvailabilityStatus: 'UNAVAILABLE',
      valuationVersion: 0,
      createdAt: null,
      updatedAt: null
    };
  }

  const quantity = Number(balance.quantity ?? balance.quantity_base);
  const carryingValue = Number(balance.carrying_value);
  const average = Number(balance.moving_average_unit_cost);
  const status = normalizeText(balance.cost_availability_status).toUpperCase() || 'UNAVAILABLE';
  const version = Number(balance.valuation_version);

  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(carryingValue) ||
    !Number.isFinite(average) ||
    !Number.isInteger(version) ||
    quantity < 0 ||
    carryingValue < 0 ||
    average < 0 ||
    version < 0
  ) {
    throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
  }

  if (quantity === 0) {
    if (Math.abs(carryingValue) > VALUE_EPSILON || Math.abs(average) > VALUE_EPSILON || status !== 'UNAVAILABLE') {
      throw fail('VALUATION_VALUE_MISMATCH', 'VALUATION_VALUE_MISMATCH');
    }
  } else {
    if (Math.abs(carryingValue - (quantity * average)) > VALUE_EPSILON) {
      throw fail('VALUATION_VALUE_MISMATCH', 'VALUATION_VALUE_MISMATCH');
    }
    if (!['AVAILABLE', 'ESTIMATED'].includes(status)) {
      throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
    }
  }

  return {
    quantity,
    carryingValue,
    movingAverageUnitCost: average,
    costAvailabilityStatus: status,
    valuationVersion: version,
    createdAt: balance.created_at || null,
    updatedAt: balance.updated_at || null
  };
}

function assertLocationAndIdentity({ repository, stockLocationId, stockIdentityType, stockIdentityId }) {
  const location = repository.findStockLocation(stockLocationId);
  if (!location) throw fail('STOCK_LOCATION_INVALID', 'STOCK_LOCATION_INVALID');
  if (Number(location.is_active) !== 1) throw fail('STOCK_LOCATION_INACTIVE', 'STOCK_LOCATION_INACTIVE');

  if (!normalizeText(stockIdentityId)) {
    throw fail('STOCK_IDENTITY_NOT_FOUND', 'STOCK_IDENTITY_NOT_FOUND');
  }

  let identity = null;
  if (stockIdentityType === 'PRODUCT') {
    identity = repository.findProductForValuation(stockIdentityId);
  } else {
    identity = repository.findMaterialForValuation(stockIdentityId);
  }

  if (!identity || Number(identity.is_active) !== 1) {
    throw fail('STOCK_IDENTITY_NOT_FOUND', 'STOCK_IDENTITY_NOT_FOUND');
  }

  if (String(identity.organization_id) !== String(location.organization_id)) {
    throw fail('STOCK_IDENTITY_NOT_FOUND', 'STOCK_IDENTITY_NOT_FOUND');
  }

  return { location, identity };
}

function assertCurrencyContinuity(currencyCode, latestMovement) {
  if (!latestMovement) return currencyCode;
  const previousCurrency = normalizeText(latestMovement.currency_code).toUpperCase();
  if (!previousCurrency) {
    throw fail('CURRENCY_BASIS_UNRESOLVED', 'CURRENCY_BASIS_UNRESOLVED');
  }
  if (previousCurrency !== currencyCode) {
    throw fail('CURRENCY_BASIS_UNRESOLVED', 'CURRENCY_BASIS_UNRESOLVED');
  }
  return currencyCode;
}

function assertNotBackdated(postingTimestamp, latestMovement) {
  if (!latestMovement) return;
  const latestMs = Date.parse(latestMovement.posting_timestamp);
  const postingMs = Date.parse(postingTimestamp);
  if (!Number.isFinite(latestMs) || !Number.isFinite(postingMs)) {
    throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
  }
  if (postingMs < latestMs) {
    throw fail('BACKDATED_VALUATION_REJECTED', 'BACKDATED_VALUATION_REJECTED');
  }
}

function buildResult({
  status,
  stockLocationId,
  stockIdentityType,
  stockIdentityId,
  quantityBase,
  unitCost,
  totalCost,
  costBasisType,
  sourceType,
  sourceReference,
  currencyCode,
  valuationVersion,
  latestMovementId,
  resolvedAt,
  idempotent = false
}) {
  const result = {
    status,
    valuation_method: VALUATION_METHOD,
    stock_location_id: stockLocationId,
    stock_identity_type: stockIdentityType,
    stock_identity_id: stockIdentityId,
    quantity_base: quantityBase,
    unit_cost: unitCost,
    total_cost: totalCost,
    cost_basis_type: costBasisType,
    valuation_state_reference: {
      valuation_version: valuationVersion,
      latest_movement_id: latestMovementId || null
    },
    source_type: sourceType || null,
    source_reference: sourceReference,
    currency_code: currencyCode,
    resolved_at: resolvedAt,
    resolver_version: RESOLVER_VERSION
  };

  if (idempotent) result.idempotent = true;
  return result;
}

function lookupExistingMovement({ repository, stockIdentityType, stockIdentityId, stockLocationId, postingMutationId }) {
  if (stockIdentityType === 'PRODUCT') {
    return repository.findProductValuationMovementByPostingMutationId(postingMutationId);
  }
  return repository.findMaterialValuationMovementByPostingMutationId(postingMutationId);
}

function assertExistingMovementMatches({ existing, stockIdentityType, stockIdentityId, stockLocationId }) {
  if (!existing) return;
  const existingIdentityId = stockIdentityType === 'PRODUCT' ? existing.product_id : existing.material_id;
  if (
    String(existing.stock_location_id) !== String(stockLocationId) ||
    String(existingIdentityId) !== String(stockIdentityId)
  ) {
    throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
  }
}

/**
 * Resolves inventory cost only. It never mutates stock.
 *
 * IMPORTANT: Authoritative callers must execute this inside the same DB
 * transaction that updates the valuation balance and appends the movement.
 */
class CostResolutionService {
  static resolveOutboundCost({
    stockLocationId,
    stockIdentityType,
    stockIdentityId,
    quantityBase,
    postingReference,
    postingMutationId,
    postingTimestamp,
    currencyCode,
    sourceType = null,
    repository = inventoryRepository
  }) {
    const identityType = assertIdentityType(stockIdentityType);
    const qty = assertPositiveQuantity(quantityBase);
    const reference = assertPostingReference(postingReference);
    const mutationId = assertPostingReference(postingMutationId);
    const timestamp = assertPostingTimestamp(postingTimestamp);

    assertLocationAndIdentity({
      repository,
      stockLocationId,
      stockIdentityType: identityType,
      stockIdentityId
    });

    const existing = lookupExistingMovement({
      repository,
      stockIdentityType: identityType,
      stockIdentityId,
      stockLocationId,
      postingMutationId: mutationId
    });
    assertExistingMovementMatches({
      existing,
      stockIdentityType: identityType,
      stockIdentityId,
      stockLocationId
    });

    if (existing) {
      if (String(existing.posting_mutation_id) !== mutationId) {
        throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
      }
      return buildResult({
        status: existing.cost_basis_type === 'OPENING_ESTIMATE' ? 'ESTIMATED' : 'AVAILABLE',
        stockLocationId,
        stockIdentityType: identityType,
        stockIdentityId,
        quantityBase: Math.abs(Number(existing[identityType === 'PRODUCT' ? 'quantity' : 'quantity_base'])),
        unitCost: Math.abs(Number(existing.unit_cost)),
        totalCost: Math.abs(Number(existing.total_cost)),
        costBasisType: existing.cost_basis_type,
        sourceType: existing.source_type,
        sourceReference: existing.source_reference || reference,
        currencyCode: assertCurrencyCode(existing.currency_code || currencyCode),
        valuationVersion: Number(existing.valuation_version),
        latestMovementId: existing.id,
        resolvedAt: timestamp,
        idempotent: true
      });
    }

    const latest = identityType === 'PRODUCT'
      ? repository.findLatestProductValuationMovement({ stockLocationId, productId: stockIdentityId })
      : repository.findLatestMaterialValuationMovement({ stockLocationId, materialId: stockIdentityId });

    assertNotBackdated(timestamp, latest);

    const currency = currencyCode
      ? assertCurrencyCode(currencyCode)
      : assertCurrencyCode(latest && latest.currency_code);

    assertCurrencyContinuity(currency, latest);

    const rawBalance = identityType === 'PRODUCT'
      ? repository.findProductValuationBalance({ stockLocationId, productId: stockIdentityId })
      : repository.findMaterialValuationBalance({ stockLocationId, materialId: stockIdentityId });
    const balance = normalizeBalance(rawBalance);

    if (balance.quantity + QUANTITY_EPSILON < qty) {
      throw fail('INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK');
    }

    if (balance.costAvailabilityStatus !== 'AVAILABLE') {
      throw fail('COST_UNAVAILABLE', 'COST_UNAVAILABLE');
    }

    if (balance.quantity > 0 && !latest) {
      throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
    }

    const unitCost = balance.movingAverageUnitCost;
    const totalCost = qty * unitCost;

    return buildResult({
      status: 'AVAILABLE',
      stockLocationId,
      stockIdentityType: identityType,
      stockIdentityId,
      quantityBase: qty,
      unitCost,
      totalCost,
      costBasisType: 'CURRENT_MOVING_AVERAGE',
      sourceType,
      sourceReference: reference,
      currencyCode: currency,
      valuationVersion: balance.valuationVersion,
      latestMovementId: latest ? latest.id : null,
      resolvedAt: new Date().toISOString()
    });
  }

  static resolveInboundValuation({
    stockLocationId,
    stockIdentityType,
    stockIdentityId,
    quantityBase,
    costBasisType,
    incomingUnitCost,
    incomingTotalCost,
    sourceType,
    sourceReference,
    postingMutationId,
    postingTimestamp,
    currencyCode,
    sourceMovementId = null,
    repository = inventoryRepository
  }) {
    const identityType = assertIdentityType(stockIdentityType);
    const qty = assertPositiveQuantity(quantityBase);
    const basis = normalizeText(costBasisType).toUpperCase();
    if (!COST_BASIS_TYPES.has(basis)) {
      throw fail('INBOUND_COST_UNRESOLVED', 'INBOUND_COST_UNRESOLVED');
    }

    const unitCost = Number(incomingUnitCost);
    const totalCost = Number(incomingTotalCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw fail('INBOUND_COST_UNRESOLVED', 'INBOUND_COST_UNRESOLVED');
    }
    if (!Number.isFinite(totalCost) || totalCost < 0 || Math.abs(totalCost - (qty * unitCost)) > VALUE_EPSILON) {
      throw fail('INBOUND_COST_UNRESOLVED', 'INBOUND_COST_UNRESOLVED');
    }

    const reference = assertPostingReference(sourceReference);
    const mutationId = assertPostingReference(postingMutationId);
    const timestamp = assertPostingTimestamp(postingTimestamp);
    const currency = assertCurrencyCode(currencyCode);
    const normalizedSourceType = normalizeText(sourceType);
    if (!normalizedSourceType) {
      throw fail('SOURCE_REFERENCE_REQUIRED', 'SOURCE_REFERENCE_REQUIRED');
    }

    if (basis === 'PRODUCTION_OUTPUT' && (!Number.isFinite(unitCost) || incomingUnitCost === null || incomingUnitCost === undefined)) {
      throw fail('PRODUCTION_OUTPUT_COST_REQUIRED', 'PRODUCTION_OUTPUT_COST_REQUIRED');
    }
    if (basis === 'TRANSFER_CARRIED' && !normalizeText(sourceMovementId)) {
      throw fail('TRANSFER_COST_SOURCE_INVALID', 'TRANSFER_COST_SOURCE_INVALID');
    }

    assertLocationAndIdentity({
      repository,
      stockLocationId,
      stockIdentityType: identityType,
      stockIdentityId
    });

    if (basis === 'TRANSFER_CARRIED') {
      const sourceMovement = identityType === 'PRODUCT'
        ? repository.findProductValuationMovementById(sourceMovementId)
        : repository.findMaterialValuationMovementById(sourceMovementId);

      const sourceQuantity = sourceMovement
        ? Number(identityType === 'PRODUCT' ? sourceMovement.quantity : sourceMovement.quantity_base)
        : NaN;
      const sourceTotalCost = sourceMovement ? Number(sourceMovement.total_cost) : NaN;
      const sourceCurrency = sourceMovement
        ? normalizeText(sourceMovement.currency_code).toUpperCase()
        : '';

      if (
        !sourceMovement ||
        sourceMovement.movement_type !== 'TRANSFER_OUT' ||
        String(sourceMovement.stock_location_id) === String(stockLocationId) ||
        String(identityType === 'PRODUCT' ? sourceMovement.product_id : sourceMovement.material_id) !== String(stockIdentityId) ||
        !Number.isFinite(sourceQuantity) ||
        sourceQuantity >= 0 ||
        Math.abs(Math.abs(sourceQuantity) - qty) > QUANTITY_EPSILON ||
        !Number.isFinite(sourceTotalCost) ||
        Math.abs(sourceTotalCost + totalCost) > VALUE_EPSILON ||
        sourceCurrency !== currency
      ) {
        throw fail('TRANSFER_COST_SOURCE_INVALID', 'TRANSFER_COST_SOURCE_INVALID');
      }
    }

    const existing = lookupExistingMovement({
      repository,
      stockIdentityType: identityType,
      stockIdentityId,
      stockLocationId,
      postingMutationId: mutationId
    });
    assertExistingMovementMatches({
      existing,
      stockIdentityType: identityType,
      stockIdentityId,
      stockLocationId
    });

    if (existing) {
      return buildResult({
        status: existing.cost_basis_type === 'OPENING_ESTIMATE' ? 'ESTIMATED' : 'AVAILABLE',
        stockLocationId,
        stockIdentityType: identityType,
        stockIdentityId,
        quantityBase: Math.abs(Number(existing[identityType === 'PRODUCT' ? 'quantity' : 'quantity_base'])),
        unitCost: Math.abs(Number(existing.unit_cost)),
        totalCost: Math.abs(Number(existing.total_cost)),
        costBasisType: existing.cost_basis_type,
        sourceType: existing.source_type,
        sourceReference: existing.source_reference,
        currencyCode: assertCurrencyCode(existing.currency_code),
        valuationVersion: Number(existing.valuation_version),
        latestMovementId: existing.id,
        resolvedAt: timestamp,
        idempotent: true
      });
    }

    const latest = identityType === 'PRODUCT'
      ? repository.findLatestProductValuationMovement({ stockLocationId, productId: stockIdentityId })
      : repository.findLatestMaterialValuationMovement({ stockLocationId, materialId: stockIdentityId });

    assertNotBackdated(timestamp, latest);
    assertCurrencyContinuity(currency, latest);

    const rawBalance = identityType === 'PRODUCT'
      ? repository.findProductValuationBalance({ stockLocationId, productId: stockIdentityId })
      : repository.findMaterialValuationBalance({ stockLocationId, materialId: stockIdentityId });
    const balance = normalizeBalance(rawBalance);

    if (balance.quantity > 0 && !latest) {
      throw fail('VALUATION_STATE_INVALID', 'VALUATION_STATE_INVALID');
    }

    const newQuantity = balance.quantity + qty;
    const newValue = balance.carryingValue + totalCost;
    const newAverage = newValue / newQuantity;
    const nextStatus =
      balance.costAvailabilityStatus === 'ESTIMATED' || basis === 'OPENING_ESTIMATE'
        ? 'ESTIMATED'
        : 'AVAILABLE';

    const nextVersion = balance.valuationVersion + 1;

    return buildResult({
      status: nextStatus,
      stockLocationId,
      stockIdentityType: identityType,
      stockIdentityId,
      quantityBase: qty,
      unitCost,
      totalCost,
      costBasisType: basis,
      sourceType: normalizedSourceType,
      sourceReference: reference,
      currencyCode: currency,
      valuationVersion: nextVersion,
      latestMovementId: latest ? latest.id : null,
      resolvedAt: new Date().toISOString()
    });
  }

  /**
   * Calculates the Moving Average state transition without persisting it.
   * The caller must apply this transition atomically with stock and movement
   * posting using the exact balance/version returned by the resolver.
   */
  static applyInboundTransition({ balance, quantityBase, totalCost, nextStatus = null }) {
    const state = normalizeBalance(balance);
    const qty = assertPositiveQuantity(quantityBase);
    const value = Number(totalCost);
    if (!Number.isFinite(value) || value < 0) {
      throw fail('INBOUND_COST_UNRESOLVED', 'INBOUND_COST_UNRESOLVED');
    }

    const quantity = state.quantity + qty;
    const carryingValue = state.carryingValue + value;
    const movingAverageUnitCost = carryingValue / quantity;

    return {
      quantity,
      carrying_value: carryingValue,
      moving_average_unit_cost: movingAverageUnitCost,
      cost_availability_status:
        nextStatus ||
        (state.costAvailabilityStatus === 'ESTIMATED' ? 'ESTIMATED' : 'AVAILABLE'),
      valuation_version: state.valuationVersion + 1
    };
  }

  static applyOutboundTransition({ balance, quantityBase }) {
    const state = normalizeBalance(balance);
    const qty = assertPositiveQuantity(quantityBase);

    if (qty > state.quantity + QUANTITY_EPSILON) {
      throw fail('INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK');
    }
    if (state.costAvailabilityStatus !== 'AVAILABLE') {
      throw fail('COST_UNAVAILABLE', 'COST_UNAVAILABLE');
    }

    const quantity = state.quantity - qty;
    const outgoingValue = qty * state.movingAverageUnitCost;
    const carryingValue = state.carryingValue - outgoingValue;
    if (carryingValue < -VALUE_EPSILON) {
      throw fail('VALUATION_VALUE_MISMATCH', 'VALUATION_VALUE_MISMATCH');
    }

    const normalizedValue = Math.abs(carryingValue) <= VALUE_EPSILON ? 0 : carryingValue;
    const movingAverageUnitCost = quantity <= QUANTITY_EPSILON ? 0 : normalizedValue / quantity;

    return {
      quantity: quantity <= QUANTITY_EPSILON ? 0 : quantity,
      carrying_value: normalizedValue,
      moving_average_unit_cost: movingAverageUnitCost,
      cost_availability_status: quantity <= QUANTITY_EPSILON ? 'UNAVAILABLE' : 'AVAILABLE',
      valuation_version: state.valuationVersion + 1,
      outgoing_unit_cost: state.movingAverageUnitCost,
      outgoing_total_cost: outgoingValue
    };
  }

  static previewCurrentUnitCost({
    stockLocationId,
    stockIdentityType,
    stockIdentityId,
    repository = inventoryRepository
  }) {
    const identityType = assertIdentityType(stockIdentityType);
    assertLocationAndIdentity({
      repository,
      stockLocationId,
      stockIdentityType: identityType,
      stockIdentityId
    });

    const rawBalance = identityType === 'PRODUCT'
      ? repository.findProductValuationBalance({ stockLocationId, productId: stockIdentityId })
      : repository.findMaterialValuationBalance({ stockLocationId, materialId: stockIdentityId });
    const balance = normalizeBalance(rawBalance);

    return {
      status: balance.costAvailabilityStatus,
      valuation_method: VALUATION_METHOD,
      stock_location_id: stockLocationId,
      stock_identity_type: identityType,
      stock_identity_id: stockIdentityId,
      quantity_base: balance.quantity,
      unit_cost: balance.movingAverageUnitCost,
      total_value: balance.carryingValue,
      valuation_version: balance.valuationVersion,
      resolver_version: RESOLVER_VERSION
    };
  }
}

module.exports = CostResolutionService;
