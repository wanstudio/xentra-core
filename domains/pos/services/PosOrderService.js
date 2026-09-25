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
const { events } = require('../../../core');
const { OrderRepository, PosOrderRepository, PosBillRepository } = require('../../../core/data/repositories');
const { OrderPlacementService } = require('../../commerce');
const { DiningTableService } = require('../../dining');

const orderRepository = new OrderRepository();
const posOrderRepository = new PosOrderRepository();
const posBillRepository = new PosBillRepository();
const { PaymentRepository } = require('../../../core/data/repositories');
const paymentRepository = new PaymentRepository();

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
  static holdOrder({ branch_id, table_number = '', customer_name = 'Tamu Meja', customer_phone = '', items = [], order_type = 'dine_in' }) {
    if (!branch_id || !Array.isArray(items) || items.length === 0) {
      throw new Error('[PosOrderService] "branch_id" and non-empty "items" are required to hold an order.');
    }

    const heldId = `held_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(items);
    let tableHoldCreated = false;

    // A cashier-created dine-in order claims the table immediately.
    // The order may still be pending operational/payment flow, but the table
    // must no longer appear AVAILABLE to another cashier.
    if (order_type === 'dine_in' && table_number) {
      try {
        const layout = DiningTableService.getBranchLayout(branch_id);
        const table = (layout.tables || []).find(t =>
          String(t.table_number) === String(table_number) ||
          String(t.label) === String(table_number)
        );
        if (!table) {
          throw new Error(`[PosOrderService] Meja "${table_number}" tidak ditemukan pada cabang ini.`);
        }
        DiningTableService.holdTablesForPayment({
          branch_id,
          table_id: table.id,
          customer_phone: customer_phone || '',
          hold_reference_id: heldId,
          channel: 'pos_cashier'
        });
        tableHoldCreated = true;
      } catch (err) {
        throw err;
      }
    }

    try {
      posOrderRepository.insertHeldOrder({
        id: heldId,
        branchId: branch_id,
        tableNumber: table_number,
        customerName: customer_name,
        orderType: order_type,
        itemsPayload: payloadJson,
        customerPhone: customer_phone || '',
        status: 'held',
        createdAt: now,
        updatedAt: now
      });
    } catch (err) {
      if (tableHoldCreated) {
        try {
          DiningTableService.releaseHold({
            branch_id,
            hold_reference_id: heldId,
            reason: 'cancelled'
          });
        } catch (_) {}
      }
      throw err;
    }

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
   * Materializes a cashier-held bill as a canonical Commerce Order so the
   * Merchant App can receive and accept it. The POS hold remains the cashier
   * working reference; the canonical Order becomes the operational reference.
   */
  static async materializeHeldOrder({ held_order_id, brand_id }) {
    const held = posOrderRepository.findHeldById(held_order_id);
    if (!held || held.status !== 'held') {
      throw new Error('[PosOrderService] Held order tidak ditemukan atau sudah tidak aktif.');
    }

    if (held.order_id) {
      const existing = orderRepository.findById(held.order_id);
      if (existing) return { ...held, order_id: existing.id, order: existing };
    }

    const items = JSON.parse(held.items_payload || '[]');
    if (!items.length) throw new Error('[PosOrderService] Held order tidak memiliki item.');

    const placement = await OrderPlacementService.submitOrder({
      brand_id,
      branch_id: held.branch_id,
      customer: {
        name: held.customer_name || 'Tamu',
        phone: held.customer_phone || ''
      },
      items,
      delivery_fee: 0,
      payment_method: 'cash',
      order_channel: 'pos_cashier',
      order_type: held.order_type || 'dine_in',
      table_number: held.table_number || null,
      hold_reference_id: held.id,
      notes: 'POS Cashier Order [held]'
    });

    if (!placement || !placement.success || !placement.order) {
      throw new Error((placement && placement.errors && placement.errors[0]) || (placement && placement.error) || 'Gagal membuat order operasional dari Hold Bill.');
    }

    const order = placement.order;
    if (held.order_type === 'dine_in') {
      DiningTableService.rebindHoldReference({
        branch_id: held.branch_id,
        from_reference_id: held.id,
        to_reference_id: order.id
      });
    }

    posOrderRepository.setHeldOrderOrderId({
      heldOrderId: held.id,
      orderId: order.id,
      updatedAt: new Date().toISOString()
    });

    return { ...held, order_id: order.id, order };
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
    const held = posOrderRepository.findActiveHeldByTable({
      branchId: branch_id,
      tableNumber: table_number
    });

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

    posOrderRepository.updateHeldItems({
      heldOrderId: held.id,
      itemsPayload: JSON.stringify(updatedItems),
      updatedAt: now
    });

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
    const result = DiningTableService.checkInReservation({ reservation_order_id, table_number });
    const updatedOrder = result.order;
    events.EventBus.publish({ type: 'pos.reservation.checked_in', producer: 'pos', payload: { order_id: reservation_order_id, order_number: updatedOrder.order_number, branch_id: updatedOrder.branch_id, table_number: String(table_number), customer_name: updatedOrder.customer_name, order_type: 'dine_in', status: 'active_table' } }).catch(() => {});
    return result;
  }

  static cancelNoShowReservation({ reservation_order_id, actor_id = 'branch_manager', reason = 'No-Show: Melewati batas toleransi kedatangan' }) {
    const result = DiningTableService.cancelNoShowReservation({ reservation_order_id, reason });
    events.EventBus.publish({ type: 'pos.reservation.no_show_cancelled', producer: 'pos', payload: { order_id: result.order_id, order_number: result.order_number, branch_id: result.branch_id, actor_id, reason } }).catch(() => {});
    return result;
  }

  static splitBill({ held_order_id, split_items = [] }) {
    const original = posOrderRepository.findHeldById(held_order_id);
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
    posOrderRepository.updateHeldItems({
      heldOrderId: held_order_id,
      itemsPayload: JSON.stringify(remainingItems),
      updatedAt: now
    });

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
    const target = posOrderRepository.findHeldById(target_held_id);
    const source = posOrderRepository.findHeldById(source_held_id);

    if (!target || target.status !== 'held' || !source || source.status !== 'held') {
      throw new Error('[PosOrderService] Salah satu held order tidak valid atau sudah selesai.');
    }

    const targetItems = JSON.parse(target.items_payload);
    const sourceItems = JSON.parse(source.items_payload);
    const mergedItems = [...targetItems, ...sourceItems];

    const now = new Date().toISOString();
    posOrderRepository.updateHeldItems({
      heldOrderId: target_held_id,
      itemsPayload: JSON.stringify(mergedItems),
      updatedAt: now
    });

    posOrderRepository.cancelHeldOrder({
      heldOrderId: source_held_id,
      updatedAt: now,
      status: 'cancelled'
    });

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
   * Returns the POS billing checks for ONE canonical Commerce Order.
   * Checks are a billing view only; the Order and Dining Session remain canonical.
   */
  static getOrderChecks({ order_id, branch_id }) {
    const order = posBillRepository.findOrder(order_id);
    if (!order || order.branch_id !== branch_id || order.order_channel !== 'pos_cashier') {
      throw new Error('[PosOrderService] Order POS tidak ditemukan dalam scope kasir.');
    }

    const items = orderRepository.findItems(order_id);
    if (!items.length) return { order, checks: [] };

    let checks = posBillRepository.findChecks(order_id);
    if (!checks.length) {
      const now = new Date().toISOString();
      const checkId = `check_${crypto.randomBytes(6).toString('hex')}`;
      posBillRepository.beginTransaction();
      try {
        posBillRepository.createCheck({ id: checkId, orderId: order_id, checkNumber: 1, now });
        items.forEach(item => {
          posBillRepository.upsertCheckItem({
            id: `checkitem_${crypto.randomBytes(6).toString('hex')}`,
            checkId,
            orderItemId: item.id,
            quantity: Number(item.quantity) || 0,
            now
          });
        });
        posBillRepository.commit();
      } catch (err) {
        try { posBillRepository.rollback(); } catch (_) {}
        throw err;
      }
      checks = posBillRepository.findChecks(order_id);
    } else {
      // New items added after a split are assigned to the first open check.
      const openPrimary = checks.find(c => Number(c.check_number) === 1 && c.status === 'open');
      if (openPrimary) {
        const now = new Date().toISOString();
        items.forEach(item => {
          const allocated = posBillRepository.findAllAllocatedQuantity(item.id);
          const remaining = (Number(item.quantity) || 0) - allocated;
          if (remaining > 0) {
            const existing = posBillRepository.findCheckItem(openPrimary.id, item.id);
            posBillRepository.upsertCheckItem({
              id: existing ? existing.id : `checkitem_${crypto.randomBytes(6).toString('hex')}`,
              checkId: openPrimary.id,
              orderItemId: item.id,
              quantity: (existing ? Number(existing.quantity) : 0) + remaining,
              now
            });
          }
        });
      }
    }

    checks = posBillRepository.findChecks(order_id);
    return {
      order,
      checks: checks.map(check => ({
        ...check,
        items: posBillRepository.findCheckItems(check.id).map(item => ({
          ...item,
          quantity: Number(item.quantity) || 0,
          line_total: (Number(item.unit_price) || 0) * (Number(item.quantity) || 0)
        }))
      }))
    };
  }

  /**
   * Splits item quantities into a new OPEN check without creating a second Order.
   * Only open checks may be split. Paid/closed checks are immutable.
   */
  static splitOrderCheck({ order_id, branch_id, source_check_id, split_items = [] }) {
    const view = PosOrderService.getOrderChecks({ order_id, branch_id });
    const source = view.checks.find(c => c.id === source_check_id);
    if (!source || source.status !== 'open') throw new Error('[PosOrderService] Check sumber tidak dapat di-split.');
    if (!Array.isArray(split_items) || split_items.length === 0) throw new Error('[PosOrderService] Pilih minimal satu item untuk split.');

    const moves = split_items.map(x => ({
      order_item_id: String(x.order_item_id || ''),
      quantity: Math.floor(Number(x.quantity) || 0)
    })).filter(x => x.order_item_id && x.quantity > 0);
    if (!moves.length) throw new Error('[PosOrderService] Kuantitas split tidak valid.');

    const sourceMap = new Map(source.items.map(item => [String(item.order_item_id), Number(item.quantity) || 0]));
    for (const move of moves) {
      const available = sourceMap.get(move.order_item_id) || 0;
      if (move.quantity > available) {
        throw new Error('[PosOrderService] Kuantitas split melebihi item pada check sumber.');
      }
    }

    const now = new Date().toISOString();
    const nextNumber = Math.max(0, ...view.checks.map(c => Number(c.check_number) || 0)) + 1;
    const newCheckId = `check_${crypto.randomBytes(6).toString('hex')`;

    posBillRepository.beginTransaction();
    try {
      posBillRepository.createCheck({ id: newCheckId, orderId: order_id, checkNumber: nextNumber, now });
      for (const move of moves) {
        const sourceItem = posBillRepository.findCheckItem(source_check_id, move.order_item_id);
        const remaining = (Number(sourceItem.quantity) || 0) - move.quantity;
        posBillRepository.updateCheckItemQuantity(source_check_id, move.order_item_id, remaining, now);
        posBillRepository.upsertCheckItem({
          id: `checkitem_${crypto.randomBytes(6).toString('hex')}`,
          checkId: newCheckId,
          orderItemId: move.order_item_id,
          quantity: move.quantity,
          now
        });
      }
      posBillRepository.commit();
    } catch (err) {
      try { posBillRepository.rollback(); } catch (_) {}
      throw err;
    }

    return PosOrderService.getOrderChecks({ order_id, branch_id });
  }

  /**
   * Combines two OPEN checks belonging to the same canonical Order.
   * No order, table, or dining session is created/deleted.
   */
  static mergeOrderChecks({ order_id, branch_id, target_check_id, source_check_id }) {
    if (String(target_check_id) === String(source_check_id)) {
      throw new Error('[PosOrderService] Check tujuan dan sumber harus berbeda.');
    }
    const view = PosOrderService.getOrderChecks({ order_id, branch_id });
    const target = view.checks.find(c => c.id === target_check_id);
    const source = view.checks.find(c => c.id === source_check_id);
    if (!target || !source || target.status !== 'open' || source.status !== 'open') {
      throw new Error('[PosOrderService] Hanya check OPEN yang dapat digabung.');
    }

    const now = new Date().toISOString();
    posBillRepository.beginTransaction();
    try {
      for (const item of source.items) {
        const existing = posBillRepository.findCheckItem(target.id, item.order_item_id);
        posBillRepository.upsertCheckItem({
          id: existing ? existing.id : `checkitem_${crypto.randomBytes(6).toString('hex')}`,
          checkId: target.id,
          orderItemId: item.order_item_id,
          quantity: (existing ? Number(existing.quantity) : 0) + (Number(item.quantity) || 0),
          now
        });
      }
      posBillRepository.deleteCheck(source.id);
      posBillRepository.commit();
    } catch (err) {
      try { posBillRepository.rollback(); } catch (_) {}
      throw err;
    }

    return PosOrderService.getOrderChecks({ order_id, branch_id });
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
    items = [],
    cashier_id = null
  }) {
    // 1. If settling from held order, load items and table from DB if not passed
    let orderItems = items;
    let tableNumber = customer.table_number || null;

    if (held_order_id && (!orderItems || orderItems.length === 0)) {
      const held = posOrderRepository.findHeldById(held_order_id);
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
        items: orderItems,
        customer,
        is_pwa_installed: false
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

    // The temporary cashier table hold must follow the real Order ID so the
    // normal acceptance/payment cancellation/release paths can resolve it.
    if (held_order_id && order_type === 'dine_in') {
      try {
        DiningTableService.rebindHoldReference({
          branch_id,
          from_reference_id: held_order_id,
          to_reference_id: order.id
        });
      } catch (err) {
        throw new Error('[PosOrderService] Gagal mengikat reservasi meja ke order: ' + err.message);
      }
    }

    const grandTotal = order.grand_total;
    let changeAmount = 0;
    let payment = null;

    if (payment_method === 'cash' && order_type !== 'reservation') {
      if (typeof amount_tendered === 'number') {
        if (amount_tendered < grandTotal) throw new Error('[PosOrderService] Uang diterima kurang dari total tagihan.');
        changeAmount = amount_tendered - grandTotal;
      }
      const { CashSettlementService } = require('../../payment');
      CashSettlementService.settleCashPayment({ order_id: order.id, amount: grandTotal, amount_tendered: amount_tendered || grandTotal, cashier_id, shift_id });
      payment = { method: 'cash', provider: 'cash', status: 'settlement' };
    } else if (payment_method === 'qris_static') {
      const { PaymentGatewayService } = require('../../payment');
      const qris = PaymentGatewayService.resolveStaticQrisConfig(branch_id, brand_id);
      if (!qris.enabled) {
        paymentRepository.updatePaymentStatus({ orderId: order.id, paymentStatus: 'cancel', updatedAt: new Date().toISOString() });
        orderRepository.updateStatusIfCurrent({ orderId: order.id, targetStatus: 'cancelled', currentStatus: 'pending' });
        throw new Error('[QRIS_STATIC_NOT_CONFIGURED]: QRIS statis belum dikonfigurasi untuk cabang ini.');
      }
      const existingPayment = paymentRepository.findPaymentByOrderId(order.id);
      if (existingPayment && existingPayment.provider === 'qris_static' && existingPayment.payment_status === 'settlement') {
        payment = { method: 'qris_static', provider: 'qris_static', status: 'settlement' };
      } else {
        payment = { method: 'qris_static', provider: 'qris_static', status: 'pending', qris_static: qris };
      }
    } else if (payment_method === 'midtrans' || payment_method === 'doku') {
      const { PaymentGatewayService } = require('../../payment');
      try {
        const existingPayment = paymentRepository.findPaymentByOrderId(order.id);
        if (existingPayment && existingPayment.payment_status === 'settlement') {
          payment = { method: payment_method, provider: existingPayment.provider, status: 'settlement' };
        } else if (existingPayment && existingPayment.payment_status === 'pending' && existingPayment.snap_token) {
          payment = { method: payment_method, provider: existingPayment.provider, status: 'pending', snap_token: existingPayment.snap_token, merchant_id: existingPayment.merchant_id, redirect_url: null };
        } else {
          const gatewayResult = await PaymentGatewayService.createSnapTransaction({
            id: order.id, grand_total: grandTotal, branch_id, brand_id, delivery_fee: 0,
            customer_name: customer.name || 'Pelanggan POS', customer_phone: customer.phone || '', payment_method, order_type
          }, order.items || orderItems, customer);
          paymentRepository.updatePaymentGatewayToken({
            orderId: order.id, snapToken: gatewayResult && gatewayResult.snap_token,
            merchantId: gatewayResult && gatewayResult.merchant_id,
            transactionId: gatewayResult && (gatewayResult.transaction_id || gatewayResult.order_id),
            updatedAt: new Date().toISOString()
          });
          payment = { method: payment_method, provider: payment_method, status: 'pending', snap_token: (gatewayResult && gatewayResult.snap_token) || null, redirect_url: (gatewayResult && gatewayResult.redirect_url) || null, merchant_id: (gatewayResult && gatewayResult.merchant_id) || null, doku_session_id: (gatewayResult && gatewayResult.doku_session_id) || null, expired_date: (gatewayResult && gatewayResult.expired_date) || null };
        }
      } catch (err) {
        const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED|ECONNRESET/i.test(err.code || err.message);
        const now = new Date().toISOString();
        paymentRepository.updatePaymentStatus({ orderId: order.id, paymentStatus: isTimeout ? 'reconciliation_pending' : 'cancel', updatedAt: now });
        if (!isTimeout) orderRepository.updateStatusIfCurrent({ orderId: order.id, targetStatus: 'cancelled', currentStatus: 'pending' });
        if (isTimeout) return { success: false, status: 'PAYMENT_GATEWAY_TIMEOUT', error: 'Koneksi ke gateway pembayaran mengalami timeout. Status transaksi perlu direkonsiliasi sebelum pembayaran diulang.', order_id: order.id, order_number: order.order_number, payment: { method: payment_method, provider: payment_method, status: 'reconciliation_pending' } };
        return { success: false, status: 'PAYMENT_GATEWAY_ERROR', error: err.message || 'Gagal membuat transaksi pembayaran gateway.', order_id: order.id, order_number: order.order_number, payment: { method: payment_method, provider: payment_method, status: 'cancel' } };
      }
    } else {
      throw new Error('[PosOrderService] Payment method tidak didukung: ' + payment_method);
    }

    if (held_order_id) posOrderRepository.cancelHeldOrder({ heldOrderId: held_order_id, updatedAt: new Date().toISOString(), status: 'settled' });

    if (payment && payment.status === 'settlement') {
      events.EventBus.publish({
        type: 'pos.order.settled', producer: 'pos',
        payload: { order_id: order.id, order_number: order.order_number, branch_id, shift_id, order_type, table_number: tableNumber, payment_method, grand_total: grandTotal, amount_tendered, change: changeAmount, client_transaction_id }
      }).catch(() => {});
    }

    return {
      success: true,
      status: payment && payment.status === 'settlement' ? 'SETTLED' : 'PAYMENT_PENDING',
      order: { ...order, order_type, table_number: tableNumber, amount_tendered, change: changeAmount, payment_method, status: payment && payment.status === 'settlement' ? 'confirmed' : 'pending' },
      payment
    };
  }
}

module.exports = PosOrderService;
