'use strict';

const crypto = require('crypto');
const db = require('../../../core/data/DataAccess');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

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

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
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

    const existingPayment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
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
      const shiftRecord = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shift_id);
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

    db.exec('BEGIN IMMEDIATE;');
    try {
      if (shift_id) {
        const shiftInTx = db.prepare('SELECT status FROM pos_shifts WHERE id = ?').get(shift_id);
        if (!shiftInTx || shiftInTx.status !== 'open') {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Shift kasir "${shift_id}" sudah ditutup dan tidak dapat menerima transaksi kas.`);
        }

        const shiftUpdateRes = db.prepare(`
          UPDATE pos_shifts
          SET total_cash_sales = total_cash_sales + ?, expected_cash = expected_cash + ?
          WHERE id = ? AND status = 'open'
        `).run(amount, amount, shift_id);

        if (shiftUpdateRes.changes !== 1) {
          throw new Error(`[SHIFT_ALREADY_CLOSED]: Gagal memperbarui kas shift "${shift_id}" karena shift telah ditutup secara bersamaan.`);
        }
      }

      db.prepare(`
        INSERT INTO order_payments (
          id, order_id, provider, payment_method, amount, payment_status, settled_at, raw_webhook_response, created_at, updated_at
        ) VALUES (?, ?, 'cash', 'cash', ?, 'settlement', ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
          payment_status = 'settlement',
          payment_method = 'cash',
          amount = excluded.amount,
          settled_at = excluded.settled_at,
          raw_webhook_response = excluded.raw_webhook_response,
          updated_at = excluded.updated_at
      `).run(
        actualPaymentId,
        order_id,
        amount,
        now,
        JSON.stringify({ amount_tendered: tendered, change, cashier_id, shift_id }),
        now,
        now
      );

      db.prepare(`
        UPDATE orders
        SET payment_method = 'cash',
            updated_at = ?
        WHERE id = ?
      `).run(now, order_id);

      if (order && order.order_type === 'dine_in') {
        try {
          const { DiningTableService } = require('../../pos');
          let tableIds = [];
          const activeHold = db.prepare("SELECT hold_reference_id, table_id FROM branch_table_holds WHERE hold_reference_id = ? AND status = 'active'").all(order.id);
          if (activeHold && activeHold.length > 0) {
            tableIds = activeHold.map(h => h.table_id);
          } else if (order.table_number) {
            const tbl = db.prepare('SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)').get(order.branch_id, order.table_number, order.table_number);
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

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
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
