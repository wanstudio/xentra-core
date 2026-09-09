'use strict';

const crypto = require('crypto');
const {
  PaymentRepository,
  DiningTableRepository,
  PosShiftRepository
} = require('../../../core/data/repositories');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

const paymentRepository = new PaymentRepository();
const diningTableRepository = new DiningTableRepository();
const posShiftRepository = new PosShiftRepository();

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
    shift_id = null
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

    const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled', 'expired', 'rejected', 'timeout', 'fulfillment_exception'];
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new Error(`[CashSettlementService] Tidak dapat menyelesaikan pembayaran tunai untuk pesanan yang sudah berada pada status terminal "${order.status}".`);
    }

    if (order.status === 'pending') {
      throw new Error(
        `[ORDER_NOT_ACCEPTED]: Pesanan "${order_id}" masih menunggu penerimaan cabang (ACCEPT) dan belum dapat dilunasi. Silakan terima pesanan terlebih dahulu.`
      );
    }

    if (order.payment_method && order.payment_method !== 'cash') {
      throw new Error(`[CashSettlementService Payment Method Conflict]: Pesanan "${order_id}" menggunakan metode pembayaran online "${order.payment_method}". Tidak dapat diselesaikan melalui pelunasan tunai (Cash).`);
    }

    const expectedAmount = Number(order.grand_total);
    if (Number(amount) !== expectedAmount) {
      throw new Error(
        `[SETTLEMENT_AMOUNT_MISMATCH]: Jumlah pembayaran (Rp ${Number(amount).toLocaleString('id-ID')}) tidak sesuai dengan total tagihan order (Rp ${expectedAmount.toLocaleString('id-ID')}).`
      );
    }

    if (amount_tendered === undefined || amount_tendered === null || !Number.isFinite(Number(amount_tendered)) || Number(amount_tendered) <= 0) {
      throw new Error('[CashSettlementService] Nominal uang yang diterima (amount_tendered) wajib diisi dengan angka positif yang valid.');
    }

    const tendered = Number(amount_tendered);
    if (tendered < amount) {
      throw new Error(`[CashSettlementService] Uang yang diterima (Rp ${tendered.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${amount.toLocaleString('id-ID')}).`);
    }

    if (Math.round(Number(amount)) !== Math.round(Number(order.grand_total))) {
      throw new Error(`[SETTLEMENT_AMOUNT_MISMATCH]: Nominal kas (Rp ${amount}) tidak sesuai dengan total tagihan pesanan (Rp ${order.grand_total}).`);
    }

    const existingPayment = paymentRepository.findPaymentByOrderId(order_id);
    if (existingPayment) {
      if (existingPayment.provider && existingPayment.provider !== 'cash') {
        throw new Error(`[CashSettlementService Provider Conflict]: Pembayaran untuk pesanan "${order_id}" sudah terdaftar dengan provider online "${existingPayment.provider}".`);
      }
      if (Math.round(Number(existingPayment.amount)) !== Math.round(Number(order.grand_total))) {
        throw new Error(`[SETTLEMENT_AMOUNT_MISMATCH]: Record pembayaran sebelumnya (Rp ${existingPayment.amount}) tidak sesuai dengan tagihan pesanan (Rp ${order.grand_total}).`);
      }
      if (existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT) {
        return {
          success: true,
          idempotent: true,
          payment_id: existingPayment.id,
          order_id,
          amount: Number(existingPayment.amount),
          payment_status: PaymentModel.STATUSES.SETTLEMENT,
          message: 'Pembayaran tunai sudah diselesaikan sebelumnya.'
        };
      }
    }

    if (shift_id) {
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

    const change = tendered - amount;
    const generatedPaymentId = `pay_cash_${crypto.randomBytes(6).toString('hex')}`;
    const actualPaymentId = existingPayment ? existingPayment.id : generatedPaymentId;
    const now = new Date().toISOString();

    paymentRepository.beginTransaction();
    try {
      if (shift_id) {
        const shiftInTx = posShiftRepository.findStatusById(shift_id);
        if (!shiftInTx || shiftInTx.status !== 'open') {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Shift kasir "${shift_id}" sudah ditutup dan tidak dapat menerima transaksi kas.`);
        }

        const shiftUpdateRes = posShiftRepository.incrementCashSales({
          shiftId: shift_id,
          branchId: order.branch_id,
          amount
        });

        if (shiftUpdateRes.changes !== 1) {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Gagal memperbarui kas shift "${shift_id}" karena shift telah ditutup secara bersamaan.`);
        }
      }

      paymentRepository.settleCashPayment({
        paymentId: actualPaymentId,
        orderId: order_id,
        amount,
        settledAt: now,
        rawPayment: JSON.stringify({ amount_tendered: tendered, change, cashier_id, shift_id }),
        createdAt: now,
        updatedAt: now
      });

      paymentRepository.markOrderPaidByCash({ orderId: order_id, updatedAt: now });

      if (order && order.order_type === 'dine_in') {
        try {
          const { DiningTableService } = require('../../pos');
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
              hold_reference_id: order.id
            });
          }
        } catch (dineErr) {
          console.warn('[CashSettlementService] Dine-in table settlement warning:', dineErr.message);
        }
      }

      paymentRepository.commitTransaction();
    } catch (err) {
      try { paymentRepository.rollbackTransaction(); } catch (_) {}
      throw err;
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
        amount,
        amount_tendered: tendered,
        change,
        settled_at: now
      }
    }).catch(() => {});

    return {
      success: true,
      payment_id: actualPaymentId,
      order_id,
      payment_status: 'settlement',
      provider: 'cash',
      amount,
      amount_tendered: tendered,
      change,
      settled_at: now
    };
  }
}

module.exports = CashSettlementService;
