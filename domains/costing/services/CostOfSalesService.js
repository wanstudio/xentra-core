'use strict';

const crypto = require('crypto');
const CostingRepository = require('../../../core/data/repositories/CostingRepository');

const repository = new CostingRepository();

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

function nonNegative(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw fail(code);
  return n;
}

function stableId(sourceType, sourceReference) {
  return 'cogs_' + crypto.createHash('sha256')
    .update(sourceType + ':' + sourceReference)
    .digest('hex')
    .slice(0, 24);
}

class CostOfSalesService {
  /**
   * Captures the immutable Cost of Sales snapshot produced by a canonical
   * Inventory SALE movement set. Caller owns the surrounding transaction.
   */
  static capture({
    sourceType = 'ORDER',
    sourceReference,
    orderId = null,
    totalCost,
    currencyCode,
    costLines,
    repository: repo = repository
  }) {
    const type = text(sourceType, 'COST_OF_SALES_SOURCE_TYPE_REQUIRED').toUpperCase();
    const reference = text(sourceReference, 'COST_OF_SALES_SOURCE_REFERENCE_REQUIRED');
    const total = nonNegative(totalCost, 'COST_OF_SALES_TOTAL_INVALID');
    const currency = text(currencyCode, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();

    if (!Array.isArray(costLines) || costLines.length === 0) {
      throw fail('COST_OF_SALES_LINES_REQUIRED');
    }

    if (!/^[A-Z]{3}$/.test(currency)) throw fail('CURRENCY_BASIS_UNRESOLVED');

    const existing = repo.findCostOfSalesSnapshot({
      sourceType: type,
      sourceReference: reference
    });

    if (existing) {
      const existingLines = repo.findCostOfSalesSnapshotLines(existing.id);
      return {
        success: true,
        idempotent: true,
        snapshot: existing,
        lines: existingLines
      };
    }

    let computed = 0;
    const currencies = new Set();

    for (const line of costLines) {
      const quantity = positive(line.quantity, 'COST_OF_SALES_QUANTITY_INVALID');
      const unitCost = nonNegative(line.unit_cost, 'COST_OF_SALES_UNIT_COST_INVALID');
      const lineTotal = nonNegative(line.total_cost, 'COST_OF_SALES_LINE_TOTAL_INVALID');
      const lineCurrency = text(line.currency_code, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();
      const movementId = text(line.inventory_movement_id, 'COST_OF_SALES_MOVEMENT_REQUIRED');

      if (Math.abs(lineTotal - (quantity * unitCost)) > 0.000001) {
        throw fail('COST_OF_SALES_LINE_TOTAL_MISMATCH');
      }
      if (lineCurrency !== currency) throw fail('COST_CURRENCY_MISMATCH');

      computed += lineTotal;
      currencies.add(lineCurrency);

      const movement = repo.db.queryOne(
        'SELECT id, movement_type, quantity, total_cost, currency_code FROM product_stock_movements WHERE id = ?',
        [movementId]
      );
      if (
        !movement ||
        movement.movement_type !== 'SALE' ||
        Math.abs(Number(movement.quantity) + quantity) > 0.000001 ||
        Math.abs(Number(movement.total_cost) + lineTotal) > 0.000001 ||
        String(movement.currency_code).toUpperCase() !== lineCurrency
      ) {
        throw fail('COST_OF_SALES_MOVEMENT_EVIDENCE_INVALID');
      }
    }

    if (currencies.size !== 1 || Math.abs(computed - total) > 0.000001) {
      throw fail('COST_OF_SALES_TOTAL_MISMATCH');
    }

    const snapshotId = stableId(type, reference);
    repo.insertCostOfSalesSnapshot({
      id: snapshotId,
      sourceType: type,
      sourceReference: reference,
      orderId,
      totalCost: total,
      currencyCode: currency,
      createdAt: new Date().toISOString()
    });

    for (const line of costLines) {
      repo.insertCostOfSalesSnapshotLine({
        id: 'cogsl_' + crypto.randomBytes(8).toString('hex'),
        snapshotId,
        sourceItemReference: line.source_item_reference || null,
        productId: text(line.product_id, 'PRODUCT_NOT_FOUND'),
        quantity: positive(line.quantity, 'COST_OF_SALES_QUANTITY_INVALID'),
        unitCost: nonNegative(line.unit_cost, 'COST_OF_SALES_UNIT_COST_INVALID'),
        totalCost: nonNegative(line.total_cost, 'COST_OF_SALES_LINE_TOTAL_INVALID'),
        currencyCode: text(line.currency_code, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase(),
        inventoryMovementId: text(line.inventory_movement_id, 'COST_OF_SALES_MOVEMENT_REQUIRED'),
        createdAt: new Date().toISOString()
      });
    }

    return {
      success: true,
      idempotent: false,
      snapshot: repo.findCostOfSalesSnapshot({
        sourceType: type,
        sourceReference: reference
      }),
      lines: repo.findCostOfSalesSnapshotLines(snapshotId)
    };
  }
}

module.exports = CostOfSalesService;
