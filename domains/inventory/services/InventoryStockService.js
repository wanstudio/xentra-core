'use strict';

const crypto = require('crypto');
const { events } = require('../../../core');
const { InventoryRepository } = require('../../../core/data/repositories');
const InventoryMovementModel = require('../models/InventoryMovementModel');

const inventoryRepository = new InventoryRepository();

class InventoryStockService {
  /**
   * Records an immutable stock movement in the ledger and mutates branch product stock atomically.
   * Locked Rule: Stock must never become negative.
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
      const existingReplay = inventoryRepository.findMovementByMutationId(mutation_id);
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

    inventoryRepository.beginTransaction();
    try {
      const branchProduct = inventoryRepository.findBranchProduct(branch_id, product_id);
      if (!branchProduct) {
        throw new Error(`[InventoryStockService] Produk "${product_id}" tidak terdaftar di cabang "${branch_id}".`);
      }

      previousStock = branchProduct.stock == null ? 0 : Number(branchProduct.stock);
      const result = inventoryRepository.updateStock({ branchId: branch_id, productId: product_id, quantity: qty, updatedAt: now });
      if (!result || result.changes === 0) {
        throw new Error(`[InventoryStockService] Mutasi ditolak: Stok tidak boleh negatif (Stok saat ini: ${previousStock}, Pengurangan: ${Math.abs(qty)}).`);
      }

      targetStock = previousStock + qty;
      inventoryRepository.insertMovement({
        id: movementId,
        branchId: branch_id,
        productId: product_id,
        movementType: movement_type,
        quantity: qty,
        previousStock,
        currentStock: targetStock,
        referenceId: reference_id,
        mutationId: mutation_id,
        actorId: actor_id,
        notes: finalNotes,
        createdAt: now
      });

      inventoryRepository.commitTransaction();
    } catch (e) {
      try { inventoryRepository.rollbackTransaction(); } catch (_) {}
      if (mutation_id && /UNIQUE/i.test(String(e.message)) && String(e.message).includes('mutation_id')) {
        const existingRace = inventoryRepository.findMovementByMutationId(mutation_id);
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
    return inventoryRepository.getStock(branch_id, product_id);
  }
}

module.exports = InventoryStockService;
