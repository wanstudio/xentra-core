'use strict';

/**
 * Inventory persistence adapter.
 *
 * Exposes semantic branch-stock, inventory-movement, and purchase-order
 * persistence operations while keeping SQL/storage details behind the data boundary.
 */
const DataAccess = require('../DataAccess');

class InventoryRepository {
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

  _findProductStockIdentity(productId) {
    return this.db.queryOne(
      'SELECT id, brand_id, sku FROM products WHERE id = ?',
      [productId]
    );
  }

  _isCanonicalStockProduct(productId) {
    const product = this._findProductStockIdentity(productId);
    return Boolean(product && product.sku != null && String(product.sku).trim() !== '');
  }

  ensureBranchProductInventory({ branchId, productId, lowStockThreshold = 5 }) {
    const product = this._findProductStockIdentity(productId);
    if (!product) return { changes: 0 };

    const branch = this.db.queryOne(
      'SELECT id, brand_id FROM branches WHERE id = ?',
      [branchId]
    );
    if (!branch || branch.brand_id !== product.brand_id) {
      throw new Error('[InventoryRepository] Branch/Product brand mismatch.');
    }

    return this.db.execute(
      'INSERT OR IGNORE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 0, ?)',
      [branchId, productId, Number.isInteger(Number(lowStockThreshold)) && Number(lowStockThreshold) >= 0 ? Number(lowStockThreshold) : 5]
    );
  }

  findCanonicalBranchInventory(branchId, productId) {
    const product = this._findProductStockIdentity(productId);
    if (!product || product.sku == null || String(product.sku).trim() === '') return null;

    const row = this.db.queryOne(
      'SELECT branch_id, product_id, stock_qty, low_stock_threshold, created_at, updated_at FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?',
      [branchId, productId]
    );

    // Missing canonical inventory row is defined as zero stock, not unknown stock.
    return row || {
      branch_id: branchId,
      product_id: productId,
      stock_qty: 0,
      low_stock_threshold: 5,
      created_at: null,
      updated_at: null
    };
  }

  findBranchProduct(branchId, productId) {
    if (this._isCanonicalStockProduct(productId)) {
      const canonical = this.findCanonicalBranchInventory(branchId, productId);
      if (!canonical) return null;
      return {
        branch_id: canonical.branch_id,
        product_id: canonical.product_id,
        stock: Number(canonical.stock_qty || 0),
        low_stock_threshold: Number(canonical.low_stock_threshold || 0),
        canonical: true
      };
    }

    return this.db.queryOne(
      'SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?',
      [branchId, productId]
    );
  }

  updateBranchProductStock({ branchId, productId, stock, updatedAt }) {
    if (this._isCanonicalStockProduct(productId)) {
      this.ensureBranchProductInventory({ branchId, productId });
      return this.db.execute(`
        UPDATE branch_product_inventory
        SET stock_qty = ?, updated_at = ?
        WHERE branch_id = ? AND product_id = ?
      `, [Number(stock), updatedAt, branchId, productId]);
    }

    return this.db.execute(`
      UPDATE branch_products
      SET stock = ?, updated_at = ?
      WHERE branch_id = ? AND product_id = ?
    `, [String(stock), updatedAt, branchId, productId]);
  }

  deductBranchProduct({ branchId, productId, quantity }) {
    if (this._isCanonicalStockProduct(productId)) {
      this.ensureBranchProductInventory({ branchId, productId });
      return this.db.execute(`
        UPDATE branch_product_inventory
        SET stock_qty = stock_qty - ?, updated_at = datetime('now')
        WHERE branch_id = ? AND product_id = ? AND stock_qty >= ?
      `, [quantity, branchId, productId, quantity]);
    }

    return this.db.execute(`
      UPDATE branch_products
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ? AND stock >= ?
    `, [quantity, branchId, productId, quantity]);
  }

  findSaleDeductionByReference(referenceId) {
    return this.db.queryOne(`
      SELECT id
      FROM inventory_movements
      WHERE reference_id = ? AND movement_type = 'sale_deduction'
      LIMIT 1
    `, [referenceId]);
  }

