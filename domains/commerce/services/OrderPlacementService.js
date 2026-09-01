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
    table_number = null,
    reservation_date = null,
    guest_count = null,
    notes = '',
    trace_context = {}
  }) {
    // Strict Payment Method Scope Alignment (Xentra Payment = Cash or Midtrans)
    const effectivePaymentMethod = (payment_method === 'cash') ? 'cash' : 'midtrans';
    const effectiveOrderType = order_type || 'delivery';

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
      // Compare only YYYY-MM-DD
      const resDateStr = resDate.toISOString().slice(0, 10);
      const todayStr = today.toISOString().slice(0, 10);

      if (resDateStr <= todayStr) {
        return {
          success: false,
          status: 'SAME_DAY_RESERVATION_REJECTED',
          errors: ['Reservasi hari yang sama tidak diperbolehkan. Minimum reservasi adalah untuk besok atau tanggal setelahnya.']
        };
      }

      // P1 BUSINESS INVARIANT (NEW-02): Pure table booking lifecycle.
      // Reservation is not an active food order, creates no bill, and carries no product items until check-in at POS.
      const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();
      const orderNumber = `RES-${Date.now().toString(36).toUpperCase()}`;

      try {
        db.exec('BEGIN TRANSACTION;');

        db.prepare(`
          INSERT INTO orders (
            id, order_number, brand_id, branch_id, customer_name, customer_phone,
            order_type, order_channel, table_number,
            subtotal, delivery_fee, grand_total, payment_method, status, order_note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'reservation', ?, ?, 0, 0, 0, 'cash', 'confirmed', ?, ?, ?)
        `).run(
          orderId,
          orderNumber,
          brand_id,
          branch_id,
          customer.name || 'Tamu Reservasi',
          customer.phone || '',
          order_channel,
          table_number,
          notes ? `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr}) | ${notes}` : `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr})`,
          now,
          now
        );

        db.exec('COMMIT;');
      } catch (txErr) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return {
          success: false,
          status: 'RESERVATION_ERROR',
          errors: [txErr.message || 'Gagal membuat data booking reservasi.'],
          price_diffs: []
        };
      }

      // Publish Core Event: commerce.reservation.booked
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

    // 1. Execute Atomic Pre-Payment Verification Gate (For live food orders: delivery, pickup, dine_in)
    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id,
      items
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

    // 2. Prepared Statements for Transaction
    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, table_number, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end,
        subtotal, discount_amount, delivery_fee, grand_total, payment_method, status, order_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    const insertOrderItemStmt = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Guarded Conditional Deduction: WHERE stock >= ? prevents overselling even under high concurrency
    const guardedDeductStockStmt = db.prepare(`
      UPDATE branch_products
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ? AND stock >= ?
    `);

    // 3. Execute Transaction
    try {
      db.exec('BEGIN TRANSACTION;');

      insertOrderStmt.run(
        orderId,
        orderNumber,
        brand_id,
        branch_id,
        customer.name || 'Pelanggan',
        customer.phone || '',
        effectiveOrderType,
        order_channel,
        table_number,
        fulfillment_schedule_type,
        scheduled_slot_start,
        scheduled_slot_end,
        subtotal,
        Number(discount_amount || 0),
        Number(delivery_fee || 0),
        grandTotal,
        effectivePaymentMethod,
        notes,
        now,
        now
      );

      for (const item of verifiedItems) {
        const itemId = `item_${crypto.randomBytes(6).toString('hex')}`;
        insertOrderItemStmt.run(
          itemId,
          orderId,
          item.product_id,
          item.name,
          item.unit_price,
          item.quantity,
          item.subtotal,
          item.note || ''
        );

        // P1 INVENTORY TIMING & DOS GUARD: Only deduct live physical stock immediately for CASH/POS orders.
        // For online payment gateways (Midtrans), physical stock is safely deducted upon payment settlement (payment.settled webhook).
        if (effectivePaymentMethod === 'cash') {
          const bpBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch_id, item.product_id);
          const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

          const deductResult = guardedDeductStockStmt.run(item.quantity, branch_id, item.product_id, item.quantity);
          if (!deductResult || deductResult.changes === 0) {
            throw new Error(`[CONCURRENCY_RACE] Stok untuk produk "${item.name}" baru saja habis atau tidak mencukupi.`);
          }

          const currentStock = prevStock - Number(item.quantity);
          const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;

          // Authoritative Cross-Domain Integration: Write immutable ledger record in Inventory domain table
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

      // Save delivery record if provided (e.g. online delivery checkout)
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

      // P1 ATOMIC FINANCIAL TRANSACTION INVARIANT (NEW-01 & NEW-02):
      // Create local order_payments attempt in the SAME transaction as order, items, and inventory.
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

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      return {
        success: false,
        status: 'OUT_OF_STOCK',
        errors: [txErr.message || 'Terjadi kegagalan pemesanan karena perubahan ketersediaan stok.'],
        price_diffs: []
      };
    }

    // 4. Low-stock evaluation & Event Dispatching (After Transaction Commit for cash orders)
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

    // 5. Publish Core Event: commerce.order.placed
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

    const initialStatus = effectivePaymentMethod === 'cash' ? 'confirmed' : 'pending';

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

    // P1 IDEMPOTENCY GUARD: Check if inventory deduction was already executed for this order
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
        const bpBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(order.branch_id, item.product_id);
        const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

        const deductResult = guardedDeductStockStmt.run(item.quantity, order.branch_id, item.product_id, item.quantity);
        if (!deductResult || deductResult.changes === 0) {
          // P1 CRITICAL CONCURRENCY RACE GUARD: Stock was depleted between checkout and settlement
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
