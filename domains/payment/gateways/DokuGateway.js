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
    if (!this.config.client_id || !this.config.secret_key) {
      throw new Error('[DokuGateway] Kredensial DOKU belum dikonfigurasi (Client-Id / Secret Key missing).');
    }

    const requestId = this._generateRequestId();
    const timestamp = this._timestamp();
    const target = '/checkout/v1/payment';

    const resolvedCallbackUrl = (this.config.callback_url && String(this.config.callback_url).trim()) ||
      (order.callback_url && String(order.callback_url).trim()) || '';

    const body = {
      order: {
        amount: Math.round(order.grand_total),
        invoice_number: order.id,
        currency: 'IDR',
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

    if (resolvedCallbackUrl) {
      body.order.callback_url = resolvedCallbackUrl;
      body.order.auto_redirect = true;
    } else {
      body.order.auto_redirect = false;
    }

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
      const clientId = headers['client-id'] || headers['Client-Id'];
      const requestId = headers['request-id'] || headers['Request-Id'];
      const timestamp = headers['request-timestamp'] || headers['Request-Timestamp'];
      const receivedSig = headers['signature'] || headers['Signature'];
      const target = headers['request-target'] || headers['Request-Target'] || notificationPath;
      const receivedDigest = headers['digest'] || headers['Digest'];

      if (!clientId || !requestId || !timestamp || !receivedSig || !target) return false;

      // Verify digest if Digest header is provided
      if (receivedDigest && body) {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const calculatedDigest = crypto.createHash('sha256').update(bodyStr).digest('base64');
        const cleanReceivedDigest = String(receivedDigest).replace(/^Digest:\s*/i, '').trim();
        if (cleanReceivedDigest !== calculatedDigest) {
          return false;
        }
      }

      const normalize = (sig) => String(sig || '').replace(/^HMACSHA256=/i, '').trim();

      const expectedSig = this._generateSignature(clientId, requestId, timestamp, target, body);
      if (normalize(receivedSig) === normalize(expectedSig)) return true;

      // Fallback check if notificationPath has /api/v1 prefix difference
      if (notificationPath) {
        const altPath = notificationPath.startsWith('/api/v1')
          ? notificationPath.replace(/^\/api\/v1/, '')
          : `/api/v1${notificationPath}`;
        const altSig = this._generateSignature(clientId, requestId, timestamp, altPath, body);
        if (normalize(receivedSig) === normalize(altSig)) return true;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  parseWebhookStatus(webhookData) {
    const txStatus = webhookData.transaction?.status;
    const orderStatus = webhookData.order?.status;

    if (txStatus === 'SUCCESS') {
      return { mappedStatus: 'settlement', shouldSettle: true };
    }
    if (orderStatus === 'ORDER_EXPIRED' || txStatus === 'EXPIRED') {
      return { mappedStatus: 'expire', shouldSettle: false };
    }
    if (txStatus === 'FAILED') {
      // DOKU Checkout: customer can retry payment until order expires.
      // Do not treat individual FAILED transaction as final cancellation.
      return { mappedStatus: 'pending', shouldSettle: false, failureReason: 'PAYMENT_ATTEMPT_FAILED' };
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
    const target = `/orders/v1/status/${encodeURIComponent(orderId)}`;
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
