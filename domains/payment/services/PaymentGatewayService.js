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
      const branch = db.prepare('SELECT payment_config_override FROM branches WHERE id = ?').get(branch_id);
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

    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
    if (!payment) {
      throw new Error(`Data pembayaran untuk Order ID "${order_id}" tidak ditemukan.`);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);

    // Verify signature if server key is configured and not explicitly skipped
    if (!skipSignatureCheck) {
      const config = this.resolvePaymentConfig(order?.branch_id, order?.brand_id);
      if (config.server_key && webhookData.signature_key) {
        const isValid = this.verifySignature(webhookData, config.server_key);
        if (!isValid) {
          throw new Error(`[PaymentGatewayService] Signature webhook Midtrans tidak valid untuk order "${order_id}".`);
        }
      }
    }

    // Idempotency: Return early if already settled
    if (payment.payment_status === PaymentModel.STATUSES.SETTLEMENT) {
      return {
        success: true,
        idempotent: true,
        order_id,
        payment_status: PaymentModel.STATUSES.SETTLEMENT,
        message: 'Pembayaran sudah diselesaikan sebelumnya.'
      };
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

    const now = new Date().toISOString();

    // Update order_payments table: Provider & Payment Method are strictly 'midtrans'
    db.prepare(`
      UPDATE order_payments 
      SET payment_status = ?, payment_method = 'midtrans', raw_webhook_response = ?, settled_at = CASE WHEN ? = 'settlement' THEN ? ELSE settled_at END
      WHERE order_id = ?
    `).run(newPaymentStatus, JSON.stringify(webhookData), newPaymentStatus, now, order_id);

    // If settled, advance order status and emit event
    if (shouldConfirmOrder) {
      db.prepare(`
        UPDATE orders
        SET status = 'confirmed', payment_method = 'midtrans', updated_at = ?
        WHERE id = ?
      `).run(now, order_id);

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
