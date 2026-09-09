'use strict';

const crypto = require('crypto');
const db = require('../../../core/data/DataAccess');
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
    mutation_id = null,
    actor_id = null,
    actor_role = null,
    notes = ''
  }) {
    if (!branch_id || !product_id) {
      throw new Error('[InventoryStockService] "branch_id" and "product_id" are required.');
    }

    if (!InventoryMovementModel.isValidMovementType(movement_type)) {
      throw new Error(`[InventoryStockService] Tipe mutasi "${movement_type}" tidak valid.`);
    }

    const qty = Number(quantity);
    if (!Number.isFinite(Number(quantity)) || !Number.isInteger(qty) || qty === 0) {
      throw new Error('[InventoryStockService] "quantity" must be a finite, non-zero integer.');
    }

    if (mutation_id) {
      const existingReplay = db.prepare('SELECT * FROM inventory_movements WHERE mutation_id = ?').get(mutation_id);
      if (existingReplay) {
        return {
          success: true,
          idempotent: true,
          movement_id: existingReplay.id,
          branch_id,
          product_id,
          movement_type: existingReplay.movement_type,
          quantity: existingReplay.quantity,
          previous_stock: existingReplay.previous_stock,
          current_stock: existingReplay.current_stock
        };
      }
    }

    const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const finalNotes = actor_role ? `[${actor_role}] ${notes || ''}`.trim() : (notes || '');

    let previousStock = 0;
    let targetStock = 0;

    try {
      db.exec('BEGIN IMMEDIATE;');

      const branchProduct = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, product_id);
      if (!branchProduct) {
        throw new Error(`[InventoryStockService] Produk "${product_id}" tidak terdaftar di cabang "${branch_id}".`);
      }

      previousStock = branchProduct.stock == null ? 0 : Number(branchProduct.stock);

      const result = db.prepare(`
        UPDATE branch_products
        SET stock = COALESCE(stock, 0) + ?, updated_at = ?
        WHERE branch_id = ? AND product_id = ? AND (COALESCE(stock, 0) + ?) >= 0
      `).run(qty, now, branch_id, product_id, qty);

      if (!result || result.changes === 0) {
        throw new Error(`[InventoryStockService] Mutasi ditolak: Stok tidak boleh negatif (Stok saat ini: ${previousStock}, Pengurangan: ${Math.abs(qty)}).`);
      }

      targetStock = previousStock + qty;

      db.prepare(`
        INSERT INTO inventory_movements (
          id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, mutation_id, actor_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movementId,
        branch_id,
        product_id,
        movement_type,
        qty,
        previousStock,
        targetStock,
        reference_id,
        mutation_id,
        actor_id,
        finalNotes,
        now
      );

      db.exec('COMMIT;');
    } catch (e) {
      try { db.exec('ROLLBACK;'); } catch (_) {}

      if (mutation_id && /UNIQUE/i.test(String(e.message)) && String(e.message).includes('mutation_id')) {
        const existingRace = db.prepare('SELECT * FROM inventory_movements WHERE mutation_id = ?').get(mutation_id);
        if (existingRace) {
          return {
            success: true,
            idempotent: true,
            movement_id: existingRace.id,
            branch_id,
            product_id,
            movement_type: existingRace.movement_type,
            quantity: existingRace.quantity,
            previous_stock: existingRace.previous_stock,
            current_stock: existingRace.current_stock
          };
        }
      }
      throw e;
    }

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

  static getStock(branch_id, product_id) {
    const row = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, product_id);
    return row ? Number(row.stock || 0) : 0;
  }
}

module.exports = InventoryStockService;
