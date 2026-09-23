'use strict';

const crypto = require('crypto');
const axios = require('axios');

class DokuGateway {
  constructor(config) {
    this.config = config;
    this.isProd = config.is_production === true;
  }

  get name() { return 'doku'; }

  get baseUrl() {
    return this.isProd ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
  }

  _generateSignature(clientId, requestId, timestamp, target, body) {
    const components = [
      `Client-Id:${clientId}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${timestamp}`,
      `Request-Target:${target}`
    ];

    if (body) {
      const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
      components.push(`Digest:${digest}`);
    }

    const signatureString = components.join('\n');
    const signature = crypto.createHmac('sha256', this.config.secret_key)
      .update(signatureString)
      .digest('base64');

    return `HMACSHA256=${signature}`;
  }

  _generateRequestId() {
    return crypto.randomUUID();
  }

  _timestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  async createTransaction(order, items = [], customer = {}) {
    const requestId = this._generateRequestId();
    const timestamp = this._timestamp();
    const target = '/checkout/v1/payment';

    const body = {
      order: {
        amount: Math.round(order.grand_total),
        invoice_number: order.id,
        currency: 'IDR',
        callback_url: this.config.callback_url || '',
        auto_redirect: true,
        language: 'ID',
        line_items: items.map((i, idx) => ({
          id: String(idx + 1),
          name: String(i.product_name || i.name || 'Menu').substring(0, 255),
          price: Math.round(i.unit_price || i.price),
          quantity: i.quantity || 1
        }))
      },
      payment: {
        payment_due_date: 60
      },
      customer: {
        id: customer.phone || order.customer_phone || 'guest',
        name: customer.name || order.customer_name || 'Pelanggan',
        phone: customer.phone || order.customer_phone || ''
      }
    };

    if (order.delivery_fee > 0) {
      body.order.line_items.push({
        id: String(body.order.line_items.length + 1),
        name: 'Biaya Pengantaran',
        price: Math.round(order.delivery_fee),
        quantity: 1
      });
    }

    const signature = this._generateSignature(this.config.client_id, requestId, timestamp, target, body);

    const response = await axios.post(this.baseUrl + target, body, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.config.client_id,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        'Signature': signature
      },
      timeout: 10000
    });

    const res = response.data;
    if (!res.response || !res.response.payment || !res.response.payment.url) {
      throw new Error('[DokuGateway] Invalid response: no payment URL returned');
    }

    return {
      snap_token: res.response.payment.token_id,
      redirect_url: res.response.payment.url,
      merchant_id: this.config.client_id,
      doku_session_id: res.response.order.session_id,
      expired_date: res.response.payment.expired_date
    };
  }

  verifySignature(headers, body, notificationPath) {
    try {
      const clientId = headers['client-id'];
      const requestId = headers['request-id'];
      const timestamp = headers['request-timestamp'];
      const receivedSig = headers['signature'];

      if (!clientId || !requestId || !timestamp || !receivedSig) return false;

      const expectedSig = this._generateSignature(clientId, requestId, timestamp, notificationPath, body);
      return receivedSig === expectedSig;
    } catch (_) {
      return false;
    }
  }

  parseWebhookStatus(webhookData) {
    const txStatus = webhookData.transaction?.status;

    if (txStatus === 'SUCCESS') {
      return { mappedStatus: 'settlement', shouldSettle: true };
    }
    if (txStatus === 'FAILED') {
      return { mappedStatus: 'cancel', shouldSettle: false };
    }
    if (txStatus === 'PENDING') {
      return { mappedStatus: 'pending', shouldSettle: false };
    }
    return { mappedStatus: 'pending', shouldSettle: false };
  }

  getWebhookOrderId(webhookData) {
    return webhookData.order?.invoice_number;
  }

  getWebhookAmount(webhookData) {
    return webhookData.order?.amount;
  }

  getWebhookSignatureData() {
    return null;
  }

  async checkTransactionStatus(orderId) {
    const requestId = this._generateRequestId();
    const timestamp = this._timestamp();
    const target = `/checkout/v1/payment/${orderId}/status`;
    const signature = this._generateSignature(this.config.client_id, requestId, timestamp, target);

    const response = await axios.get(this.baseUrl + target, {
      headers: {
        'Client-Id': this.config.client_id,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        'Signature': signature
      },
      timeout: 8000
    });

    return response.data;
  }

  getSimFallback() {
    return null;
  }
}

module.exports = DokuGateway;
