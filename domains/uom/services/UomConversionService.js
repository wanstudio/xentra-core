'use strict';

const UomRepository = require('../../../core/data/repositories/UomRepository');

const repository = new UomRepository();
const MAX_CONVERSION_FACTOR_DECIMALS = 12;
const MAX_STOCK_QUANTITY_DECIMALS = 6;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveNumber(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw fail(code);
  return n;
}

function roundHalfUp(value, precision) {
  const factor = 10 ** precision;
  const rounded = Math.floor((value * factor) + 0.5) / factor;
  return Number(rounded.toFixed(precision));
}

class UomConversionService {
  static getUom(uomId, repo = repository) {
    const uom = repo.findById(uomId);
    if (!uom || Number(uom.is_active) !== 1) throw fail('UOM_NOT_FOUND');
    return uom;
  }

  static convertQuantity({ quantity, sourceUomId, targetUomId, repository: repo = repository }) {
    const sourceQuantity = positiveNumber(quantity, 'INVALID_QUANTITY');
    const source = this.getUom(sourceUomId, repo);
    const target = this.getUom(targetUomId, repo);

    if (String(source.category_id) !== String(target.category_id)) {
      throw fail('UOM_CATEGORY_MISMATCH');
    }

    const rawTargetQuantity =
      sourceQuantity * Number(source.conversion_factor) / Number(target.conversion_factor);

    if (!Number.isFinite(rawTargetQuantity)) throw fail('UOM_CONVERSION_INVALID');

    const precision = Math.min(
      MAX_STOCK_QUANTITY_DECIMALS,
      Math.max(0, Number(target.quantity_precision))
    );

    if (Number(target.allows_fraction) !== 1) {
      const whole = roundHalfUp(rawTargetQuantity, 0);
      if (Math.abs(rawTargetQuantity - whole) > 1e-9) {
        throw fail('UOM_FRACTION_NOT_ALLOWED');
      }
      return {
        source_uom_id: source.id,
        target_uom_id: target.id,
        source_quantity: sourceQuantity,
        raw_target_quantity: rawTargetQuantity,
        target_quantity: whole,
        rounding_mode: 'HALF_UP',
        target_precision: 0
      };
    }

    return {
      source_uom_id: source.id,
      target_uom_id: target.id,
      source_quantity: sourceQuantity,
      raw_target_quantity: rawTargetQuantity,
      target_quantity: roundHalfUp(rawTargetQuantity, precision),
      rounding_mode: 'HALF_UP',
      target_precision: precision
    };
  }

  static resolveBaseQuantity({ materialId, sourceUomId, quantity, repository: repo = repository }) {
    const material = repo.db.queryOne(
      'SELECT id, base_uom_id, status FROM materials WHERE id = ?',
      [materialId]
    );
    if (!material || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND');
    return this.convertQuantity({
      quantity,
      sourceUomId,
      targetUomId: material.base_uom_id,
      repository: repo
    });
  }
}

module.exports = UomConversionService;
