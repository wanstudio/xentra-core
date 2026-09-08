/**
 * Xentra Commerce Order Placement Service
 * Handles customer order submission with ACID database transactions, optimistic concurrency guards,
 * dynamic branch low-stock thresholds, and distributed event dispatching.
 */
const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const PrePaymentVerificationGate = require('./PrePaymentVerificationGate');
const LowStockThresholdModel = require('../models/LowStockThresholdModel');

class OrderPlacementService {
  /**
   * Submits a customer order with strict pre-payment verification, ACID transaction, and concurrency guard.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {Object} params.customer - { name, phone, address, coordinates }
   * @param {Array<Object>} params.items - Cart items { product_id, quantity, expected_price }
   * @param {number} [params.delivery_fee=0]
   * @param {'cash'|'midtrans'} [params.payment_method='midtrans']
   * @param {string} [params.notes='']
   * @param {Object} [params.trace_context] - { correlation_id, causation_id }
   * @returns {Promise<Object>} Created order snapshot & payment readiness
   */
  static async submitOrder({
    brand_id,
    branch_id,
    customer,
    items = [],
    delivery_fee = 0,
    discount_amount = 0,
    delivery_record = null,
    fulfillment_schedule_type = 'asap',
    scheduled_slot_start = null,
    scheduled_slot_end = null,
    payment_method = 'midtrans',
    order_channel = 'customer_app',
    order_type = 'delivery',
    // R2: how the fulfillment branch was chosen. AUTO = Core matched via
    // BranchMatcher from the destination; CUSTOMER_SELECTED = the customer
    // explicitly chose the branch. Distinct from fulfillment branch_id.
    selection_mode = null,
    table_number = null,
    reservation_date = null,
    guest_count = null,
    client_transaction_id = null,
    shift_id = null,
    pwa_runtime = null,
    dining_session_id = null,
    table_ids = null,
    hold_reference_id = null,
    notes = '',
    trace_context = {}
  }) {
    // Strict Payment Method Scope Alignment (Xentra Payment = Cash or Midtrans)
    const effectivePaymentMethod = (payment_method === 'cash') ? 'cash' : 'midtrans';
    const effectiveOrderType = order_type || 'delivery';

    // R5/CHECK-2 OPERATIONAL BOUNDARY: an order is 'confirmed' (ACCEPTED) at
    // creation ONLY when a Branch actor created it (POS cashier channel —
    // the branch is present and commits to the order at the counter).
    // Customer-app cash/midtrans orders start 'pending' and ONLY Branch
    // ACCEPT moves them to 'confirmed'. Payment settlement never confirms
    // an order (payment state remains separate from order acceptance state).
    const insertedStatus = (effectivePaymentMethod === 'cash' && order_channel === 'pos_cashier')
      ? 'confirmed'
      : 'pending';

    // Strict Validation: Same-Day Reservation Restriction & Mandatory Guest Count (NEW-02)
    if (effectiveOrderType === 'reservation') {
      if (!reservation_date) {
        return {
          success: false,
          status: 'VALIDATION_ERROR',
          errors: ['Tanggal reservasi wajib diisi untuk tipe pesanan reservation.']
        };
      }

      const parsedGuestCount = Number(guest_count);
      if (!guest_count || !Number.isInteger(parsedGuestCount) || parsedGuestCount <= 0) {
        return {
          success: false,
          status: 'VALIDATION_ERROR',
          errors: ['Perkiraan jumlah orang (guest_count) wajib diisi dengan bilangan bulat positif (> 0) untuk reservasi.']
        };
      }

      const resDate = new Date(reservation_date);
      const today = new Date();
      const resDateStr = resDate.toISOString().slice(0, 10);
      const todayStr = today.toISOString().slice(0, 10);

      if (resDateStr <= todayStr) {
        return {
          success: false,
          status: 'SAME_DAY_RESERVATION_REJECTED',
          errors: ['Reservasi hari yang sama tidak diperbolehkan. Minimum reservasi adalah untuk besok atau tanggal setelahnya.']
        };
      }

      if (!branch_id) {
        return {
          success: false,
          status: 'VALIDATION_ERROR',
          errors: ['Cabang tujuan (branch_id) wajib dipilih untuk melakukan reservasi meja.']
        };
      }

      const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();
      const orderNumber = `RES-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      try {
        db.exec('BEGIN IMMEDIATE;');

        if (customer.phone) {
          const existingRes = db.prepare(`
            SELECT id FROM orders 
            WHERE order_type = 'reservation' 
              AND status NOT IN ('cancelled', 'completed') 
              AND branch_id = ? 
              AND customer_phone = ? 
              AND (scheduled_slot_start = ? OR order_note LIKE ?)
          `).get(branch_id, customer.phone, resDateStr, `%Tgl: ${resDateStr}%`);

          if (existingRes) {
            db.exec('ROLLBACK;');
            return {
              success: false,
              status: 'DUPLICATE_RESERVATION',
              errors: [`Anda sudah memiliki booking reservasi aktif di cabang ini untuk tanggal ${resDateStr}.`]
            };
          }
        }

        const dailyBookingsCount = db.prepare(`
          SELECT COUNT(*) as count FROM orders 
          WHERE order_type = 'reservation' 
            AND status NOT IN ('cancelled', 'completed') 
            AND branch_id = ? 
            AND (scheduled_slot_start = ? OR order_note LIKE ?)
        `).get(branch_id, resDateStr, `%Tgl: ${resDateStr}%`);

        if (dailyBookingsCount && dailyBookingsCount.count >= 30) {
          db.exec('ROLLBACK;');
          return {
            success: false,
            status: 'BRANCH_CAPACITY_FULL',
            errors: [`Kapasitas reservasi meja untuk cabang ini pada tanggal ${resDateStr} sudah penuh.`]
          };
        }

        db.prepare(`
          INSERT INTO orders (
            id, order_number, brand_id, branch_id, customer_name, customer_phone,
            order_type, order_channel, selection_mode, table_number, scheduled_slot_start,
            subtotal, delivery_fee, grand_total, payment_method, status, order_note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'reservation', ?, ?, NULL, ?, 0, 0, 0, 'cash', 'confirmed', ?, ?, ?)
        `).run(
          orderId,
          orderNumber,
          brand_id,
          branch_id,
          customer.name || 'Tamu Reservasi',
          customer.phone || '',
          order_channel,
          selection_mode || 'CUSTOMER_SELECTED',
          resDateStr,
          notes ? `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr}) | ${notes}` : `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr})`,
          now,
          now
        );

        db.exec('COMMIT;');
      } catch (txErr) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        console.error('[OrderPlacementService] Reservation insert error:', txErr.message);
        return {
          success: false,
          status: 'ORDER_CREATION_FAILED',
          errors: [txErr.message]
        };
      }

      await events.EventBus.publish({
        type: 'commerce.reservation.booked',
        producer: 'commerce',
        payload: {
          order_id: orderId,
          order_number: orderNumber,
          brand_id,
          branch_id,
          reservation_date: resDateStr,
          guest_count: guest_count || 1,
          customer
        },
        context: {
          correlation_id: trace_context.correlation_id,
          causation_id: orderId
        }
      });

      return {
        success: true,
        status: 'VERIFIED',
        order: {
          id: orderId,
          order_number: orderNumber,
          brand_id,
          branch_id,
          order_type: 'reservation',
          order_channel,
          table_number,
          reservation_date: resDateStr,
          guest_count: guest_count || 1,
          subtotal: 0,
          delivery_fee: 0,
          grand_total: 0,
          status: 'confirmed',
          items: [],
          created_at: now
        }
      };
    }

    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id,
      items,
      customer,
      pwa_runtime
    });

    if (!verification.is_valid) {
      return {
        success: false,
        status: verification.status,
        errors: verification.errors,
        price_diffs: verification.price_diffs
      };
    }

    const verifiedItems = verification.verified_items;
    const subtotal = verifiedItems.reduce((acc, it) => acc + it.subtotal, 0);
    const grandTotal = Math.max(0, subtotal + Number(delivery_fee || 0) - Number(discount_amount || 0));

    const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `XN-${today}-${randSuffix}`;

    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        id, order_number, client_transaction_id, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, selection_mode, table_number, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end,
        subtotal, discount_amount, delivery_fee, grand_total, payment_method, status, order_note, dining_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertOrderItemStmt = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const guardedDeductStockStmt = db.prepare(`
      UPDATE branch_products
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ? AND stock >= ?
    `);

    try {
      db.exec('BEGIN IMMEDIATE;');

      insertOrderStmt.run(
        orderId,
        orderNumber,
        client_transaction_id || null,
        brand_id,
        branch_id,
        customer.name || 'Pelanggan',
        customer.phone || '',
        effectiveOrderType,
        order_channel,
        selection_mode || 'CUSTOMER_SELECTED',
        table_number,
        fulfillment_schedule_type,
        scheduled_slot_start,
        scheduled_slot_end,
        subtotal,
        Number(discount_amount || 0),
        Number(delivery_fee || 0),
        grandTotal,
        effectivePaymentMethod,
        insertedStatus,
        notes,
        dining_session_id || null,
        now,
        now
      );

      for (const item of verifiedItems) {
        const itemId = `item_${crypto.randomBytes(6).toString('hex')}`;
        const formattedItemNote = item.promo_id 
          ? `[PROMO:${item.promo_id}] ${item.notes || item.note || ''}`.trim()
          : (item.notes || item.note || '');

        item.note = formattedItemNote;

        insertOrderItemStmt.run(
          itemId,
          orderId,
          item.product_id,
          item.name,
          item.unit_price,
          item.quantity,
          item.subtotal,
          formattedItemNote
        );

        if (effectivePaymentMethod === 'cash') {
          const bpBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, item.product_id);
          const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

          const deductResult = guardedDeductStockStmt.run(item.quantity, branch_id, item.product_id, item.quantity);
          if (!deductResult || deductResult.changes === 0) {
            throw new Error(`[CONCURRENCY_RACE] Stok untuk produk "${item.name}" baru saja habis atau tidak mencukupi.`);
          }

          const currentStock = prevStock - Number(item.quantity);
          const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;

          db.prepare(`
            INSERT INTO inventory_movements (
              id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'sale_deduction', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            movementId,
            branch_id,
            item.product_id,
            -Number(item.quantity),
            prevStock,
            currentStock,
            orderNumber,
            customer.phone || 'customer_order',
            `Pemotongan stok otomatis pesanan ${orderNumber} (${effectiveOrderType}/${order_channel})`,
            now
          );
        }
      }

      if (delivery_record) {
        db.prepare(`
          INSERT INTO order_deliveries (
            id, order_id, destination_address, destination_latitude, destination_longitude,
            actual_road_distance_meters, actual_duration_seconds, chargeable_distance_km,
            free_km_applied, rate_per_km_applied, delivery_fee_calculated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          delivery_record.id || ('del_' + crypto.randomBytes(6).toString('hex')),
          orderId,
          delivery_record.destination_address || 'Alamat Customer',
          delivery_record.destination_latitude || 0,
          delivery_record.destination_longitude || 0,
          delivery_record.actual_road_distance_meters || 0,
          delivery_record.actual_duration_seconds || 0,
          delivery_record.chargeable_distance_km || 0,
          delivery_record.free_km_applied || 0,
          delivery_record.rate_per_km_applied || 0,
          delivery_record.delivery_fee_calculated || 0
        );
      }

      const initialPaymentId = `pay_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO order_payments (
          id, order_id, provider, payment_method, merchant_id, snap_token, payment_status, amount, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
          amount = excluded.amount,
          payment_method = excluded.payment_method,
          provider = excluded.provider,
          updated_at = excluded.updated_at
      `).run(
        initialPaymentId,
        orderId,
        effectivePaymentMethod,
        effectivePaymentMethod,
        effectivePaymentMethod === 'cash' ? 'cash' : 'midtrans',
        grandTotal,
        now,
        now
      );

      if (effectivePaymentMethod === 'cash' && verification.applied_promos && verification.applied_promos.length > 0) {
        const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
        PromotionEngineService.recordRedemptions({
          order_id: orderId,
          brand_id,
          branch_id,
          customer_phone: customer.phone,
          promotions: verification.applied_promos
        });
      }

      // P1 POS OFFLINE RECONCILIATION & CASH SALES ATOMICITY:
      // Update POS shift cash sales in the same atomic database transaction as order placement.
      // If shift is closed, missing, not owned by this branch, or fails update, entire
      // placement rolls back with zero orphan order.
      if (shift_id && effectivePaymentMethod === 'cash') {
        const shiftUpdateRes = db.prepare(`
          UPDATE pos_shifts
          SET total_cash_sales = total_cash_sales + ?, expected_cash = expected_cash + ?
          WHERE id = ? AND branch_id = ? AND status = 'open'
        `).run(grandTotal, grandTotal, shift_id, branch_id);

        if (shiftUpdateRes.changes !== 1) {
          throw new Error(`[SHIFT_UPDATE_FAILED]: POS shift "${shift_id}" tidak ditemukan, bukan milik cabang "${branch_id}", atau sudah ditutup.`);
        }
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}

      if (txErr.message && (txErr.message.includes('idx_orders_branch_client_tx') || txErr.message.includes('UNIQUE constraint failed: orders.branch_id, orders.client_transaction_id'))) {
        throw txErr;
      }

      return {
        success: false,
        status: 'OUT_OF_STOCK',
        errors: [txErr.message || 'Terjadi kegagalan pemesanan karena perubahan ketersediaan stok.'],
        price_diffs: []
      };
    }

    if (effectivePaymentMethod === 'cash') {
      for (const item of verifiedItems) {
        const remainingStock = item.current_stock - item.quantity;
        const branchThreshold = item.branch_low_stock_threshold != null 
          ? item.branch_low_stock_threshold 
          : LowStockThresholdModel.DEFAULT_THRESHOLD;
        const stockEval = LowStockThresholdModel.evaluate(remainingStock, branchThreshold);

        if (stockEval.is_low || stockEval.is_out_of_stock) {
          events.EventBus.publish({
            type: 'inventory.low_stock_warning',
            producer: 'commerce',
            payload: {
              branch_id,
              product_id: item.product_id,
              product_name: item.name,
              remaining_stock: remainingStock,
              threshold: stockEval.threshold,
              is_out_of_stock: stockEval.is_out_of_stock
            },
            context: {
              correlation_id: trace_context.correlation_id,
              causation_id: orderId
            }
          }).catch(() => {});
        }
      }
    }

    await events.EventBus.publish({
      type: 'commerce.order.placed',
      producer: 'commerce',
      payload: {
        order_id: orderId,
        order_number: orderNumber,
        brand_id,
        branch_id,
        subtotal,
        delivery_fee,
        grand_total: grandTotal,
        items: verifiedItems,
        customer
      },
      context: {
        correlation_id: trace_context.correlation_id,
        causation_id: orderId
      }
    });

    const initialStatus = insertedStatus;

    return {
      success: true,
      status: 'VERIFIED',
      order: {
        id: orderId,
        order_number: orderNumber,
        brand_id,
        branch_id,
        order_type: effectiveOrderType,
        order_channel,
        table_number,
        reservation_date,
        guest_count,
        subtotal,
        delivery_fee,
        grand_total: grandTotal,
        status: initialStatus,
        items: verifiedItems,
        created_at: now
      }
    };
  }

  /**
   * Authoritative Single Source of Truth: Executes atomic stock deduction and ledger entry when an order is settled.
   * 
   * @param {string} orderId
   * @param {Object} [options]
   * @param {boolean} [options.dbTransactionProvided=false] - If caller already manages the DB transaction
   * @returns {{ success: boolean, idempotent?: boolean, deducted_items: Array<Object> }}
   */
  static deductStockForSettledOrder(orderId, { dbTransactionProvided = false } = {}) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw new Error(`[OrderPlacementService] Order "${orderId}" tidak ditemukan.`);
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    if (!items || items.length === 0) {
      return { success: true, deducted_items: [] };
    }

    const existingMovement = db.prepare('SELECT id FROM inventory_movements WHERE reference_id = ? AND movement_type = \'sale_deduction\' LIMIT 1').get(order.order_number);
    if (existingMovement) {
      return { success: true, idempotent: true, deducted_items: [] };
    }

    const guardedDeductStockStmt = db.prepare(`
      UPDATE branch_products
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ? AND stock >= ?
    `);

    const now = new Date().toISOString();
    const deductedItems = [];

    if (!dbTransactionProvided) {
      db.exec('BEGIN TRANSACTION;');
    }

    try {
      for (const item of items) {
        const isVirtualPromo = (item.unit_price === 0 || Number(item.unit_price) === 0) &&
                               (item.note?.includes('Promo') || item.note?.includes('Bonus') || String(item.product_id).startsWith('prm_') || String(item.product_id).startsWith('reward_'));

        const bpBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(order.branch_id, item.product_id);
        if (!bpBefore && isVirtualPromo) {
          continue;
        }

        const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

        const deductResult = guardedDeductStockStmt.run(item.quantity, order.branch_id, item.product_id, item.quantity);
        if (!deductResult || deductResult.changes === 0) {
          throw new Error(`[OUT_OF_STOCK_RACE] Stok untuk produk "${item.product_name || item.product_id}" tidak mencukupi saat pembayaran diselesaikan (tersisa ${prevStock}, diminta ${item.quantity}).`);
        }

        const currentStock = prevStock - Number(item.quantity);
        const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;

        db.prepare(`
          INSERT INTO inventory_movements (
            id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, actor_id, notes, created_at
          ) VALUES (?, ?, ?, 'sale_deduction', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          movementId,
          order.branch_id,
          item.product_id,
          -Number(item.quantity),
          prevStock,
          currentStock,
          order.order_number,
          order.customer_phone || 'online_payment',
          `Pemotongan stok otomatis pembayaran lunas [${order.order_number}]`,
          now
        );

        deductedItems.push({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          previous_stock: prevStock,
          current_stock: currentStock
        });
      }

      if (!dbTransactionProvided) {
        db.exec('COMMIT;');
      }
    } catch (err) {
      if (!dbTransactionProvided) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
      }
      throw err;
    }

    return { success: true, deducted_items: deductedItems };
  }
}

module.exports = OrderPlacementService;
