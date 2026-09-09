'use strict';

/**
 * Inventory persistence adapter.
 *
 * Exposes semantic branch-stock and inventory-movement operations while
 * keeping SQL/storage details behind the data boundary.
 */
const DataAccess = require('../DataAccess');

class InventoryRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findBranchProduct(branchId, productId) {
    return this.db.queryOne(
      'SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?',
      [branchId, productId]
    );
  }

  deductBranchProduct({ branchId, productId, quantity }) {
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
}

module.exports = InventoryRepository;
