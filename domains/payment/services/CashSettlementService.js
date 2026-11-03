'use strict';

const crypto = require('crypto');
const {
  PaymentRepository,
  DiningTableRepository,
  PosShiftRepository,
  PosBillRepository
} = require('../../../core/data/repositories');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

const paymentRepository = new PaymentRepository();
const diningTableRepository = new DiningTableRepository();
const posShiftRepository = new PosShiftRepository();
const posBillRepository = new PosBillRepository();

class CashSettlementService {
  /**
   * Settles an order payment using physical cash.
   * Records payment lifecycle state independently and emits payment.settled.
   */
  static settleCashPayment({
    order_id,
    amount,
    amount_tendered = null,
    cashier_id = null,
    shift_id = null,
    skip_shift_increment = false,
    manage_transaction = true,
    payment_group_id = null
  }) {
    const validation = PaymentModel.validatePaymentParams({
      order_id,
      amount,
      provider: 'cash'
    });

    if (!validation.is_valid) {
      throw new Error(`[CashSettlementService] Validasi gagal: ${validation.errors.join(', ')}`);
    }

    const order = paymentRepository.findOrder(order_id);
    if (!order) {
      throw new Error(`[CashSettlementService] Order "${order_id}" tidak ditemukan.`);
    }

    const TERMINAL_ORDER_STATUSES = ['cancelled', 'expired', 'rejected', 'timeout', 'fulfillment_exception'];
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new Error(`[CashSettlementService] Tidak dapat menyelesaikan pembayaran tunai untuk pesanan yang sudah berada pada status terminal "${order.status}".`);
    }

    if (order.status === 'completed') {
      // Completed Order Exception (Contract v1.1):
      // Normal COD state is Delivery = delivered, Order = completed, Payment = pending.
      // Order completion does not close the payment lifecycle for cash/COD.
      // Non-COD orders (dine_in, take_away, etc.) in 'completed' state must strictly reject cash settlement.
      if (order.order_type !== 'delivery') {
        throw new Error(`[CashSettlementService] Tidak dapat menyelesaikan pembayaran tunai untuk pesanan yang sudah berada pada status terminal "${order.status}".`);
      }
      if (order.payment_method !== 'cash') {
        throw new Error(`[CashSettlementService] Tidak dapat menyelesaikan pembayaran tunai untuk pesanan "${order_id}" yang sudah selesai dan bukan pembayaran tunai/COD.`);
      }
    }

    if (order.status === 'pending') {
      throw new Error(
        `[ORDER_NOT_ACCEPTED]: Pesanan "${order_id}" masih menunggu penerimaan cabang (ACCEPT) dan belum dapat dilunasi. Silakan terima pesanan terlebih dahulu.`
      );
    }

    const expectedAmount = Number(order.grand_total);
    const existingPayment = paymentRepository.findPaymentByOrderId(order_id);
    const existingPaidAmount = Number(existingPayment && existingPayment.amount) || 0;
    const canSettleSharedDineInRemainder = Boolean(
      order.order_type === 'dine_in' &&
      existingPayment &&
      existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT &&
      existingPaidAmount < expectedAmount
    );
    if (order.payment_method && order.payment_method !== 'cash' && !canSettleSharedDineInRemainder) {
      throw new Error(`[CashSettlementService Payment Method Conflict]: Pesanan "${order_id}" menggunakan metode pembayaran online "${order.payment_method}". Tidak dapat diselesaikan melalui pelunasan tunai (Cash).`);
    }
    if (Number(amount) !== expectedAmount) {
      throw new Error(
        `[SETTLEMENT_AMOUNT_MISMATCH]: Jumlah pembayaran (Rp ${Number(amount).toLocaleString('id-ID')}) tidak sesuai dengan total tagihan order (Rp ${expectedAmount.toLocaleString('id-ID')}).`
      );
    }

    if (amount_tendered === undefined || amount_tendered === null || !Number.isFinite(Number(amount_tendered)) || Number(amount_tendered) <= 0) {
      throw new Error('[CashSettlementService] Nominal uang yang diterima (amount_tendered) wajib diisi dengan angka positif yang valid.');
    }

    const tendered = Number(amount_tendered);

