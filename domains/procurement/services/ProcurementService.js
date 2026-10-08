'use strict';

const crypto = require('crypto');
const ProcurementRepository = require('../../../core/data/repositories/ProcurementRepository');
const MaterialRepository = require('../../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../../core/data/repositories/UomRepository');
const UomConversionService = require('../../uom/services/UomConversionService');
const { GoodsReceiptCostPostingService } = require('../../inventory');

const procurementRepository = new ProcurementRepository();
const materialRepository = new MaterialRepository();
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

function nonNegative(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw fail(code);
  return n;
}

function currency(value) {
  const code = text(value, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw fail('CURRENCY_BASIS_UNRESOLVED');
  return code;
}

function roundHalfUp(value, precision) {
  const factor = 10 ** precision;
  return Number((Math.floor(value * factor + 0.5) / factor).toFixed(precision));
}

function movementMutationId(postingId, receiptLineId) {
  return 'grm_' + crypto.createHash('sha256').update(postingId + ':' + receiptLineId).digest('hex').slice(0, 24);
}

function materialBaseUom(materialId) {
  const material = materialRepository.findById(materialId);
  if (!material || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND');
  const base = uomRepository.findById(material.base_uom_id);
  if (!base || Number(base.is_active) !== 1) throw fail('BASE_UOM_UNRESOLVED');
  return { material, base };
}

function validatePurchaseRepresentation({ supplierMaterial, purchaseUomId, supplierPackId }) {
  if ((purchaseUomId && supplierPackId) || (!purchaseUomId && !supplierPackId)) {
    throw fail('PURCHASE_REPRESENTATION_REQUIRED');
  }

  if (purchaseUomId) {
    const uom = uomRepository.findById(purchaseUomId);
    if (!uom || Number(uom.is_active) !== 1) throw fail('UOM_NOT_FOUND');
    return { kind: 'UOM', uom };
  }

  const pack = procurementRepository.findSupplierMaterialPack(supplierPackId);
  if (!pack || Number(pack.is_active) !== 1 || String(pack.supplier_material_id) !== String(supplierMaterial.id)) {
    throw fail('SUPPLIER_MATERIAL_PACK_NOT_FOUND');
  }
  return { kind: 'PACK', pack };
}

function buildPurchaseLine({ supplierMaterial, quantity, purchaseUomId, supplierPackId, unitPrice, currencyCode }) {
  const { material, base } = materialBaseUom(supplierMaterial.material_id);
  const representation = validatePurchaseRepresentation({ supplierMaterial, purchaseUomId, supplierPackId });

  let resolvedBaseQuantity;
  let baseQuantityPerPurchaseUnit;
  let agreedPrice = unitPrice;
  let agreedCurrency = currencyCode;

  if (representation.kind === 'UOM') {
    if (String(representation.uom.category_id) !== String(base.category_id)) {
      throw fail('UOM_CATEGORY_MISMATCH');
    }
    const converted = UomConversionService.convertQuantity({
      quantity,
      sourceUomId: representation.uom.id,
      targetUomId: base.id,
      repository: uomRepository
    });
    resolvedBaseQuantity = converted.target_quantity;
    baseQuantityPerPurchaseUnit =
      Number(representation.uom.conversion_factor) / Number(base.conversion_factor);

    if (agreedPrice === undefined || agreedPrice === null) throw fail('PURCHASE_PRICE_REQUIRED');
    if (agreedCurrency === undefined || agreedCurrency === null) throw fail('CURRENCY_BASIS_UNRESOLVED');
  } else {
    if (Number(representation.pack.content_quantity_base) <= 0) throw fail('SUPPLIER_MATERIAL_PACK_INVALID');

    const contentUom = uomRepository.findById(representation.pack.content_uom_id);
    if (!contentUom || Number(contentUom.is_active) !== 1) throw fail('SUPPLIER_MATERIAL_PACK_UOM_INVALID');
    if (String(contentUom.category_id) !== String(base.category_id)) throw fail('UOM_CATEGORY_MISMATCH');

    baseQuantityPerPurchaseUnit = Number(representation.pack.content_quantity_base);
    const rawBaseQuantity = Number(quantity) * baseQuantityPerPurchaseUnit;
    resolvedBaseQuantity = roundHalfUp(rawBaseQuantity, Number(base.quantity_precision));

    if (agreedPrice === undefined || agreedPrice === null) agreedPrice = Number(representation.pack.unit_price);
    if (agreedCurrency === undefined || agreedCurrency === null) agreedCurrency = representation.pack.currency_code;
  }

  const price = nonNegative(agreedPrice, 'PURCHASE_PRICE_INVALID');
  const cur = currency(agreedCurrency);

  if (!Number.isFinite(baseQuantityPerPurchaseUnit) || baseQuantityPerPurchaseUnit <= 0) {
    throw fail('BASE_UOM_UNRESOLVED');
  }
  if (resolvedBaseQuantity <= 0) throw fail('INVALID_QUANTITY');

  return {
    material,
    baseUom: base,
    resolvedBaseQuantity,
    baseQuantityPerPurchaseUnit,
    unitPrice: price,
    currencyCode: cur,
    purchaseUomId: representation.kind === 'UOM' ? representation.uom.id : null,
    supplierPackId: representation.kind === 'PACK' ? representation.pack.id : null
  };
}

class ProcurementService {
  static createSupplier({ organizationId, supplierCode, name, status = 'DRAFT', repository = procurementRepository }) {
    const orgId = text(organizationId, 'ORGANIZATION_REQUIRED');
    const code = text(supplierCode, 'SUPPLIER_CODE_REQUIRED');
    const supplierName = text(name, 'SUPPLIER_NAME_REQUIRED');
    const lifecycle = String(status || 'DRAFT').toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(lifecycle)) throw fail('SUPPLIER_STATUS_INVALID');

    if (repository.findSupplierByCode(orgId, code)) throw fail('SUPPLIER_CODE_ALREADY_EXISTS');
    const id = 'sup_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    repository.insertSupplier({ id, organizationId: orgId, supplierCode: code, name: supplierName, status: lifecycle, createdAt: now, updatedAt: now });
    return repository.findSupplier(id);
  }

  static createSupplierMaterial({ supplierId, materialId, supplierItemCode = null, repository = procurementRepository }) {
    const supplier = repository.findSupplier(supplierId);
    if (!supplier || supplier.status === 'ARCHIVED') throw fail('SUPPLIER_NOT_FOUND');
    const material = materialRepository.findById(materialId);
    if (!material || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND');
    if (String(supplier.organization_id) !== String(material.organization_id)) throw fail('SUPPLIER_MATERIAL_ORG_SCOPE_INVALID');

    if (repository.findSupplierMaterialByIdentity(supplierId, materialId)) throw fail('SUPPLIER_MATERIAL_ALREADY_EXISTS');
    const id = 'sm_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    repository.insertSupplierMaterial({ id, supplierId, materialId, supplierItemCode, createdAt: now, updatedAt: now });
    return repository.findSupplierMaterial(id);
  }

  static createSupplierMaterialPack({
    supplierMaterialId,
    name,
    contentQuantityBase,
    contentUomId,
    unitPrice,
    currencyCode,
    minimumOrderQuantity = 1,
    repository = procurementRepository
  }) {
    const supplierMaterial = repository.findSupplierMaterial(supplierMaterialId);
    if (!supplierMaterial || Number(supplierMaterial.is_active) !== 1) throw fail('SUPPLIER_MATERIAL_NOT_FOUND');

    const materialInfo = materialBaseUom(supplierMaterial.material_id);
    const contentUom = uomRepository.findById(contentUomId);
    if (!contentUom || Number(contentUom.is_active) !== 1) throw fail('SUPPLIER_MATERIAL_PACK_UOM_INVALID');
    if (String(contentUom.category_id) !== String(materialInfo.base.category_id)) throw fail('UOM_CATEGORY_MISMATCH');

    const content = positive(contentQuantityBase, 'SUPPLIER_MATERIAL_PACK_INVALID');
    const price = nonNegative(unitPrice, 'PURCHASE_PRICE_INVALID');
    const minQty = positive(minimumOrderQuantity, 'SUPPLIER_MATERIAL_PACK_INVALID');
    const cur = currency(currencyCode);

    const id = 'smp_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    repository.insertSupplierMaterialPack({
      id,
      supplierMaterialId,
      name: text(name, 'SUPPLIER_MATERIAL_PACK_NAME_REQUIRED'),
      purchaseUomId: null,
      contentQuantityBase: content,
      contentUomId: contentUom.id,
      minimumOrderQuantity: minQty,
      unitPrice: price,
      currencyCode: cur,
      createdAt: now,
      updatedAt: now
    });

    return repository.findSupplierMaterialPack(id);
  }

  static createPurchaseOrder({
    organizationId,
    supplierId,
    destinationStockLocationId,
    lines = [],
    createdBy = null,
    requiredAt = null,
    repository = procurementRepository,
  }) {
    const orgId = text(organizationId, 'ORGANIZATION_REQUIRED');
    const supplier = repository.findSupplier(supplierId);
    if (!supplier || supplier.status !== 'ACTIVE') throw fail('SUPPLIER_NOT_FOUND');
    if (String(supplier.organization_id) !== orgId) throw fail('SUPPLIER_ORG_SCOPE_INVALID');
    if (!Array.isArray(lines) || lines.length === 0) throw fail('PURCHASE_ORDER_LINES_REQUIRED');

    const destination = repository.db.queryOne(
      'SELECT id, organization_id, is_active FROM stock_locations WHERE id = ?',
      [destinationStockLocationId]
    );
    if (!destination || Number(destination.is_active) !== 1 || String(destination.organization_id) !== orgId) {
      throw fail('STOCK_LOCATION_INVALID');
    }

    const poId = 'po_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();

    repository.beginTransaction();
    try {
      repository.insertPurchaseOrder({
        id: poId,
        organizationId: orgId,
        supplierId,
        destinationStockLocationId,
        status: 'DRAFT',
        requiredAt,
        createdBy,
        createdAt: now,
        updatedAt: now
      });

      for (const input of lines) {
        const supplierMaterial = repository.findSupplierMaterial(input.supplier_material_id);
        if (!supplierMaterial || Number(supplierMaterial.is_active) !== 1) throw fail('SUPPLIER_MATERIAL_NOT_FOUND');
        if (String(supplierMaterial.organization_id) !== orgId) throw fail('SUPPLIER_MATERIAL_ORG_SCOPE_INVALID');

        const quantity = positive(input.ordered_purchase_quantity, 'INVALID_QUANTITY');
        const built = buildPurchaseLine({
          supplierMaterial,
          quantity,
          purchaseUomId: input.purchase_uom_id || null,
          supplierPackId: input.supplier_pack_id || null,
          unitPrice: input.unit_price,
          currencyCode: input.currency_code
        });

        repository.insertPurchaseOrderLine({
          id: 'pol_' + crypto.randomBytes(8).toString('hex'),
          purchaseOrderId: poId,
          supplierMaterialId: supplierMaterial.id,
          orderedPurchaseQuantity: quantity,
          purchaseUomId: built.purchaseUomId,
          supplierPackId: built.supplierPackId,
          resolvedBaseQuantity: built.resolvedBaseQuantity,
          unitPrice: built.unitPrice,
          currencyCode: built.currencyCode,
          baseQuantityPerPurchaseUnit: built.baseQuantityPerPurchaseUnit,
          createdAt: now,
          updatedAt: now
        });
      }

      repository.commitTransaction();
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }

    return repository.findPurchaseOrder(poId);
  }

  static approvePurchaseOrder({ purchaseOrderId, repository = procurementRepository }) {
    const po = repository.findPurchaseOrder(purchaseOrderId);
    if (!po) throw fail('PURCHASE_ORDER_NOT_FOUND');
    if (po.status !== 'DRAFT') throw fail('PURCHASE_ORDER_STATUS_INVALID');
    const now = new Date().toISOString();
    const result = repository.updatePurchaseOrderStatus({ id: po.id, status: 'APPROVED', updatedAt: now });
    if (!result || result.changes !== 1) throw fail('PURCHASE_ORDER_STATUS_INVALID');
    return repository.findPurchaseOrder(po.id);
  }

  static orderPurchaseOrder({ purchaseOrderId, repository = procurementRepository }) {
    const po = repository.findPurchaseOrder(purchaseOrderId);
    if (!po || !['DRAFT', 'APPROVED'].includes(po.status)) throw fail('PURCHASE_ORDER_STATUS_INVALID');
    const now = new Date().toISOString();
    const result = repository.updatePurchaseOrderStatus({ id: po.id, status: 'ORDERED', updatedAt: now, orderedAt: now });
    if (!result || result.changes !== 1) throw fail('PURCHASE_ORDER_STATUS_INVALID');
    return repository.findPurchaseOrder(po.id);
  }

  static postGoodsReceipt({
    purchaseOrderId,
    goodsReceiptId = null,
    goodsReceiptPostingId,
    receivedBy = null,
    receivedAt = null,
    lines = [],
    repository = procurementRepository
  }) {
    const po = repository.findPurchaseOrder(purchaseOrderId);
    if (!po) throw fail('PURCHASE_ORDER_NOT_FOUND');

    const postingId = text(goodsReceiptPostingId, 'GOODS_RECEIPT_POSTING_ID_REQUIRED');
    const receiptId = text(goodsReceiptId || ('gr_' + crypto.randomBytes(8).toString('hex')), 'GOODS_RECEIPT_ID_REQUIRED');

    const existingByPosting = repository.findGoodsReceiptPosting(postingId);
    if (existingByPosting) {
      if (existingByPosting.purchase_order_id !== po.id || existingByPosting.status !== 'POSTED') {
        throw fail('GOODS_RECEIPT_POSTING_IDENTITY_MISMATCH');
      }
      return {
        success: true,
        idempotent: true,
        goods_receipt_id: existingByPosting.id,
        goods_receipt_posting_id: existingByPosting.goods_receipt_posting_id,
        status: existingByPosting.status,
        purchase_order_id: existingByPosting.purchase_order_id,
        destination_stock_location_id: existingByPosting.destination_stock_location_id,
        lines: repository.findGoodsReceiptLines(existingByPosting.id)
      };
    }

    const existingReceipt = repository.findGoodsReceipt(receiptId);
    if (existingReceipt) throw fail('GOODS_RECEIPT_ALREADY_EXISTS');

    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw fail('GOODS_RECEIPT_NOT_ALLOWED');

    if (!Array.isArray(lines) || lines.length === 0) throw fail('GOODS_RECEIPT_LINES_REQUIRED');

    const normalized = [];
    const seenLines = new Set();
    for (const input of lines) {
      const poLineId = text(input.purchase_order_line_id, 'PURCHASE_ORDER_LINE_NOT_FOUND');
      if (seenLines.has(poLineId)) throw fail('GOODS_RECEIPT_LINE_DUPLICATE');
      seenLines.add(poLineId);

      const poLine = repository.findPurchaseOrderLine(poLineId);
      if (!poLine || String(poLine.purchase_order_id) !== String(po.id)) throw fail('PURCHASE_ORDER_LINE_NOT_FOUND');

      const acceptedPurchaseQuantity = positive(input.accepted_purchase_quantity, 'INVALID_QUANTITY');
      const rejectedPurchaseQuantity = nonNegative(input.rejected_purchase_quantity || 0, 'INVALID_QUANTITY');

      const remainingBase = Number(poLine.resolved_base_quantity) - Number(poLine.received_base_quantity || 0);
      const rawAcceptedBase = acceptedPurchaseQuantity * Number(poLine.base_quantity_per_purchase_unit);

      const material = materialRepository.findById(repository.findSupplierMaterial(poLine.supplier_material_id).material_id);
      if (!material || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND');
      const base = uomRepository.findById(material.base_uom_id);
      if (!base || Number(base.is_active) !== 1) throw fail('BASE_UOM_UNRESOLVED');

      const acceptedBaseQuantity = roundHalfUp(rawAcceptedBase, Number(base.quantity_precision));
      if (acceptedBaseQuantity <= 0 || acceptedBaseQuantity > remainingBase + 0.000001) {
        throw fail('GOODS_RECEIPT_OVER_QUANTITY');
      }

      const rejectedBaseQuantity = roundHalfUp(
        rejectedPurchaseQuantity * Number(poLine.base_quantity_per_purchase_unit),
        Number(base.quantity_precision)
      );
      if (acceptedBaseQuantity + rejectedBaseQuantity > remainingBase + 0.000001) {
        throw fail('GOODS_RECEIPT_OVER_QUANTITY');
      }

      const resolvedUnitCost = Number(poLine.unit_price) / Number(poLine.base_quantity_per_purchase_unit);
      if (!Number.isFinite(resolvedUnitCost) || resolvedUnitCost < 0) throw fail('INBOUND_COST_UNRESOLVED');

      const acceptedTotalCost = acceptedBaseQuantity * resolvedUnitCost;

      normalized.push({
        poLine,
        acceptedPurchaseQuantity,
        rejectedPurchaseQuantity,
        acceptedBaseQuantity,
        resolvedUnitCost,
        acceptedTotalCost,
        base,
        receiptLineId: 'grl_' + crypto.randomBytes(8).toString('hex')
      });
    }

    if (!normalized.some(line => line.acceptedBaseQuantity > 0)) {
      throw fail('GOODS_RECEIPT_ACCEPTED_LINES_REQUIRED');
    }

    const receivedTimestamp = receivedAt ? text(receivedAt, 'RECEIVED_AT_INVALID') : null;
    const postingTimestamp = new Date().toISOString();
    const actor = receivedBy || null;

    repository.beginTransaction();
    try {
      repository.insertGoodsReceipt({
        id: receiptId,
        purchaseOrderId: po.id,
        destinationStockLocationId: po.destination_stock_location_id,
        goodsReceiptPostingId: postingId,
        receivedBy: actor,
        receivedAt: receivedTimestamp || postingTimestamp,
        createdAt: postingTimestamp,
        updatedAt: postingTimestamp
      });

      const inventoryLines = normalized
        .filter(line => line.acceptedBaseQuantity > 0)
        .map(line => ({
          material_id: repository.findSupplierMaterial(line.poLine.supplier_material_id).material_id,
          accepted_quantity_base: line.acceptedBaseQuantity,
          incoming_unit_cost: line.resolvedUnitCost,
          incoming_total_cost: line.acceptedTotalCost,
          currency_code: line.poLine.currency_code,
          posting_mutation_id: movementMutationId(postingId, line.receiptLineId),
          source_line_reference: line.receiptLineId
        }));

      const inventoryResult = GoodsReceiptCostPostingService.postGoodsReceipt({
        goodsReceiptId: receiptId,
        goodsReceiptPostingId: postingId,
        stockLocationId: po.destination_stock_location_id,
        postingTimestamp,
        actorId: actor,
        lines: inventoryLines,
        manageTransaction: false
      });

      for (const line of normalized) {
        repository.insertGoodsReceiptLine({
          id: line.receiptLineId,
          goodsReceiptId: receiptId,
          purchaseOrderLineId: line.poLine.id,
          acceptedPurchaseQuantity: line.acceptedPurchaseQuantity,
          rejectedPurchaseQuantity: line.rejectedPurchaseQuantity,
          acceptedBaseQuantity: line.acceptedBaseQuantity,
          purchaseUomId: line.poLine.purchase_uom_id,
          supplierPackId: line.poLine.supplier_pack_id,
          conversionFactorSnapshot: line.poLine.base_quantity_per_purchase_unit,
          resolvedUnitCost: line.resolvedUnitCost,
          acceptedTotalCost: line.acceptedTotalCost,
          agreedUnitPrice: line.poLine.unit_price,
          currencyCode: line.poLine.currency_code
        });

        const updatedReceived = Number(line.poLine.received_base_quantity || 0) + line.acceptedBaseQuantity;
        repository.updatePurchaseOrderLineReceived({
          id: line.poLine.id,
          receivedBaseQuantity: updatedReceived,
          updatedAt: postingTimestamp
        });
      }

      repository.updateGoodsReceiptPosted({ id: receiptId, postedAt: postingTimestamp, updatedAt: postingTimestamp });

      const refreshedLines = repository.findPurchaseOrderLines(po.id);
      const fullyReceived = refreshedLines.every(line =>
        Number(line.received_base_quantity || 0) >= Number(line.resolved_base_quantity) - 0.000001
      );
      repository.updatePurchaseOrderStatus({
        id: po.id,
        status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
        updatedAt: postingTimestamp
      });

      repository.commitTransaction();

      return {
        success: true,
        idempotent: false,
        goods_receipt_id: receiptId,
        goods_receipt_posting_id: postingId,
        purchase_order_id: po.id,
        status: 'POSTED',
        destination_stock_location_id: po.destination_stock_location_id,
        posted_at: postingTimestamp,
        inventory: inventoryResult
      };
    } catch (e) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw e;
    }
  }
}

module.exports = ProcurementService;
