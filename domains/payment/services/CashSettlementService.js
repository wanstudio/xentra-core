'use strict';

const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

class CashSettlementService {
  /**
   * Settles an order payment using physical cash.
   * Records payment lifecycle state independently and emits payment.settled.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {number} params.amount
   * @param {number} [params.amount_tendered]
   * @param {string} [params.cashier_id]
   * @param {string} [params.shift_id]
   * @returns {Object} Settled payment record
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

    // P1 FINANCIAL INTEGRITY (Amount-Bound Check): Settlement amount must match authoritative order.grand_total
    const expectedAmount = Number(order.grand_total);
    if (Number(amount) !== expectedAmount) {
      throw new Error(
        `[CashSettlementService] Jumlah pembayaran (Rp ${Number(amount).toLocaleString('id-ID')}) tidak sesuai dengan total tagihan order (Rp ${expectedAmount.toLocaleString('id-ID')}).`
      );
    }

    const tendered = typeof amount_tendered === 'number' ? amount_tendered : amount;
    if (tendered < amount) {
      throw new Error(`[CashSettlementService] Uang yang diterima (Rp ${tendered.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${amount.toLocaleString('id-ID')}).`);
    }

    // P1 IDEMPOTENCY GUARD: Return early if cash payment was already settled to prevent double revenue / events
    const existingPayment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
    if (existingPayment && existingPayment.payment_status === PaymentModel.STATUSES.SETTLEMENT) {
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

    const change = tendered - amount;
    const paymentId = `pay_cash_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    // P1 ATOMIC CONCURRENCY: Execute Cash Settlement in exclusive transaction with atomic UPSERT
    db.exec('BEGIN IMMEDIATE;');
    try {
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
        paymentId,
        order_id,
        amount,
        now,
        JSON.stringify({ amount_tendered: tendered, change, cashier_id, shift_id }),
        now,
        now
      );

      // 2. Update order payment details & status
      db.prepare(`
        UPDATE orders
        SET payment_method = 'cash', status = 'confirmed', updated_at = ?
        WHERE id = ?
      `).run(now, order_id);

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw new Error(`[CashSettlementService] Gagal menyelesaikan pembayaran tunai secara atomik: ${err.message}`);
    }

    // 3. Emit Domain Event: payment.settled
    events.EventBus.publish({
      type: 'payment.settled',
      producer: 'payment',
      payload: {
        payment_id: paymentId,
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
      payment_id: paymentId,
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