    if (existingPayment) {
      if (existingPayment.provider && existingPayment.provider !== 'cash' && !canSettleSharedDineInRemainder) {
        throw new Error(`[CashSettlementService Provider Conflict]: Pembayaran untuk pesanan "${order_id}" sudah terdaftar dengan provider online "${existingPayment.provider}".`);
      }
      const existingAmount = Number(existingPayment.amount || 0);
      const currentGrandTotal = Number(order.grand_total || 0);

      if (existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT &&
          Math.round(existingAmount) === Math.round(currentGrandTotal)) {
        return {
          success: true,
          idempotent: true,
          payment_id: existingPayment.id,
          order_id,
          amount: currentGrandTotal,
          payment_status: PaymentModel.STATUSES.SETTLEMENT,
          message: 'Pembayaran tunai sudah diselesaikan sebelumnya.'
        };
      }

      // Dine-in Additional Order may increase the current canonical total
      // after an earlier settlement. Detailed payment history remains in
      // pos_check_payments; order_payments is the current cumulative summary.
      if (existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT &&
          existingAmount < currentGrandTotal) {
        // Allowed: settleCashPayment below updates the existing summary row.
      } else if (Math.round(existingAmount) !== Math.round(currentGrandTotal)) {
        throw new Error(`[SETTLEMENT_AMOUNT_MISMATCH]: Record pembayaran sebelumnya (Rp ${existingPayment.amount}) tidak sesuai dengan tagihan pesanan (Rp ${order.grand_total}).`);
      }
    }

    const priorSettledAmount = existingPayment && existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT
      ? Number(existingPayment.amount || 0)
      : 0;
    const amountDue = Math.max(0, expectedAmount - priorSettledAmount);
    if (amountDue <= 0 && existingPayment && existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT) {
      return {
        success: true,
        idempotent: true,
        payment_id: existingPayment.id,
        order_id,
        amount: 0,
        payment_status: PaymentModel.STATUSES.SETTLEMENT,
        message: 'Pembayaran tunai sudah diselesaikan sebelumnya.'
      };
    }
    if (tendered < amountDue) {
      throw new Error(`[CashSettlementService] Uang yang diterima (Rp ${tendered.toLocaleString('id-ID')}) kurang dari sisa tagihan (Rp ${amountDue.toLocaleString('id-ID')}).`);
    }

    if (shift_id && !skip_shift_increment) {
      const shiftRecord = posShiftRepository.findById(shift_id);
      if (!shiftRecord) {
        throw new Error(`[CashSettlementService] Shift kasir dengan ID "${shift_id}" tidak ditemukan.`);
      }
      if (shiftRecord.status !== 'open') {
        throw new Error(`[CashSettlementService] Shift kasir "${shift_id}" sudah ditutup (${shiftRecord.status}) dan tidak dapat menerima transaksi.`);
      }
      if (shiftRecord.branch_id !== order.branch_id) {
        throw new Error(`[CashSettlementService Cross-Scope Violation]: Shift kasir "${shift_id}" (Cabang: ${shiftRecord.branch_id}) tidak sesuai dengan cabang order (Cabang: ${order.branch_id}).`);
      }
      if (cashier_id && shiftRecord.cashier_id && shiftRecord.cashier_id !== cashier_id) {
        throw new Error(`[CashSettlementService Authorization Violation]: Shift kasir "${shift_id}" bukan milik kasir yang sedang login ("${cashier_id}").`);
      }
    }

    const change = tendered - amountDue;
    const generatedPaymentId = `pay_cash_${crypto.randomBytes(6).toString('hex')}`;
    const actualPaymentId = existingPayment ? existingPayment.id : generatedPaymentId;
    const now = new Date().toISOString();

    if (manage_transaction) paymentRepository.beginTransaction();
    try {
      if (shift_id && !skip_shift_increment) {
        const shiftInTx = posShiftRepository.findStatusById(shift_id);
        if (!shiftInTx || shiftInTx.status !== 'open') {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Shift kasir "${shift_id}" sudah ditutup dan tidak dapat menerima transaksi kas.`);
        }

        const shiftUpdateRes = posShiftRepository.incrementCashSales({
          shiftId: shift_id,
          branchId: order.branch_id,
          amount: amountDue
        });

        if (shiftUpdateRes.changes !== 1) {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Gagal memperbarui kas shift "${shift_id}" karena shift telah ditutup secara bersamaan.`);
        }
      }

      paymentRepository.settleCashPayment({
        paymentId: actualPaymentId,
        orderId: order_id,
        amount: expectedAmount,
        settledAt: now,
        rawPayment: JSON.stringify({ amount_tendered: tendered, change, cashier_id, shift_id, payment_group_id, amount_due: amountDue, prior_settled_amount: priorSettledAmount }),
        createdAt: now,
        updatedAt: now
      });

      paymentRepository.markOrderPaidByCash({ orderId: order_id, updatedAt: now });

