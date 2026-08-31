/**
 * Xentra POS Order Service
 * Handles Cashier Order Taking, Dine-in Table Holding (Open Bill), Split/Merge Bill,
 * and delegates stock deduction/snapshot execution cleanly to Commerce OrderPlacementService.
 */
const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const { OrderPlacementService } = require('../../commerce');

class PosOrderService {
  /**
   * Holds an open order / table bill for dine-in.
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} [params.table_number]
   * @param {string} [params.customer_name]
   * @param {Array<Object>} params.items
   * @returns {Object} Held order record
   */
  static holdOrder({ branch_id, table_number = '', customer_name = 'Tamu Meja', items = [] }) {
    if (!branch_id || !Array.isArray(items) || items.length === 0) {
      throw new Error('[PosOrderService] "branch_id" and non-empty "items" are required to hold an order.');
    }

    const heldId = `held_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(items);

    db.prepare(`
      INSERT INTO pos_held_orders (id, branch_id, table_number, customer_name, items_payload, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'held', ?, ?)
    `).run(heldId, branch_id, table_number, customer_name, payloadJson, now, now);

    return {
      id: heldId,
      branch_id,
      table_number,
      customer_name,
      items,
      status: 'held',
      created_at: now
    };
  }

  /**
   * Splits a held bill into two separate bills.
   * 
   * @param {Object} params
   * @param {string} params.held_order_id
   * @param {Array<Object>} params.split_items - Items to extract into a new bill
   * @returns {{ original_bill: Object, new_bill: Object }}
   */
  static splitBill({ held_order_id, split_items = [] }) {
    const original = db.prepare('SELECT * FROM pos_held_orders WHERE id = ?').get(held_order_id);
    if (!original || original.status !== 'held') {
      throw new Error('[PosOrderService] Held order tidak ditemukan atau sudah ditutup.');
    }

    const originalItems = JSON.parse(original.items_payload);
    // Filter remaining items for original bill
    const splitProductIds = new Set(split_items.map(it => it.product_id || it.id));
    const remainingItems = originalItems.filter(it => !splitProductIds.has(it.product_id || it.id));

    if (remainingItems.length === 0) {
      throw new Error('[PosOrderService] Split bill gagal: Tagihan asli tidak boleh kosong.');
    }

    const now = new Date().toISOString();
    // Update original bill
    db.prepare('UPDATE pos_held_orders SET items_payload = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(remainingItems), now, held_order_id);

    // Create new split bill
    const newHeld = PosOrderService.holdOrder({
      branch_id: original.branch_id,
      table_number: `${original.table_number || ''}-B`,
      customer_name: `${original.customer_name || 'Tamu'} (Split)`,
      items: split_items
    });

    return {
      original_bill: { ...original, items: remainingItems },
      new_bill: newHeld
    };
  }

  /**
   * Merges two held bills into one single bill.
   * 
   * @param {Object} params
   * @param {string} params.target_held_id - Bill to merge into
   * @param {string} params.source_held_id - Bill to be merged and cancelled
   * @returns {Object} Merged target bill
   */
  static mergeBill({ target_held_id, source_held_id }) {
    const target = db.prepare('SELECT * FROM pos_held_orders WHERE id = ?').get(target_held_id);
    const source = db.prepare('SELECT * FROM pos_held_orders WHERE id = ?').get(source_held_id);

    if (!target || target.status !== 'held' || !source || source.status !== 'held') {
      throw new Error('[PosOrderService] Salah satu held order tidak valid atau sudah selesai.');
    }

    const targetItems = JSON.parse(target.items_payload);
    const sourceItems = JSON.parse(source.items_payload);
    const mergedItems = [...targetItems, ...sourceItems];

    const now = new Date().toISOString();
    db.prepare('UPDATE pos_held_orders SET items_payload = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(mergedItems), now, target_held_id);

    // Cancel source bill
    db.prepare("UPDATE pos_held_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, source_held_id);

    return {
      id: target_held_id,
      branch_id: target.branch_id,
      table_number: target.table_number,
      customer_name: target.customer_name,
      items: mergedItems,
      status: 'held'
    };
  }

  /**
   * Settles a POS order (either direct quick-pay or from held bill).
   * Delegates stock deduction and order snapshot creation to Commerce OrderPlacementService.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {string} [params.shift_id]
   * @param {string} [params.held_order_id]
   * @param {string} [params.client_transaction_id] - Idempotency Key for offline sync
   * @param {string} [params.order_type='dinein'] - 'dinein' | 'pickup' | 'delivery'
   * @param {string} [params.payment_method='cash']
   * @param {number} [params.amount_tendered] - Cash handed by customer for change calculation
   * @param {Array<Object>} params.items
   * @returns {Promise<Object>} Settled order with change calculation
   */
  static async settleOrder({
    brand_id,
    branch_id,
    shift_id = null,
    held_order_id = null,
    client_transaction_id = null,
    order_type = 'dinein',
    payment_method = 'cash',
    amount_tendered = null,
    customer = {},
    items = []
  }) {
    // 1. If settling from held order, load items from DB if not passed
    let orderItems = items;
    if (held_order_id && (!orderItems || orderItems.length === 0)) {
      const held = db.prepare('SELECT * FROM pos_held_orders WHERE id = ?').get(held_order_id);
      if (!held || held.status !== 'held') {
        throw new Error('[PosOrderService] Held order tidak ditemukan atau sudah selesai.');
      }
      orderItems = JSON.parse(held.items_payload);
    }

    // 2. Delegate Cleanly to Commerce Order Placement Service (ACID + Concurrency Guard)
    const placementResult = await OrderPlacementService.submitOrder({
      brand_id,
      branch_id,
      customer: {
        name: customer.name || 'Pelanggan POS',
        phone: customer.phone || ''
      },
      items: orderItems,
      delivery_fee: 0,
      payment_method,
      notes: `POS Cashier Order [${order_type}]`,
      trace_context: {
        correlation_id: client_transaction_id || `pos_tx_${Date.now()}`
      }
    });

    if (!placementResult.success) {
      return placementResult;
    }

    const order = placementResult.order;
    const grandTotal = order.grand_total;

    // 3. Calculate Change (Kembalian) if cash payment
    let changeAmount = 0;
    if (payment_method === 'cash' && typeof amount_tendered === 'number') {
      if (amount_tendered < grandTotal) {
        throw new Error(`[PosOrderService] Uang yang diterima (Rp ${amount_tendered.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${grandTotal.toLocaleString('id-ID')}).`);
      }
      changeAmount = amount_tendered - grandTotal;
    }

    // 4. Update Shift Total Cash Sales if shift_id provided and payment is cash
    if (shift_id && payment_method === 'cash') {
      db.prepare(`
        UPDATE pos_shifts
        SET total_cash_sales = total_cash_sales + ?, expected_cash = expected_cash + ?
        WHERE id = ?
      `).run(grandTotal, grandTotal, shift_id);
    }

    // 5. If settled from held bill, mark held order as settled
    if (held_order_id) {
      db.prepare("UPDATE pos_held_orders SET status = 'settled', updated_at = datetime('now') WHERE id = ?")
        .run(held_order_id);
    }

    // 6. Emit event: pos.order.settled
    events.EventBus.publish({
      type: 'pos.order.settled',
      producer: 'pos',
      payload: {
        order_id: order.id,
        order_number: order.order_number,
        branch_id,
        shift_id,
        payment_method,
        grand_total: grandTotal,
        amount_tendered,
        change: changeAmount,
        client_transaction_id
      }
    }).catch(() => {});

    return {
      success: true,
      status: 'SETTLED',
      order: {
        ...order,
        amount_tendered,
        change: changeAmount,
        payment_method
      }
    };
  }
}

module.exports = PosOrderService;
