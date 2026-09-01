'use strict';

const crypto = require('crypto');
const axios = require('axios');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

class PaymentGatewayService {
  /**
   * Resolves Midtrans configuration hierarchically (Branch -> Brand -> Environment).
   * 
   * @param {string} branch_id
   * @param {string} brand_id
   * @returns {Object} Midtrans credentials
   */
  static resolvePaymentConfig(branch_id, brand_id) {
    if (branch_id) {
      let branch = null;
      if (brand_id) {
        branch = db.prepare('SELECT payment_config_override FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, brand_id);
      } else {
        branch = db.prepare('SELECT payment_config_override FROM branches WHERE id = ?').get(branch_id);
      }
      if (branch && branch.payment_config_override) {
        try {
          const cfg = JSON.parse(branch.payment_config_override);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    if (brand_id) {
      const brand = db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(brand_id);
      if (brand && brand.default_payment_config) {
        try {
          const cfg = JSON.parse(brand.default_payment_config);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    return {
      provider: 'midtrans',
      is_production: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      server_key: process.env.MIDTRANS_SERVER_KEY || '',
      client_key: process.env.MIDTRANS_CLIENT_KEY || '',
      merchant_id: process.env.MIDTRANS_MERCHANT_ID || ''
    };
  }

  /**
   * Generates a Midtrans Snap transaction token for an order.
   * 
   * @param {Object} params
   * @param {Object} params.order
   * @param {Array} params.items
   * @param {Object} params.customer
   * @returns {Promise<{ snap_token: string, redirect_url: string, merchant_id: string }>}
   */
  static async createSnapTransaction(order, items = [], customer = {}) {
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const isProd = config.is_production === true;
    const snapUrl = isProd
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authHeader = 'Basic ' + Buffer.from(config.server_key + ':').toString('base64');

    const payload = {
      transaction_details: {
        order_id: order.id,
        gross_amount: Math.round(order.grand_total)
      },
      customer_details: {
        first_name: customer.name || 'Pelanggan',
        phone: customer.phone || ''
      },
      item_details: items.map((i) => ({
        id: i.product_id || i.id,
        price: Math.round(i.unit_price || i.price),
        quantity: i.quantity || 1,
        name: String(i.product_name || i.name || 'Menu').substring(0, 50)
      }))
    };

    if (order.delivery_fee > 0) {
      payload.item_details.push({
        id: 'DELIVERY_FEE',
        price: Math.round(order.delivery_fee),
        quantity: 1,
        name: 'Biaya Pengantaran'
      });
    }

    try {
      const response = await axios.post(snapUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authHeader
        },
        timeout: 8000
      });

      return {
        snap_token: response.data.token,
        redirect_url: response.data.redirect_url,
        merchant_id: config.merchant_id
      };
    } catch (err) {
      console.error('[PaymentGatewayService] Midtrans Snap error:', err.response?.data || err.message);
      
      // P1 PAYMENT GATEWAY HARDENING (FINDING 05): Fail-Closed in Production & Explicit Testing
      // In production mode, NEVER issue fake simulation tokens on payment gateway exceptions
      if (isProd || process.env.NODE_ENV === 'production') {
        const errorDetail = err.response?.data?.error_messages?.join(', ') || err.message;
        throw new Error(`[Midtrans Gateway Error]: Gagal membuat transaksi pembayaran online (${errorDetail}).`);
      }

      // Explicit Mock/Sandbox Simulation fallback for local development only
      const simToken = 'sim_snap_' + Date.now();
      return {
        snap_token: simToken,
        redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${simToken}`,
        merchant_id: config.merchant_id
      };
    }
  }

  /**
   * Verifies Midtrans Webhook SHA512 signature.
   * Signature = SHA512(order_id + status_code + gross_amount + ServerKey)
   * 
   * @param {Object} webhookData
   * @param {string} serverKey
   * @returns {boolean}
   */
  static verifySignature(webhookData, serverKey) {
    if (!webhookData || !webhookData.signature_key || !serverKey) {
      return false;
    }

    const { order_id, status_code, gross_amount, signature_key } = webhookData;
    const raw = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const expectedHash = crypto.createHash('sha512').update(raw).digest('hex');

    return expectedHash === signature_key;
  }

  /**
   * Processes incoming Midtrans webhook notification with idempotency and signature security.
   * Emits payment.settled or payment.failed upon transition.
   * 
   * @param {Object} webhookData
   * @param {Object} [options]
   * @param {boolean} [options.skipSignatureCheck=false] - For local offline mock tests
   * @returns {Object} Processed result
   */
  static handleWebhook(webhookData, { skipSignatureCheck = false } = {}) {
    const { order_id, transaction_status, fraud_status, payment_type, gross_amount } = webhookData;

    let payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);

    // P1 SECURE WEBHOOK VERIFICATION: Strictly fail-closed signature verification (mandatory valid server_key & signature_key)
    if (!skipSignatureCheck) {
      const config = this.resolvePaymentConfig(order?.branch_id, order?.brand_id);
      if (!config.server_key) {
        throw new Error(`[PaymentGatewayService] Server Key Midtrans belum dikonfigurasi untuk brand/cabang order "${order_id}". Webhook ditolak demi keamanan.`);
      }
      if (!webhookData.signature_key) {
        throw new Error(`[PaymentGatewayService] Signature key tidak disertakan pada webhook payload untuk order "${order_id}". Webhook ditolak.`);
      }

      const isValid = this.verifySignature(webhookData, config.server_key);
      if (!isValid) {
        throw new Error(`[PaymentGatewayService Signature Fraud]: Signature webhook Midtrans tidak valid untuk order "${order_id}". Transaksi ditolak.`);
      }
    }

    // P1 RECONCILIATION FAIL-SAFE (NEW-02):
    // If payment row is missing due to client crash after gateway creation, self-heal local record from authoritative order
    if (!payment) {
      if (!order) {
        throw new Error(`[PaymentGatewayService] Data pesanan untuk Order ID "${order_id}" tidak ditemukan.`);
      }
      const selfHealedPaymentId = `pay_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO order_payments (id, order_id, provider, payment_method, merchant_id, snap_token, payment_status, amount, created_at, updated_at)
        VALUES (?, ?, 'midtrans', 'midtrans', 'midtrans', NULL, 'pending', ?, ?, ?)
      `).run(selfHealedPaymentId, order_id, order.grand_total, now, now);

      payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
    }

    let newPaymentStatus = PaymentModel.STATUSES.PENDING;
    let shouldConfirmOrder = false;

    if (transaction_status === 'capture') {
      if (fraud_status === 'challenge') {
        newPaymentStatus = PaymentModel.STATUSES.CHALLENGE;
      } else if (fraud_status === 'accept') {
        newPaymentStatus = PaymentModel.STATUSES.SETTLEMENT;
        shouldConfirmOrder = true;
      }
    } else if (transaction_status === 'settlement') {
      newPaymentStatus = PaymentModel.STATUSES.SETTLEMENT;
      shouldConfirmOrder = true;
    } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      newPaymentStatus = transaction_status;
    }

    // Idempotency: Return early if already settled or in same state
    if (payment.payment_status === PaymentModel.STATUSES.SETTLEMENT && newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) {
      return {
        success: true,
        idempotent: true,
        order_id,
        payment_status: PaymentModel.STATUSES.SETTLEMENT,
        message: 'Pembayaran sudah diselesaikan sebelumnya.'
      };
    }

    if (payment.payment_status === newPaymentStatus) {
      return {
        success: true,
        idempotent: true,
        order_id,
        payment_status: newPaymentStatus,
        message: `Status pembayaran sudah berada pada "${newPaymentStatus}".`
      };
    }

    // P1 STATE MACHINE INVARIANT (NEW-02): Prevent reviving cancelled/expired/terminal orders
    if (!PaymentModel.canTransition(payment.payment_status, newPaymentStatus)) {
      throw new Error(
        `[PaymentGatewayService State Violation]: Transisi status pembayaran tidak valid dari "${payment.payment_status}" ke "${newPaymentStatus}". Status terminal tidak dapat diubah.`
      );
    }

    if (order && order.status === 'cancelled' && shouldConfirmOrder) {
      throw new Error(
        `[PaymentGatewayService State Violation]: Pesanan "${order_id}" sudah dibatalkan (cancelled) dan tidak dapat dikonfirmasi ulang.`
      );
    }

    // P1 AUTHORITATIVE FINANCIAL INTEGRITY GUARD:
    // Strictly verify that Gateway Amount === Order Grand Total === Internal Payment Record Amount
    if (shouldConfirmOrder || newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) {
      const gatewayAmount = Number(gross_amount);
      const orderAmount = order ? Number(order.grand_total) : null;
      const paymentAmount = Number(payment.amount);

      if (
        !Number.isFinite(gatewayAmount) ||
        (orderAmount !== null && Math.round(gatewayAmount) !== Math.round(orderAmount)) ||
        Math.round(gatewayAmount) !== Math.round(paymentAmount)
      ) {
        throw new Error(
          `[PAYMENT_AMOUNT_MISMATCH]: Nominal pembayaran gateway (Rp ${gatewayAmount}) tidak cocok dengan tagihan order (Rp ${orderAmount}) atau payment record (Rp ${paymentAmount}). Transaksi settlement ditolak demi integritas finansial.`
        );
      }
    }

    const now = new Date().toISOString();

    // P1 ATOMICITY INVARIANT (Finding 3): Unify payment update, order confirmation, stock deduction, and ledger into single atomic transaction
    db.exec('BEGIN TRANSACTION;');
    try {
      // Update order_payments table
      db.prepare(`
        UPDATE order_payments 
        SET payment_status = ?, payment_method = 'midtrans', raw_webhook_response = ?, settled_at = CASE WHEN ? = 'settlement' THEN ? ELSE settled_at END
        WHERE order_id = ?
      `).run(newPaymentStatus, JSON.stringify(webhookData), newPaymentStatus, now, order_id);

      if (shouldConfirmOrder) {
        // 1. Authoritative Cross-Domain Inventory Settlement (Single Source of Truth in Commerce)
        const OrderPlacementService = require('../../commerce/services/OrderPlacementService');
        OrderPlacementService.deductStockForSettledOrder(order_id, { dbTransactionProvided: true });

        // 2. Confirm Order Record if all items were deducted successfully
        db.prepare(`
          UPDATE orders
          SET status = 'confirmed', payment_method = 'midtrans', updated_at = ?
          WHERE id = ?
        `).run(now, order_id);
      } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
        // P1 FAILED PAYMENT INVARIANT: Mark order as cancelled with ZERO inventory mutation
        db.prepare(`
          UPDATE orders
          SET status = 'cancelled', updated_at = ?
          WHERE id = ?
        `).run(now, order_id);
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      console.error('[PaymentGatewayService] Settlement transaction error:', err.message);

      // P1 FULFILLMENT EXCEPTION (Race Condition between checkout and settlement):
      // Money has been settled by gateway but inventory was depleted by concurrent orders.
      // Record payment as settlement, mark order as fulfillment_exception for refund/manual intervention.
      if (err.message && err.message.includes('[OUT_OF_STOCK_RACE]')) {
        try {
          db.exec('BEGIN TRANSACTION;');
          db.prepare(`
            UPDATE order_payments 
            SET payment_status = 'settlement', payment_method = 'midtrans', raw_webhook_response = ?, settled_at = ?
            WHERE order_id = ?
          `).run(JSON.stringify(webhookData), now, order_id);

          db.prepare(`
            UPDATE orders
            SET status = 'fulfillment_exception', payment_method = 'midtrans', order_note = COALESCE(order_note || ' | ', '') || ?, updated_at = ?
            WHERE id = ?
          `).run(`[Kendala Stok / Perlu Refund]: ${err.message}`, now, order_id);
          db.exec('COMMIT;');

          events.EventBus.publish({
            type: 'payment.fulfillment_exception',
            producer: 'payment',
            payload: {
              payment_id: payment.id,
              order_id,
              branch_id: order?.branch_id,
              brand_id: order?.brand_id,
              provider: 'midtrans',
              amount: Number(gross_amount || payment.amount),
              error: err.message,
              settled_at: now
            }
          }).catch(() => {});

          return {
            success: true,
            order_id,
            payment_status: 'settlement',
            order_status: 'fulfillment_exception',
            message: 'Pembayaran berhasil diselesaikan namun stok habis. Pesanan dialihkan ke antrean fulfillment exception untuk tindak lanjut refund.'
          };
        } catch (innerErr) {
          try { db.exec('ROLLBACK;'); } catch (_) {}
        }
      }

      throw new Error(`[PaymentGatewayService Transaction Error]: ${err.message}`);
    }

    // Publish Core Events outside of DB Transaction
    if (shouldConfirmOrder) {
      events.EventBus.publish({
        type: 'payment.settled',
        producer: 'payment',
        payload: {
          payment_id: payment.id,
          order_id,
          branch_id: order?.branch_id,
          brand_id: order?.brand_id,
          provider: 'midtrans',
          payment_method: 'midtrans',
          amount: Number(gross_amount || payment.amount),
          settled_at: now
        }
      }).catch(() => {});
    } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
      events.EventBus.publish({
        type: 'payment.failed',
        producer: 'payment',
        payload: {
          payment_id: payment.id,
          order_id,
          branch_id: order?.branch_id,
          provider: 'midtrans',
          status: newPaymentStatus
        }
      }).catch(() => {});
    }

    return {
      success: true,
      order_id,
      payment_status: newPaymentStatus
    };
  }
}

module.exports = PaymentGatewayService;
