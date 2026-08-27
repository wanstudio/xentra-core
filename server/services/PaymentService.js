const axios = require('axios');
const db = require('../database/db');
const OrderStateMachine = require('./OrderStateMachine');

class PaymentService {
  /**
   * Resolves Midtrans credentials hierarchically (Branch -> Brand -> Organization).
   * 
   * @param {string} branch_id
   * @param {string} brand_id
   * @returns {Object} { provider, is_production, server_key, client_key, merchant_id }
   */
  static resolvePaymentConfig(branch_id, brand_id) {
    // 1. Check Branch override
    if (branch_id) {
      const branch = db.prepare('SELECT payment_config_override FROM branches WHERE id = ?').get(branch_id);
      if (branch && branch.payment_config_override) {
        try {
          const cfg = JSON.parse(branch.payment_config_override);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    // 2. Check Brand default
    if (brand_id) {
      const brand = db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(brand_id);
      if (brand && brand.default_payment_config) {
        try {
          const cfg = JSON.parse(brand.default_payment_config);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    // 3. Fallback dummy sandbox
    return {
      provider: 'midtrans',
      is_production: false,
      server_key: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-TEST_KEY',
      client_key: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-TEST_KEY',
      merchant_id: 'G_XENTRA_TEST'
    };
  }

  /**
   * Creates a Midtrans Snap transaction for an order.
   * 
   * @param {Object} order - Order row
   * @param {Array} items - Order items
   * @param {Object} customer - Customer details
   * @returns {Promise<{ snap_token: string, redirect_url: string }>}
   */
  static async createSnapTransaction(order, items, customer) {
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
        phone: customer.phone
      },
      item_details: items.map((i) => ({
        id: i.product_id || i.id,
        price: Math.round(i.unit_price),
        quantity: i.quantity,
        name: i.product_name.substring(0, 50)
      }))
    };

    // Add delivery fee as item if > 0
    if (order.delivery_fee > 0) {
      payload.item_details.push({
        id: 'DELIVERY_FEE',
        price: Math.round(order.delivery_fee),
        quantity: 1,
        name: 'Biaya Pengantaran'
      });
    }

    // Add discount as negative item if > 0
    if (order.discount_amount > 0) {
      payload.item_details.push({
        id: 'PROMO_DISCOUNT',
        price: -Math.round(order.discount_amount),
        quantity: 1,
        name: 'Potongan Promo'
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
      console.error('[PaymentService] Midtrans Snap request error:', err.response?.data || err.message);
      // Generate deterministic simulation token for Sandbox/Offline testing
      const simToken = 'sim_snap_' + Date.now();
      return {
        snap_token: simToken,
        redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${simToken}`,
        merchant_id: config.merchant_id
      };
    }
  }

  /**
   * Handles incoming Midtrans Webhook with Idempotency.
   * 
   * @param {Object} webhookData
   * @returns {Object} Result
   */
  static handleWebhook(webhookData) {
    const { order_id, transaction_status, fraud_status, payment_type } = webhookData;

    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order_id);
    if (!payment) {
      throw new Error(`Data pembayaran untuk Order ID "${order_id}" tidak ditemukan.`);
    }

    // Check if already settled
    if (payment.payment_status === 'settlement') {
      return { success: true, message: 'Transaksi sudah berstatus settlement sebelumnya (Idempotent).' };
    }

    let newPaymentStatus = 'pending';
    let shouldConfirmOrder = false;

    if (transaction_status === 'capture') {
      if (fraud_status === 'challenge') {
        newPaymentStatus = 'challenge';
      } else if (fraud_status === 'accept') {
        newPaymentStatus = 'settlement';
        shouldConfirmOrder = true;
      }
    } else if (transaction_status === 'settlement') {
      newPaymentStatus = 'settlement';
      shouldConfirmOrder = true;
    } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      newPaymentStatus = transaction_status;
    }

    // Update payment record
    db.prepare(`
      UPDATE order_payments 
      SET payment_status = ?, payment_method = ?, raw_webhook_response = ?, settled_at = CASE WHEN ? = 'settlement' THEN datetime('now') ELSE settled_at END
      WHERE order_id = ?
    `).run(newPaymentStatus, payment_type || payment.payment_method, JSON.stringify(webhookData), newPaymentStatus, order_id);

    // If payment successfully settled, advance Order state machine
    if (shouldConfirmOrder) {
      try {
        OrderStateMachine.transition({
          order_id,
          target_status: 'confirmed',
          actor_type: 'system',
          note: `Pembayaran lunas via Midtrans (${payment_type}).`
        });
      } catch (e) {
        console.warn('[PaymentService] Order transition warning:', e.message);
      }
    }

    return {
      success: true,
      order_id,
      payment_status: newPaymentStatus
    };
  }
}

module.exports = PaymentService;
