/**
 * Xentra POS Order Service
 * 
 * Handles Cashier Order Taking across all 4 official Xentra order types:
 * - 'dine_in'
 * - 'pickup'
 * - 'delivery'
 * - 'reservation'
 * 
 * Supports Table Holding (Open Bill), Split/Merge Bill, and Cross-Channel Table Integration:
 * - Customer App Cash Addition: Automatically appends to existing POS table held bill.
 * - Customer App Online Addition: Settled immediately without double-billing POS cashier.
 * - Clean Stock Delegation: Delegated to Commerce OrderPlacementService (ACID transaction).
 */
const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const { OrderPlacementService } = require('../../commerce');

class PosOrderService {
  static ORDER_TYPES = {
    DINE_IN: 'dine_in',
    PICKUP: 'pickup',
    DELIVERY: 'delivery',
    RESERVATION: 'reservation'
  };

  /**
   * Holds an open order / table bill for dine-in or table reservation.
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} [params.table_number]
   * @param {string} [params.customer_name]
   * @param {Array<Object>} params.items
   * @param {string} [params.order_type='dine_in'] - 'dine_in' | 'reservation'
   * @returns {Object} Held order record
   */
  static holdOrder({ branch_id, table_number = '', customer_name = 'Tamu Meja', items = [], order_type = 'dine_in' }) {
    if (!branch_id || !Array.isArray(items) || items.length === 0) {
      throw new Error('[PosOrderService] "branch_id" and non-empty "items" are required to hold an order.');
    }

    const heldId = `held_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(items);

    db.prepare(`
      INSERT INTO pos_held_orders (id, branch_id, table_number, customer_name, items_payload, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'held', ?, ?)
    `).run(heldId, branch_id, String(table_number), customer_name, payloadJson, now, now);

    return {
      id: heldId,
      branch_id,
      table_number: String(table_number),
      customer_name,
      order_type,
      items,
      status: 'held',
      created_at: now
    };
  }

  /**
   * Appends items to an existing open table bill (used for additional orders from Customer App or Kasir).
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} params.table_number
   * @param {Array<Object>} params.additional_items
   * @returns {Object} Updated held order bill
   */
  static appendItemsToTableBill({ branch_id, table_number, additional_items = [] }) {
    if (!branch_id || !table_number || !Array.isArray(additional_items) || additional_items.length === 0) {
      throw new Error('[PosOrderService] branch_id, table_number, and additional_items are required.');
    }

    // Find active held bill for this table
    const held = db.prepare(`
      SELECT * FROM pos_held_orders 
      WHERE branch_id = ? AND table_number = ? AND status = 'held'
      ORDER BY created_at DESC LIMIT 1
    `).get(branch_id, String(table_number));

    if (!held) {
      // If no bill exists yet, open new held bill
      return PosOrderService.holdOrder({
        branch_id,
        table_number,
        items: additional_items
      });
    }

    const currentItems = JSON.parse(held.items_payload);
    const updatedItems = [...currentItems, ...additional_items];
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE pos_held_orders
      SET items_payload = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(updatedItems), now, held.id);

    return {
      id: held.id,
      branch_id,
      table_number: String(table_number),
      customer_name: held.customer_name,
      items: updatedItems,
      status: 'held',
      updated_at: now
    };
  }

  /**
   * Checks in a guest reservation upon arrival and converts the exact same order in-place into active dine_in.
   * Locked Rule: Must mutate the same order record (order_type: reservation -> dine_in) without creating secondary orders.
   * 
   * @param {Object} params
   * @param {string} params.reservation_order_id - Order ID from original reservation booking
   * @param {string} params.table_number - Allocated dining table
   * @returns {Object} Active converted dine_in order
   */
  static checkInReservation({ reservation_order_id, table_number }) {
    if (!reservation_order_id || !table_number) {
      throw new Error('[PosOrderService] "reservation_order_id" and "table_number" are required for reservation check-in.');
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(reservation_order_id);
    if (!order) {
      throw new Error(`[PosOrderService] Data reservasi dengan ID ${reservation_order_id} tidak ditemukan.`);
    }

    if (order.order_type !== 'reservation') {
      throw new Error(`[PosOrderService] Order ${reservation_order_id} bukan tipe reservation.`);
    }

    const now = new Date().toISOString();

    // In-place conversion of the SAME order: reservation -> dine_in
    db.prepare(`
      UPDATE orders
      SET order_type = 'dine_in', status = 'active_table', table_number = ?, updated_at = ?
      WHERE id = ?
    `).run(String(table_number), now, reservation_order_id);

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(reservation_order_id);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(reservation_order_id);

    // Emit event: pos.reservation.checked_in
    events.EventBus.publish({
      type: 'pos.reservation.checked_in',
      producer: 'pos',
      payload: {
        order_id: reservation_order_id,
        order_number: updatedOrder.order_number,
        branch_id: updatedOrder.branch_id,
        table_number: String(table_number),
        customer_name: updatedOrder.customer_name,
        order_type: 'dine_in',
        status: 'active_table'
      }
    }).catch(() => {});

    return {
      success: true,
      status: 'CHECKED_IN',
      order: {
        ...updatedOrder,
        order_type: 'dine_in',
        table_number: String(table_number),
        status: 'active_table',
        items: orderItems
      }
    };
  }

  /**
   * Cancels an overdue reservation when guest does not arrive within the configured grace period (No-Show).
   * Locked Rule: Reservation is cancelled without automatic stock mutation.
   * 
   * @param {Object} params
   * @param {string} params.reservation_order_id
   * @param {string} [params.actor_id] - Manager or staff who executes the cancellation
   * @param {string} [params.reason='No-Show: Melewati batas toleransi kedatangan']
   * @returns {Object} Cancelled reservation order result
   */
  static cancelNoShowReservation({ reservation_order_id, actor_id = 'branch_manager', reason = 'No-Show: Melewati batas toleransi kedatangan' }) {
    if (!reservation_order_id) {
      throw new Error('[PosOrderService] "reservation_order_id" is required.');
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(reservation_order_id);
    if (!order) {
      throw new Error(`[PosOrderService] Data reservasi dengan ID ${reservation_order_id} tidak ditemukan.`);
    }

    if (order.order_type !== 'reservation') {
      throw new Error(`[PosOrderService] Order ${reservation_order_id} bukan tipe reservation.`);
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE orders
      SET status = 'cancelled', order_note = COALESCE(order_note || ' | ', '') || ?, updated_at = ?
      WHERE id = ?
    `).run(reason, now, reservation_order_id);