  insertSaleDeduction({
    id, branchId, productId, quantity, previousStock, currentStock,
    referenceId, actorId, notes, createdAt
  }) {
    return this.db.execute(`
      INSERT INTO inventory_movements (
        id, branch_id, product_id, movement_type, quantity, previous_stock,
        current_stock, reference_id, actor_id, notes, created_at
      ) VALUES (?, ?, ?, 'sale_deduction', ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, branchId, productId, -Number(quantity), previousStock, currentStock,
      referenceId, actorId, notes, createdAt
    ]);
  }

  findMovementByMutationId(mutationId) {
    return this.db.queryOne(
      'SELECT * FROM inventory_movements WHERE mutation_id = ?',
      [mutationId]
    );
  }

  updateStock({ branchId, productId, quantity, updatedAt }) {
    if (this._isCanonicalStockProduct(productId)) {
      this.ensureBranchProductInventory({ branchId, productId });
      return this.db.execute(`
        UPDATE branch_product_inventory
        SET stock_qty = stock_qty + ?, updated_at = ?
        WHERE branch_id = ? AND product_id = ? AND (stock_qty + ?) >= 0
      `, [quantity, updatedAt, branchId, productId, quantity]);
    }

    return this.db.execute(`
      UPDATE branch_products
      SET stock = COALESCE(stock, 0) + ?, updated_at = ?
      WHERE branch_id = ? AND product_id = ? AND (COALESCE(stock, 0) + ?) >= 0
    `, [quantity, updatedAt, branchId, productId, quantity]);
  }

  insertMovement({
    id, branchId, productId, movementType, quantity, previousStock,
    currentStock, referenceId, mutationId, actorId, notes, createdAt
  }) {
    return this.db.execute(`
      INSERT INTO inventory_movements (
        id, branch_id, product_id, movement_type, quantity, previous_stock,
        current_stock, reference_id, mutation_id, actor_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, branchId, productId, movementType, quantity, previousStock, currentStock,
      referenceId, mutationId ?? null, actorId, notes, createdAt
    ]);
  }

  insertPurchaseOrder({
    id, poNumber, brandId, branchId, supplierName, createdBy, notes,
    orderedAt, createdAt, updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO inventory_purchase_orders (
        id, po_number, brand_id, branch_id, supplier_name, status, created_by,
        notes, ordered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `, [id, poNumber, brandId, branchId, supplierName, createdBy, notes, orderedAt, createdAt, updatedAt]);
  }

  insertPurchaseOrderItem({ id, poId, productId, quantity, unitCost }) {
    return this.db.execute(`
      INSERT INTO inventory_po_items (
        id, po_id, product_id, quantity, unit_cost, received_quantity
      ) VALUES (?, ?, ?, ?, ?, 0)
    `, [id, poId, productId, quantity, unitCost]);
  }

  findPurchaseOrderById(poId) {
    return this.db.queryOne(
      'SELECT * FROM inventory_purchase_orders WHERE id = ?',
      [poId]
    );
  }

  findPurchaseOrderItems(poId) {
    return this.db.queryMany(
      'SELECT * FROM inventory_po_items WHERE po_id = ?',
      [poId]
    );
  }

  updatePurchaseOrderItemReceivedQuantity({ poId, productId, receivedQuantity }) {
    return this.db.execute(`
      UPDATE inventory_po_items
      SET received_quantity = ?
      WHERE po_id = ? AND product_id = ?
    `, [receivedQuantity, poId, productId]);
  }

  markPurchaseOrderReceived({ poId, receivedBy, receivedAt, updatedAt }) {
    return this.db.execute(`
      UPDATE inventory_purchase_orders
      SET status = 'received', received_by = ?, received_at = ?, updated_at = ?
      WHERE id = ?
    `, [receivedBy, receivedAt, updatedAt, poId]);
  }

  getStock(branchId, productId) {
    const row = this.findBranchProduct(branchId, productId);
    return row ? Number(row.stock || 0) : 0;
  }

  getCanonicalStock(branchId, productId) {
    const row = this.findCanonicalBranchInventory(branchId, productId);
    return row ? Number(row.stock_qty || 0) : 0;
  }
}

module.exports = InventoryRepository;