      // Transfer COD cash custody to cashier upon settlement if order has delivery
      try {
        const { OrderRepository } = require('../../../core/data/repositories');
        const oRepo = new OrderRepository();
        const del = oRepo.findDeliveryByOrderId(order_id);
        if (del) {
          oRepo.recordDeliveryCodHandover({
            orderId: order_id,
            codHandedOverTo: cashier_id || null,
            updatedAt: now
          });
        }
      } catch (_) {}

      const checks = posBillRepository.findChecks(order_id);
      if (checks && checks.length > 0) {
        for (const check of checks) {
          if (check.status === 'open') {
            const checkPaid = posBillRepository.findCheckPaidAmount(check.id);
            const checkAllocated = Number(check.allocated_amount || 0);
            const checkUnpaid = Math.max(0, checkAllocated - checkPaid);
            if (checkUnpaid > 0) {
              posBillRepository.createCheckPayment({
                id: `cp_${crypto.randomBytes(6).toString('hex')}`,
                checkId: check.id,
                orderId: order_id,
                paymentMethod: 'cash',
                provider: 'cash',
                amount: checkUnpaid,
                paymentStatus: 'settlement',
                payerName: null,
                actorId: cashier_id,
                rawPayment: JSON.stringify({ amount_tendered: tendered, change, cashier_id, shift_id, payment_group_id }),
                settledAt: now,
                now
              });
            }
            posBillRepository.setCheckStatus(check.id, 'paid', now);
          }
        }
      }

      if (order && order.order_type === 'dine_in') {
        try {
          const { DiningTableService } = require('../../dining');
          let tableIds = [];
          const activeHold = diningTableRepository.findActiveHolds(order.id);
          if (activeHold && activeHold.length > 0) {
            tableIds = activeHold.map(h => h.table_id);
          } else if (order.table_number) {
            const tbl = diningTableRepository.findTableIdByNumberOrLabel(order.branch_id, order.table_number);
            if (tbl) tableIds = [tbl.id];
          }

          if (tableIds.length > 0) {
            DiningTableService.createOrAttachDiningSession({
              branch_id: order.branch_id,
              table_ids: tableIds,
              order_id: order.id,
              customer_name: order.customer_name,
              customer_phone: order.customer_phone,
              guest_count: order.guest_count || 1,
              hold_reference_id: order.id,
              channel: order.order_channel || 'pos_cashier'
            });
          }
        } catch (dineErr) {
          console.warn('[CashSettlementService] Dine-in table settlement warning:', dineErr.message);
        }
      }

      if (manage_transaction) paymentRepository.commitTransaction();
    } catch (err) {
      if (manage_transaction) { try { paymentRepository.rollbackTransaction(); } catch (_) {} }
      throw err;
    }

    // Dine-in served-but-unpaid: once POS settles, the order completes.
    if (order.order_type === 'dine_in' && order.status === 'ready') {
      try {
        const served = paymentRepository.db.queryOne(
          "SELECT 1 AS ok FROM order_status_logs WHERE order_id = ? AND note LIKE '[SERVED_TO_TABLE]%' LIMIT 1",
          [order_id]
        );
        if (served) {
          const OrderStateMachine = require('../../../server/services/OrderStateMachine');
          OrderStateMachine.transition({ order_id, target_status: 'completed', actor_type: 'cashier', actor_id: cashier_id, note: '[AUTO_COMPLETE] Sudah disajikan & lunas di Kasir POS.' });
        }
      } catch (_) {}
    }

    events.EventBus.publish({
      type: 'payment.settled',
      producer: 'payment',
      payload: {
        payment_id: actualPaymentId,
        order_id,
        branch_id: order.branch_id,
        brand_id: order.brand_id,
        provider: 'cash',
        payment_method: 'cash',
        amount: amountDue,
        amount_tendered: tendered,
        change,
        settled_at: now
      }
    }).catch(() => {});

    try {
      const { NotificationService } = require('../../../core');
      const notifService = new NotificationService(paymentRepository.db);
      notifService.createNotification({
        brand_id: order.brand_id,
        branch_id: order.branch_id,
        source_type: 'payment',
        title: 'Pembayaran Diterima!',
        body: `Pembayaran pesanan #${order.order_number} senilai Rp ${(expectedAmount || 0).toLocaleString('id-ID')} telah lunas.`,
        priority: 'normal',
        target_role: null, // Broadcast to branch manager & cashier
        target_scope: 'branch',
        related_entity_type: 'payment',
        related_entity_id: actualPaymentId,
        action_url: `/pos/`
      });
    } catch (_) {}

    return {
      success: true,
      payment_id: actualPaymentId,
      order_id,
      payment_status: 'settlement',
      provider: 'cash',
      amount: amountDue,
      amount_tendered: tendered,
      change,
      settled_at: now
    };
  }
}

module.exports = CashSettlementService;
