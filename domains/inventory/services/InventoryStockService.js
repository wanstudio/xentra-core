'use strict';

const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const InventoryMovementModel = require('../models/InventoryMovementModel');

class InventoryStockService {
  /**
   * Records an immutable stock movement in the ledger and mutates branch product stock atomically.
   * Locked Rule: Stock must never become negative.
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} params.product_id
   * @param {string} params.movement_type - One of InventoryMovementModel.MOVEMENT_TYPES
   * @param {number} params.quantity - Signed integer (e.g. +10 or -5)
   * @param {string} [params.reference_id]
   * @param {string} [params.actor_id]
   * @param {string} [params.notes]
   * @returns {Object} Result with previous_stock and current_stock
   */
  static recordMovement({
    branch_id,
    product_id,
    movement_type,
    quantity,
    reference_id = null,
    actor_id = null,
    notes = ''
  }) {
    if (!branch_id || !product_id) {
      throw new Error('[InventoryStockService] "branch_id" and "product_id" are required.');
    }

    if (!InventoryMovementModel.isValidMovementType(movement_type)) {
      throw new Error(`[InventoryStockService] Tipe mutasi "${movement_type}" tidak valid.`);
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty === 0) {
      throw new Error('[InventoryStockService] "quantity" must be a non-zero integer.');
    }

    const branchProduct = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, product_id);
    if (!branchProduct) {
      throw new Error(`[InventoryStockService] Produk "${product_id}" tidak terdaftar di cabang "${branch_id}".`);
    }

    const previousStock = Number(branchProduct.stock || 0);
    const targetStock = previousStock + qty;

    // Strict Non-Negative Stock Rule
    if (targetStock < 0) {
      throw new Error(`[InventoryStockService] Mutasi ditolak: Stok tidak boleh negatif (Stok saat ini: ${previousStock}, Pengurangan: ${Math.abs(qty)}).`);
    }

    const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    try {
      db.exec('BEGIN TRANSACTION;');

      // 1. Update physical stock
      db.prepare(`
        UPDATE branch_products
        SET stock = ?, updated_at = ?
        WHERE branch_id = ? AND product_id = ?
      `).run(targetStock, now, branch_id, product_id);

      // 2. Insert immutable ledger entry
      db.prepare(`
        INSERT INTO inventory_movements (
          id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, actor_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movementId,
        branch_id,
        product_id,
        movement_type,
        qty,
        previousStock,
        targetStock,
        reference_id,
        actor_id,
        notes,
        now
      );

      db.exec('COMMIT;');
    } catch (e) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw e;
    }

    // 3. Emit Domain Event
    events.EventBus.publish({
      type: 'inventory.movement.recorded',
      producer: 'inventory',
      payload: {
        movement_id: movementId,
        branch_id,
        product_id,
        movement_type,
        quantity: qty,
        previous_stock: previousStock,
        current_stock: targetStock,
        reference_id,
        actor_id
      }
    }).catch(() => {});

    return {
      success: true,
      movement_id: movementId,
      branch_id,
      product_id,
      movement_type,
      quantity: qty,
      previous_stock: previousStock,
      current_stock: targetStock
    };
  }

  /**
   * Retrieves current stock level for a branch product.
   * 
   * @param {string} branch_id
   * @param {string} product_id
   * @returns {number} Current stock count
   */
  static getStock(branch_id, product_id) {
    const row = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, product_id);
    return row ? Number(row.stock || 0) : 0;
  }
}

module.exports = InventoryStockService;
