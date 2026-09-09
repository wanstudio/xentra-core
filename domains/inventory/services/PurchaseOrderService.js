'use strict';
const crypto = require('crypto');
const db = require('../../../core/data/DataAccess');
const { events } = require('../../../core');
const InventoryStockService = require('./InventoryStockService');
const InventoryMovementModel = require('./InventoryMovementModel');

class PurchaseOrderService {
  /**
   * Stage 1: Creates a Purchase Order in 'pending' / 'ordered' state.
   * Locked Rule: PO creation DOES NOT mutate live inventory stock.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {string} params.supplier_name
   * @param {Array<{ product_id: string, quantity: number, unit_cost: number }>} params.items
   * @param {string} [params.created_by]
   * @param {string} [params.notes]
   * @returns {Object} Created Purchase Order
   */
  static createPurchaseOrder({
    brand_id,
    branch_id,
    supplier_name,
    items = [],
    created_by = null,
    notes = ''
  }) {
    if (!brand_id || !branch_id || !supplier_name || !Array.isArray(items) || items.length === 0) {
      throw new Error('[PurchaseOrderService] "brand_id", "branch_id", "supplier_name", and non-empty "items" are required.');
    }

    const poId = `po_${crypto.randomBytes(6).toString('hex')}`;
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date().toISOString();

    try {
      db.exec('BEGIN TRANSACTION;');

      db.prepare(`
        INSERT INTO inventory_purchase_orders (
          id, po_number, brand_id, branch_id, supplier_name, status, created_by, notes, ordered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `).run(poId, poNumber, brand_id, branch_id, supplier_name, created_by, notes, now, now, now);

      for (const item of items) {
        const itemId = `poi_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO inventory_po_items (
            id, po_id, product_id, quantity, unit_cost, received_quantity
          ) VALUES (?, ?, ?, ?, ?, 0)
        `).run(itemId, poId, item.product_id, Number(item.quantity), Number(item.unit_cost || 0));
      }

      db.exec('COMMIT;');
    } catch (e) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw e;
    }

    // Emit event: inventory.po.created
    events.EventBus.publish({
      type: 'inventory.po.created',
      producer: 'inventory',
      payload: {
        po_id: poId,
        po_number: poNumber,
        branch_id,
        supplier_name,
        items_count: items.length
      }
    }).catch(() => {});

    return {
      id: poId,
      po_number: poNumber,
      brand_id,
      branch_id,
      supplier_name,
      status: 'pending',
      items,
      created_at: now
    };
  }

  /**
   * Stage 2: Verifies Goods Receipt upon physical arrival.
   * Locked Rule: Stock mutation only occurs HERE via ACID transactions and immutable ledger entries.
   * 
   * @param {Object} params
   * @param {string} params.po_id
   * @param {string} [params.received_by]
   * @param {Array<{ product_id: string, received_quantity: number }>} [params.received_items] - Partial or full items
   * @returns {Object} Receipt result with updated stock levels
   */
  static verifyGoodsReceipt({
    po_id,
    received_by = null,
    received_items = null
  }) {
    const po = db.prepare('SELECT * FROM inventory_purchase_orders WHERE id = ?').get(po_id);
    if (!po) {
      throw new Error(`[PurchaseOrderService] Purchase Order "${po_id}" tidak ditemukan.`);
    }

    if (po.status !== 'pending') {
      throw new Error(`[PurchaseOrderService] Purchase Order "${po.po_number}" sudah berstatus "${po.status}".`);
    }

    const items = db.prepare('SELECT * FROM inventory_po_items WHERE po_id = ?').all(po_id);
    const now = new Date().toISOString();
    const updatedStocks = [];

    try {
      db.exec('BEGIN TRANSACTION;');

      for (const item of items) {
        let receiveQty = item.quantity;
        if (Array.isArray(received_items)) {
          const match = received_items.find(r => r.product_id === item.product_id);
          if (match && typeof match.received_quantity === 'number') {
            receiveQty = match.received_quantity;
          }
        }

        if (receiveQty > 0) {
          // Mutate stock & record ledger entry
          const branchProduct = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(po.branch_id, item.product_id);
          const prevStock = branchProduct ? Number(branchProduct.stock || 0) : 0;
          const nextStock = prevStock + receiveQty;

          // Update branch_products stock
          db.prepare(`
            UPDATE branch_products
            SET stock = ?, updated_at = ?
            WHERE branch_id = ? AND product_id = ?
          `).run(nextStock, now, po.branch_id, item.product_id);

          // Insert immutable inventory ledger entry
          const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;
          db.prepare(`
            INSERT INTO inventory_movements (
              id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'purchase_in', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            movementId,
            po.branch_id,
            item.product_id,
            receiveQty,
            prevStock,
            nextStock,
            po.po_number,
            received_by,
            `Penerimaan barang fisik dari PO ${po.po_number} (${po.supplier_name})`,
            now
          );

          // Update PO item received quantity
          db.prepare(`
            UPDATE inventory_po_items
            SET received_quantity = ?
            WHERE po_id = ? AND product_id = ?
          `).run(receiveQty, po_id, item.product_id);

          updatedStocks.push({
            product_id: item.product_id,
            received_quantity: receiveQty,
            previous_stock: prevStock,
            current_stock: nextStock
          });
        }
      }

      // Mark PO as received
      db.prepare(`
        UPDATE inventory_purchase_orders
        SET status = 'received', received_by = ?, received_at = ?, updated_at = ?
        WHERE id = ?
      `).run(received_by, now, now, po_id);

      db.exec('COMMIT;');
    } catch (e) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw e;
    }

    // Emit event: inventory.stock.received
    events.EventBus.publish({
      type: 'inventory.stock.received',
      producer: 'inventory',
      payload: {
        po_id: po.id,
        po_number: po.po_number,
        branch_id: po.branch_id,
        received_by,
        items: updatedStocks
      }
    }).catch(() => {});

    return {
      success: true,
      po_id: po.id,
      po_number: po.po_number,
      status: 'received',
      received_at: now,
      received_items: updatedStocks
    };
  }
}

module.exports = PurchaseOrderService;
