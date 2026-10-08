'use strict';

const DataAccess = require('../DataAccess');

class ProcurementRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
  }

  findSupplierByCode(organizationId, supplierCode) {
    return this.db.queryOne(
      'SELECT id, organization_id, supplier_code, name, status FROM suppliers WHERE organization_id = ? AND lower(trim(supplier_code)) = lower(trim(?))',
      [organizationId, supplierCode]
    );
  }

  findSupplierMaterialByIdentity(supplierId, materialId) {
    return this.db.queryOne(
      'SELECT id, supplier_id, material_id, supplier_item_code, is_active FROM supplier_materials WHERE supplier_id = ? AND material_id = ?',
      [supplierId, materialId]
    );
  }

  findSupplier(id) {
    return this.db.queryOne(
      'SELECT id, organization_id, supplier_code, name, status FROM suppliers WHERE id = ?',
      [id]
    );
  }

  findSupplierMaterial(id) {
    return this.db.queryOne(
      'SELECT sm.id, sm.supplier_id, sm.material_id, sm.supplier_item_code, sm.is_active, s.organization_id FROM supplier_materials sm JOIN suppliers s ON s.id = sm.supplier_id WHERE sm.id = ?',
      [id]
    );
  }

  findSupplierMaterialPack(id) {
    return this.db.queryOne(
      'SELECT id, supplier_material_id, name, purchase_uom_id, content_quantity_base, content_uom_id, minimum_order_quantity, unit_price, currency_code, is_active FROM supplier_material_packs WHERE id = ?',
      [id]
    );
  }

  findPurchaseOrder(id) {
    return this.db.queryOne(
      'SELECT id, organization_id, supplier_id, destination_stock_location_id, status, required_at, created_by, approved_by, approved_at, ordered_at, created_at, updated_at FROM purchase_orders WHERE id = ?',
      [id]
    );
  }

  findPurchaseOrderLines(poId) {
    return this.db.queryMany(
      'SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id',
      [poId]
    );
  }

  findPurchaseOrderLine(id) {
    return this.db.queryOne(
      'SELECT * FROM purchase_order_lines WHERE id = ?',
      [id]
    );
  }

  findGoodsReceipt(id) {
    return this.db.queryOne(
      'SELECT * FROM goods_receipts WHERE id = ?',
      [id]
    );
  }

  findGoodsReceiptLines(receiptId) {
    return this.db.queryMany(
      'SELECT * FROM goods_receipt_lines WHERE goods_receipt_id = ? ORDER BY id',
      [receiptId]
    );
  }

  findGoodsReceiptPosting(postingId) {
    return this.db.queryOne(
      'SELECT * FROM goods_receipts WHERE goods_receipt_posting_id = ?',
      [postingId]
    );
  }

  insertSupplier({ id, organizationId, supplierCode, name, status = 'DRAFT', createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO suppliers (id, organization_id, supplier_code, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, organizationId, supplierCode, name, status, createdAt, updatedAt]
    );
  }

  insertSupplierMaterial({ id, supplierId, materialId, supplierItemCode = null, isActive = 1, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO supplier_materials (id, supplier_id, material_id, supplier_item_code, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, supplierId, materialId, supplierItemCode, isActive, createdAt, updatedAt]
    );
  }

  insertSupplierMaterialPack({
    id,
    supplierMaterialId,
    name,
    purchaseUomId = null,
    contentQuantityBase,
    contentUomId,
    minimumOrderQuantity = 1,
    unitPrice,
    currencyCode,
    effectiveFrom = null,
    effectiveTo = null,
    isActive = 1,
    createdAt,
    updatedAt
  }) {
    return this.db.execute(
      'INSERT INTO supplier_material_packs (id, supplier_material_id, name, purchase_uom_id, content_quantity_base, content_uom_id, minimum_order_quantity, unit_price, currency_code, effective_from, effective_to, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, supplierMaterialId, name, purchaseUomId, contentQuantityBase, contentUomId, minimumOrderQuantity, unitPrice, currencyCode, effectiveFrom, effectiveTo, isActive, createdAt, updatedAt]
    );
  }

  insertPurchaseOrder({ id, organizationId, supplierId, destinationStockLocationId, status = 'DRAFT', requiredAt = null, createdBy = null, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO purchase_orders (id, organization_id, supplier_id, destination_stock_location_id, status, required_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, organizationId, supplierId, destinationStockLocationId, status, requiredAt, createdBy, createdAt, updatedAt]
    );
  }

  insertPurchaseOrderLine({
    id,
    purchaseOrderId,
    supplierMaterialId,
    orderedPurchaseQuantity,
    purchaseUomId = null,
    supplierPackId = null,
    resolvedBaseQuantity,
    unitPrice,
    currencyCode,
    baseQuantityPerPurchaseUnit,
    createdAt,
    updatedAt
  }) {
    return this.db.execute(
      'INSERT INTO purchase_order_lines (id, purchase_order_id, supplier_material_id, ordered_purchase_quantity, purchase_uom_id, supplier_pack_id, resolved_base_quantity, unit_price, currency_code, base_quantity_per_purchase_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, purchaseOrderId, supplierMaterialId, orderedPurchaseQuantity, purchaseUomId, supplierPackId, resolvedBaseQuantity, unitPrice, currencyCode, baseQuantityPerPurchaseUnit, createdAt, updatedAt]
    );
  }

  updatePurchaseOrderStatus({ id, status, updatedAt, orderedAt = undefined }) {
    if (orderedAt === undefined) {
      return this.db.execute(
        'UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?',
        [status, updatedAt, id]
      );
    }

    return this.db.execute(
      'UPDATE purchase_orders SET status = ?, ordered_at = ?, updated_at = ? WHERE id = ?',
      [status, orderedAt, updatedAt, id]
    );
  }

  insertGoodsReceipt({ id, purchaseOrderId, destinationStockLocationId, goodsReceiptPostingId, receivedBy = null, receivedAt, createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO goods_receipts (id, purchase_order_id, destination_stock_location_id, status, goods_receipt_posting_id, received_by, received_at, created_at, updated_at) VALUES (?, ?, ?, \'DRAFT\', ?, ?, ?, ?, ?)',
      [id, purchaseOrderId, destinationStockLocationId, goodsReceiptPostingId, receivedBy, receivedAt, createdAt, updatedAt]
    );
  }

  insertGoodsReceiptLine({
    id,
    goodsReceiptId,
    purchaseOrderLineId,
    acceptedPurchaseQuantity,
    rejectedPurchaseQuantity,
    acceptedBaseQuantity,
    purchaseUomId = null,
    supplierPackId = null,
    conversionFactorSnapshot,
    resolvedUnitCost,
    acceptedTotalCost,
    agreedUnitPrice,
    currencyCode
  }) {
    return this.db.execute(
      'INSERT INTO goods_receipt_lines (id, goods_receipt_id, purchase_order_line_id, accepted_purchase_quantity, rejected_purchase_quantity, accepted_base_quantity, purchase_uom_id, supplier_pack_id, conversion_factor_snapshot, resolved_unit_cost, accepted_total_cost, agreed_unit_price, currency_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, goodsReceiptId, purchaseOrderLineId, acceptedPurchaseQuantity, rejectedPurchaseQuantity, acceptedBaseQuantity, purchaseUomId, supplierPackId, conversionFactorSnapshot, resolvedUnitCost, acceptedTotalCost, agreedUnitPrice, currencyCode]
    );
  }

  updateGoodsReceiptPosted({ id, postedAt, updatedAt }) {
    return this.db.execute(
      "UPDATE goods_receipts SET status = 'POSTED', posted_at = ?, updated_at = ? WHERE id = ?",
      [postedAt, updatedAt, id]
    );
  }

  updatePurchaseOrderLineReceived({ id, receivedBaseQuantity, updatedAt }) {
    return this.db.execute(
      'UPDATE purchase_order_lines SET received_base_quantity = ?, updated_at = ? WHERE id = ?',
      [receivedBaseQuantity, updatedAt, id]
    );
  }
}

module.exports = ProcurementRepository;
