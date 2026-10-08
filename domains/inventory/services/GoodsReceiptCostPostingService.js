'use strict';

const crypto = require('crypto');
const { InventoryRepository } = require('../../../core/data/repositories');
const CostResolutionService = require('./CostResolutionService');

const inventoryRepository = new InventoryRepository();
const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const text = (v, code) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) throw fail(code); return s; };
const movementId = (mutationId) => 'grm_' + crypto.createHash('sha256').update(mutationId).digest('hex').slice(0, 24);

function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw fail('GOODS_RECEIPT_LINES_REQUIRED');
  const seen = new Set();
  return lines.map((line) => {
    if (!line || typeof line !== 'object') throw fail('GOODS_RECEIPT_LINE_INVALID');
    const materialId = text(line.material_id, 'MATERIAL_NOT_FOUND');
    const mutationId = text(line.posting_mutation_id, 'GOODS_RECEIPT_LINE_POSTING_MUTATION_ID_REQUIRED');
    if (seen.has(mutationId)) throw fail('GOODS_RECEIPT_LINE_MUTATION_DUPLICATE');
    seen.add(mutationId);
    const quantityBase = Number(line.accepted_quantity_base);
    const unitCost = Number(line.incoming_unit_cost);
    const totalCost = Number(line.incoming_total_cost);
    if (!Number.isFinite(quantityBase) || quantityBase <= 0) throw fail('INVALID_QUANTITY');
    if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(totalCost) || totalCost < 0) throw fail('INBOUND_COST_UNRESOLVED');
    return { materialId, mutationId, quantityBase, unitCost, totalCost, currencyCode: text(line.currency_code, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase(), notes: line.notes || null };
  });
}

class GoodsReceiptCostPostingService {
  static postGoodsReceipt({ goodsReceiptId, goodsReceiptPostingId, stockLocationId, postingTimestamp, actorId = null, lines, repository = inventoryRepository }) {
    const receiptId = text(goodsReceiptId, 'GOODS_RECEIPT_ID_REQUIRED');
    const aggregateId = text(goodsReceiptPostingId, 'GOODS_RECEIPT_POSTING_ID_REQUIRED');
    const locationId = text(stockLocationId, 'STOCK_LOCATION_REQUIRED');
    const timestamp = text(postingTimestamp, 'POSTING_TIMESTAMP_REQUIRED');
    const normalizedLines = normalizeLines(lines);

    const existing = normalizedLines.map((line) => repository.findMaterialValuationMovementByPostingMutationId(line.mutationId));
    const existingCount = existing.filter(Boolean).length;
    if (existingCount > 0 && existingCount !== normalizedLines.length) throw fail('GOODS_RECEIPT_POSTING_INCOMPLETE');
    if (existingCount === normalizedLines.length) {
      for (const m of existing) {
        if (m.stock_location_id !== locationId || m.source_type !== 'GOODS_RECEIPT' || m.source_reference !== receiptId) throw fail('GOODS_RECEIPT_POSTING_IDENTITY_MISMATCH');
      }
      return { success: true, idempotent: true, goods_receipt_id: receiptId, goods_receipt_posting_id: aggregateId, stock_location_id: locationId, posting_timestamp: timestamp,
        movements: existing.map((m) => ({ movement_id: m.id, material_id: m.material_id, accepted_quantity_base: Number(m.quantity_base), unit_cost: Number(m.unit_cost), total_cost: Number(m.total_cost), currency_code: m.currency_code, valuation_version: Number(m.valuation_version), posting_mutation_id: m.posting_mutation_id })) };
    }

    if (repository.findMaterialValuationMovementsBySourceReference({ sourceType: 'GOODS_RECEIPT', sourceReference: receiptId }).length > 0) throw fail('GOODS_RECEIPT_ALREADY_POSTED');

    repository.beginTransaction();
    try {
      const posted = [];
      for (const line of normalizedLines) {
        const resolution = CostResolutionService.resolveInboundValuation({
          stockLocationId: locationId, stockIdentityType: 'MATERIAL', stockIdentityId: line.materialId,
          quantityBase: line.quantityBase, costBasisType: 'PURCHASE_RECEIPT', incomingUnitCost: line.unitCost, incomingTotalCost: line.totalCost,
          sourceType: 'GOODS_RECEIPT', sourceReference: receiptId, postingMutationId: line.mutationId, postingTimestamp: timestamp,
          currencyCode: line.currencyCode, repository
        });
        const balance = repository.findMaterialValuationBalance({ stockLocationId: locationId, materialId: line.materialId });
        const transition = CostResolutionService.applyInboundTransition({ balance, quantityBase: resolution.quantity_base, totalCost: resolution.total_cost, nextStatus: resolution.status });
        const now = new Date().toISOString();
        if (balance) {
          const updated = repository.updateMaterialValuationBalance({ stockLocationId: locationId, materialId: line.materialId, quantityBase: transition.quantity, carryingValue: transition.carrying_value, movingAverageUnitCost: transition.moving_average_unit_cost, costAvailabilityStatus: transition.cost_availability_status, valuationVersion: transition.valuation_version, updatedAt: now });
          if (!updated || updated.changes !== 1) throw fail('VALUATION_STATE_INVALID');
        } else {
          repository.insertMaterialValuationBalance({ stockLocationId: locationId, materialId: line.materialId, quantityBase: transition.quantity, carryingValue: transition.carrying_value, movingAverageUnitCost: transition.moving_average_unit_cost, costAvailabilityStatus: transition.cost_availability_status, valuationVersion: transition.valuation_version, createdAt: now, updatedAt: now });
        }
        const inserted = repository.insertMaterialValuationMovement({ id: movementId(line.mutationId), stockLocationId: locationId, materialId: line.materialId, movementType: 'PURCHASE_RECEIPT', quantityBase: resolution.quantity_base, previousQuantity: balance ? Number(balance.quantity_base) : 0, currentQuantity: transition.quantity, unitCost: resolution.unit_cost, totalCost: resolution.total_cost, currencyCode: resolution.currency_code, costBasisType: 'PURCHASE_RECEIPT', sourceType: 'GOODS_RECEIPT', sourceReference: receiptId, postingMutationId: line.mutationId, valuationVersion: transition.valuation_version, postingTimestamp: timestamp, resolverVersion: resolution.resolver_version, actorId, notes: line.notes || ('Goods Receipt ' + receiptId) });
        if (!inserted || inserted.changes !== 1) throw fail('VALUATION_STATE_INVALID');
        posted.push({ movement_id: movementId(line.mutationId), material_id: line.materialId, accepted_quantity_base: resolution.quantity_base, unit_cost: resolution.unit_cost, total_cost: resolution.total_cost, currency_code: resolution.currency_code, valuation_version: transition.valuation_version, posting_mutation_id: line.mutationId });
      }
      repository.commitTransaction();
      return { success: true, idempotent: false, goods_receipt_id: receiptId, goods_receipt_posting_id: aggregateId, stock_location_id: locationId, posting_timestamp: timestamp, movements: posted };
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }
  }
}

module.exports = GoodsReceiptCostPostingService;
