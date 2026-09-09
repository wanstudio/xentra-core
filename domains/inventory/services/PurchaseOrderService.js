'use strict';
const crypto = require('crypto');
const { events } = require('../../../core');
const { InventoryRepository } = require('../../../core/data/repositories');
const inventoryRepository = new InventoryRepository();

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
      inventoryRepository.beginTransaction();

      inventoryRepository.insertPurchaseOrder({
        id: poId,
        poNumber,
        brandId: brand_id,
        branchId: branch_id,
        supplierName: supplier_name,
        createdBy: created_by,
        notes,
        orderedAt: now,
        createdAt: now,
        updatedAt: now
      });

      for (const item of items) {
        const itemId = `poi_${crypto.randomBytes(6).toString('hex')}`;
        inventoryRepository.insertPurchaseOrderItem({
          id: itemId,
          poId,
          productId: item.product_id,
          quantity: Number(item.quantity),
          unitCost: Number(item.unit_cost || 0)
        });
      }

      inventoryRepository.commitTransaction();
    } catch (e) {
      try { inventoryRepository.rollbackTransaction(); } catch (_) {}
      throw e;
    }

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
    const po = inventoryRepository.findPurchaseOrderById(po_id);
    if (!po) {
      throw new Error(`[PurchaseOrderService] Purchase Order "${po_id}" tidak ditemukan.`);
    }

    if (po.status !== 'pending') {
      throw new Error(`[PurchaseOrderService] Purchase Order "${po.po_number}" sudah berstatus "${po.status}".`);
    }

    const items = inventoryRepository.findPurchaseOrderItems(po_id);
    const now = new Date().toISOString();
    const updatedStocks = [];

    try {
      inventoryRepository.beginTransaction();

      for (const item of items) {
        let receiveQty = item.quantity;
        if (Array.isArray(received_items)) {
          const match = received_items.find(r => r.product_id === item.product_id);
          if (match && typeof match.received_quantity === 'number') {
            receiveQty = match.received_quantity;
          }
        }

        if (receiveQty > 0) {
          const branchProduct = inventoryRepository.findBranchProduct(po.branch_id, item.product_id);
          const prevStock = branchProduct ? Number(branchProduct.stock || 0) : 0;
          const nextStock = prevStock + receiveQty;

          inventoryRepository.updateBranchProductStock({
            branchId: po.branch_id,
            productId: item.product_id,
            stock: nextStock,
            updatedAt: now
          });

          const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;
          inventoryRepository.insertMovement({
            id: movementId,
            branchId: po.branch_id,
            productId: item.product_id,
            movementType: 'purchase_in',
            quantity: receiveQty,
            previousStock: prevStock,
            currentStock: nextStock,
            referenceId: po.po_number,
            actorId: received_by,
            notes: `Penerimaan barang fisik dari PO ${po.po_number} (${po.supplier_name})`,
            createdAt: now
          });

          inventoryRepository.updatePurchaseOrderItemReceivedQuantity({
            poId: po_id,
            productId: item.product_id,
            receivedQuantity: receiveQty
          });

          updatedStocks.push({
            product_id: item.product_id,
            received_quantity: receiveQty,
            previous_stock: prevStock,
            current_stock: nextStock
          });
        }
      }

      inventoryRepository.markPurchaseOrderReceived({
        poId: po_id,
        receivedBy: received_by,
        receivedAt: now,
        updatedAt: now
      });

      inventoryRepository.commitTransaction();
    } catch (e) {
      try { inventoryRepository.rollbackTransaction(); } catch (_) {}
      throw e;
    }

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
