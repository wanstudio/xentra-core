'use strict';

const crypto = require('crypto');
const axios = require('axios');

class MidtransGateway {
  constructor(config) {
    this.config = config;
    this.isProd = config.is_production === true;
  }

  get name() { return 'midtrans'; }

  get baseUrl() {
    return this.isProd
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  }

  get statusApiUrl() {
    return this.isProd
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';
  }

  _authHeader() {
    return 'Basic ' + Buffer.from(this.config.server_key + ':').toString('base64');
  }

  async createTransaction(order, items = [], customer = {}) {
    const payload = {
      transaction_details: { order_id: order.id, gross_amount: Math.round(order.grand_total) },
      customer_details: { first_name: customer.name || 'Pelanggan', phone: customer.phone || '' },
      item_details: items.map((i) => ({
        id: i.product_id || i.id,
        price: Math.round(i.unit_price || i.price),
        quantity: i.quantity || 1,
        name: String(i.product_name || i.name || 'Menu').substring(0, 50)
      }))
    };
    if (order.delivery_fee > 0) {
      payload.item_details.push({ id: 'DELIVERY_FEE', price: Math.round(order.delivery_fee), quantity: 1, name: 'Biaya Pengantaran' });
    }

    const response = await axios.post(this.baseUrl, payload, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: this._authHeader() },
      timeout: 8000
    });

    return {
      snap_token: response.data.token,
      redirect_url: response.data.redirect_url,
      merchant_id: this.config.merchant_id
    };
  }

  verifySignature(webhookData) {
    if (!webhookData || !webhookData.signature_key || !this.config.server_key) return false;
    const { order_id, status_code, gross_amount, signature_key } = webhookData;
    const raw = `${order_id}${status_code}${gross_amount}${this.config.server_key}`;
    return crypto.createHash('sha512').update(raw).digest('hex') === signature_key;
  }

  parseWebhookStatus(webhookData) {
    const { transaction_status, fraud_status } = webhookData;
    const shouldSettle = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');

    if (transaction_status === 'capture' && fraud_status === 'challenge') {
      return { mappedStatus: 'challenge', shouldSettle: false };
    }
    if (shouldSettle) {
      return { mappedStatus: 'settlement', shouldSettle: true };
    }
    if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      return { mappedStatus: transaction_status, shouldSettle: false };
    }
    return { mappedStatus: 'pending', shouldSettle: false };
  }

  getWebhookOrderId(webhookData) {
    return webhookData.order_id;
  }

  getWebhookAmount(webhookData) {
    return webhookData.gross_amount;
  }

  getWebhookSignatureData(webhookData) {
    return {
      order_id: webhookData.order_id,
      status_code: webhookData.status_code,
      gross_amount: webhookData.gross_amount,
      signature: webhookData.signature_key
    };
  }

  async checkTransactionStatus(orderId) {
    const response = await axios.get(`${this.statusApiUrl}/${orderId}/status`, {
      headers: { Accept: 'application/json', Authorization: this._authHeader() },
      timeout: 6000
    });
    return response.data;
  }

  getSimFallback(orderId) {
    const simToken = 'sim_snap_' + Date.now();
    return {
      snap_token: simToken,
      redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${simToken}`,
      merchant_id: this.config.merchant_id
    };
  }
}

module.exports = MidtransGateway;