    // Emit event: pos.reservation.no_show_cancelled
    events.EventBus.publish({
      type: 'pos.reservation.no_show_cancelled',
      producer: 'pos',
      payload: {
        order_id: reservation_order_id,
        order_number: order.order_number,
        branch_id: order.branch_id,
        actor_id,
        reason
      }
    }).catch(() => {});

    return {
      success: true,
      status: 'CANCELLED_NO_SHOW',
      order_id: reservation_order_id,
      order_number: order.order_number,
      reason
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
    const splitProductIds = new Set(split_items.map(it => it.product_id || it.id));
    const remainingItems = originalItems.filter(it => !splitProductIds.has(it.product_id || it.id));

    if (remainingItems.length === 0) {
      throw new Error('[PosOrderService] Split bill gagal: Tagihan asli tidak boleh kosong.');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE pos_held_orders SET items_payload = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(remainingItems), now, held_order_id);

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
   * Settles a POS order (direct settlement, reservation, or from held bill).
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {string} [params.shift_id]
   * @param {string} [params.held_order_id]
   * @param {string} [params.client_transaction_id] - Idempotency Key for offline sync
   * @param {'dine_in'|'pickup'|'delivery'|'reservation'} [params.order_type='dine_in']
   * @param {string} [params.payment_method='cash']
   * @param {number} [params.amount_tendered]
   * @param {Array<Object>} params.items
   * @returns {Promise<Object>} Settled order with change calculation
   */
  static async settleOrder({
    brand_id,
    branch_id,
    shift_id = null,
    held_order_id = null,
    client_transaction_id = null,
    order_type = 'dine_in',
    payment_method = 'cash',
    amount_tendered = null,
    reservation_date = null,
    guest_count = null,
    customer = {},
    items = []
  }) {
    // 1. If settling from held order, load items and table from DB if not passed
    let orderItems = items;
    let tableNumber = customer.table_number || null;

    if (held_order_id && (!orderItems || orderItems.length === 0)) {
      const held = db.prepare('SELECT * FROM pos_held_orders WHERE id = ?').get(held_order_id);
      if (!held || held.status !== 'held') {
        throw new Error('[PosOrderService] Held order tidak ditemukan atau sudah selesai.');
      }
      orderItems = JSON.parse(held.items_payload);
      tableNumber = held.table_number || tableNumber;
    }

    // P1 FAIL-FAST VALIDATION (NEW-02): Pre-validate amount_tendered against authoritative pricing BEFORE submitting order
    // to prevent leaked inventory deduction / order creation on insufficient cash.
    if (payment_method === 'cash' && order_type !== 'reservation' && Array.isArray(orderItems) && orderItems.length > 0) {
      const { PrePaymentVerificationGate } = require('../../commerce');
      const preCheck = PrePaymentVerificationGate.verify({
        branch_id,
        brand_id,
        items: orderItems
      });

      if (!preCheck.is_valid) {
        return {
          success: false,
          status: preCheck.status,
          errors: preCheck.errors,
          price_diffs: preCheck.price_diffs
        };
      }

      const expectedGrandTotal = preCheck.verified_items.reduce((sum, it) => sum + (it.subtotal || ((it.unit_price || 0) * it.quantity)), 0);
      if (typeof amount_tendered === 'number' && amount_tendered < expectedGrandTotal) {
        throw new Error(`[PosOrderService] Uang yang diterima (Rp ${amount_tendered.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${expectedGrandTotal.toLocaleString('id-ID')}).`);
      }
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
      order_channel: 'pos_cashier',
      order_type,
      table_number: tableNumber,
      reservation_date,
      guest_count,
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

    // 3. Calculate Change (Kembalian) if cash payment and Record Cash Payment Lifecycle
    // (Bypass for reservation which is a zero-bill table booking)
    let changeAmount = 0;
    if (payment_method === 'cash' && order_type !== 'reservation') {
      if (typeof amount_tendered === 'number') {
        if (amount_tendered < grandTotal) {
          throw new Error(`[PosOrderService] Uang yang diterima (Rp ${amount_tendered.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${grandTotal.toLocaleString('id-ID')}).`);
        }
        changeAmount = amount_tendered - grandTotal;
      }

      // Authoritatively settle cash payment in order_payments and pos_shifts.
      // (No silent swallowing: any settlement failure will reject immediately and prevent false pos.order.settled event)
      const { CashSettlementService } = require('../../payment');
      CashSettlementService.settleCashPayment({
        order_id: order.id,
        amount: grandTotal,
        amount_tendered: amount_tendered || grandTotal,
        shift_id
      });
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
        order_type,
        table_number: tableNumber,
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
        order_type,
        table_number: tableNumber,
        amount_tendered,
        change: changeAmount,
        payment_method
      }
    };
  }
}

module.exports = PosOrderService;
