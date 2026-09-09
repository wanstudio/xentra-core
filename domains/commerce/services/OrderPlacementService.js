/**
 * Xentra Commerce Order Placement Service
 * Handles customer order submission with ACID database transactions, optimistic concurrency guards,
 * dynamic branch low-stock thresholds, and distributed event dispatching.
 */
const crypto = require('crypto');
const {
  OrderRepository,
  InventoryRepository,
  PosShiftRepository
} = require('../../../core/data/repositories');
const { events } = require('../../../core');
const PrePaymentVerificationGate = require('./PrePaymentVerificationGate');
const LowStockThresholdModel = require('../models/LowStockThresholdModel');

const orderRepository = new OrderRepository();
const inventoryRepository = new InventoryRepository();
const posShiftRepository = new PosShiftRepository();

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
    const effectivePaymentMethod = (payment_method === 'cash') ? 'cash' : 'midtrans';
    const effectiveOrderType = order_type || 'delivery';

    const insertedStatus = (effectivePaymentMethod === 'cash' && order_channel === 'pos_cashier')
      ? 'confirmed'
      : 'pending';

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
        orderRepository.beginTransaction();

        if (customer.phone) {
          const existingRes = orderRepository.findActiveReservation({
            branchId: branch_id,
            customerPhone: customer.phone,
            reservationDate: resDateStr
          });

          if (existingRes) {
            orderRepository.rollbackTransaction();
            return {
              success: false,
              status: 'DUPLICATE_RESERVATION',
              errors: [`Anda sudah memiliki booking reservasi aktif di cabang ini untuk tanggal ${resDateStr}.`]
            };
          }
        }

        const dailyBookingsCount = orderRepository.countActiveReservations({
          branchId: branch_id,
          reservationDate: resDateStr
        });

        if (dailyBookingsCount >= 30) {
          orderRepository.rollbackTransaction();
          return {
            success: false,
            status: 'BRANCH_CAPACITY_FULL',
            errors: [`Kapasitas reservasi meja untuk cabang ini pada tanggal ${resDateStr} sudah penuh.`]
          };
        }

        orderRepository.insertReservation({
          id: orderId,
          orderNumber,
          brandId: brand_id,
          branchId: branch_id,
          customerName: customer.name || 'Tamu Reservasi',
          customerPhone: customer.phone || '',
          orderChannel: order_channel,
          selectionMode: selection_mode || 'CUSTOMER_SELECTED',
          reservationDate: resDateStr,
          orderNote: notes ? `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr}) | ${notes}` : `Reservasi (${guest_count || 1} Tamu, Tgl: ${resDateStr})`,
          createdAt: now,
          updatedAt: now
        });

        orderRepository.commitTransaction();
      } catch (txErr) {
        try { orderRepository.rollbackTransaction(); } catch (_) {}
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

    try {
      orderRepository.beginTransaction();

      orderRepository.insertOrder({
        id: orderId,
        orderNumber,
        clientTransactionId: client_transaction_id || null,
        brandId: brand_id,
        branchId: branch_id,
        customerName: customer.name || 'Pelanggan',
        customerPhone: customer.phone || '',
        orderType: effectiveOrderType,
        orderChannel: order_channel,
        selectionMode: selection_mode || 'CUSTOMER_SELECTED',
        tableNumber: table_number,
        fulfillmentScheduleType: fulfillment_schedule_type,
        scheduledSlotStart: scheduled_slot_start,
        scheduledSlotEnd: scheduled_slot_end,
        subtotal,
        discountAmount: Number(discount_amount || 0),
        deliveryFee: Number(delivery_fee || 0),
        grandTotal,
        paymentMethod: effectivePaymentMethod,
        status: insertedStatus,
        orderNote: notes,
        diningSessionId: dining_session_id || null,
        createdAt: now,
        updatedAt: now
      });

      for (const item of verifiedItems) {
        const itemId = `item_${crypto.randomBytes(6).toString('hex')}`;
        const formattedItemNote = item.promo_id
          ? `[PROMO:${item.promo_id}] ${item.notes || item.note || ''}`.trim()
          : (item.notes || item.note || '');

        item.note = formattedItemNote;

        orderRepository.insertItem({
          id: itemId,
          orderId,
          productId: item.product_id,
          productName: item.name,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          itemSubtotal: item.subtotal,
          note: formattedItemNote
        });

        if (effectivePaymentMethod === 'cash') {
          const bpBefore = inventoryRepository.findBranchProduct(branch_id, item.product_id);
          const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

          const deductResult = inventoryRepository.deductBranchProduct({
            quantity: item.quantity,
            branchId: branch_id,
            productId: item.product_id
          });
          if (!deductResult || deductResult.changes === 0) {
            throw new Error(`[CONCURRENCY_RACE] Stok untuk produk "${item.name}" baru saja habis atau tidak mencukupi.`);
          }

          const currentStock = prevStock - Number(item.quantity);
          const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;

          inventoryRepository.insertSaleDeduction({
            id: movementId,
            branchId: branch_id,
            productId: item.product_id,
            quantity: item.quantity,
            previousStock: prevStock,
            currentStock,
            referenceId: orderNumber,
            actorId: customer.phone || 'customer_order',
            notes: `Pemotongan stok otomatis pesanan ${orderNumber} (${effectiveOrderType}/${order_channel})`,
            createdAt: now
          });
        }
      }

      if (delivery_record) {
        orderRepository.insertDelivery({
          id: delivery_record.id || ('del_' + crypto.randomBytes(6).toString('hex')),
          orderId,
          destinationAddress: delivery_record.destination_address || 'Alamat Customer',
          destinationLatitude: delivery_record.destination_latitude || 0,
          destinationLongitude: delivery_record.destination_longitude || 0,
          actualRoadDistanceMeters: delivery_record.actual_road_distance_meters || 0,
          actualDurationSeconds: delivery_record.actual_duration_seconds || 0,
          chargeableDistanceKm: delivery_record.chargeable_distance_km || 0,
          freeKmApplied: delivery_record.free_km_applied || 0,
          ratePerKmApplied: delivery_record.rate_per_km_applied || 0,
          deliveryFeeCalculated: delivery_record.delivery_fee_calculated || 0
        });
      }

      const initialPaymentId = `pay_${crypto.randomBytes(6).toString('hex')}`;
      orderRepository.ensurePendingPayment({
        paymentId: initialPaymentId,
        orderId,
        provider: effectivePaymentMethod,
        paymentMethod: effectivePaymentMethod,
        merchantId: effectivePaymentMethod === 'cash' ? 'cash' : 'midtrans',
        amount: grandTotal,
        createdAt: now,
        updatedAt: now
      });

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

      if (shift_id && effectivePaymentMethod === 'cash') {
        const shiftUpdateRes = posShiftRepository.incrementCashSales({
          shiftId: shift_id,
          branchId: branch_id,
          amount: grandTotal
        });

        if (!shiftUpdateRes || shiftUpdateRes.changes !== 1) {
          throw new Error(`[SHIFT_UPDATE_FAILED]: POS shift "${shift_id}" tidak ditemukan, bukan milik cabang "${branch_id}", atau sudah ditutup.`);
        }
      }

      orderRepository.commitTransaction();
    } catch (txErr) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}

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

  static deductStockForSettledOrder(orderId, { dbTransactionProvided = false } = {}) {
    const order = orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`[OrderPlacementService] Order "${orderId}" tidak ditemukan.`);
    }

    const items = orderRepository.findItems(orderId);
    if (!items || items.length === 0) {
      return { success: true, deducted_items: [] };
    }

    const existingMovement = inventoryRepository.findSaleDeductionByReference(order.order_number);
    if (existingMovement) {
      return { success: true, idempotent: true, deducted_items: [] };
    }

    const now = new Date().toISOString();
    const deductedItems = [];

    if (!dbTransactionProvided) {
      inventoryRepository.beginTransaction?.();
    }

    try {
      for (const item of items) {
        const isVirtualPromo = (item.unit_price === 0 || Number(item.unit_price) === 0) &&
                               (item.note?.includes('Promo') || item.note?.includes('Bonus') || String(item.product_id).startsWith('prm_') || String(item.product_id).startsWith('reward_'));

        const bpBefore = inventoryRepository.findBranchProduct(order.branch_id, item.product_id);
        if (!bpBefore && isVirtualPromo) {
          continue;
        }

        const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;

        const deductResult = inventoryRepository.deductBranchProduct({
          quantity: item.quantity,
          branchId: order.branch_id,
          productId: item.product_id
        });
        if (!deductResult || deductResult.changes === 0) {
          throw new Error(`[OUT_OF_STOCK_RACE] Stok untuk produk "${item.product_name || item.product_id}" tidak mencukupi saat pembayaran diselesaikan (tersisa ${prevStock}, diminta ${item.quantity}).`);
        }

        const currentStock = prevStock - Number(item.quantity);
        const movementId = `mov_${crypto.randomBytes(6).toString('hex')}`;

        inventoryRepository.insertSaleDeduction({
          id: movementId,
          branchId: order.branch_id,
          productId: item.product_id,
          quantity: item.quantity,
          previousStock: prevStock,
          currentStock,
          referenceId: order.order_number,
          actorId: order.customer_phone || 'online_payment',
          notes: `Pemotongan stok otomatis pembayaran lunas [${order.order_number}]`,
          createdAt: now
        });

        deductedItems.push({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          previous_stock: prevStock,
          current_stock: currentStock
        });
      }

      if (!dbTransactionProvided) {
        throw new Error('InventoryRepository transaction lifecycle is not configured for standalone settlement.');
      }
    } catch (err) {
      throw err;
    }

    return { success: true, deducted_items: deductedItems };
  }
}

module.exports = OrderPlacementService;
